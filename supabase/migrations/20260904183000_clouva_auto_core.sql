-- CLOUVA AUTO — Player-owned vehicle digital twin core.
-- Reuses players, commerce_products, creator_3d_assets and player_media.

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  nickname text,
  make text not null,
  model text not null,
  version text,
  year integer check (year is null or year between 1886 and 2200),
  license_plate text,
  vin text,
  odometer_km integer not null default 0 check (odometer_km >= 0),
  fuel_type text,
  transmission text,
  color_current text,
  color_original text,
  acquired_on date,
  notes text,
  overall_status text not null default 'review' check (overall_status in ('good','review','repair','replace','missing','in_progress','solved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_player_id_idx on public.vehicles(player_id);
create unique index if not exists vehicles_player_vin_uidx on public.vehicles(player_id, lower(vin)) where vin is not null and btrim(vin) <> '';
create unique index if not exists vehicles_player_plate_uidx on public.vehicles(player_id, lower(license_plate)) where license_plate is not null and btrim(license_plate) <> '';

create table if not exists public.vehicle_system_catalog (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  progress_weight numeric(6,3) not null default 1 check (progress_weight > 0),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.vehicle_part_catalog (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.vehicle_system_catalog(id) on delete cascade,
  parent_part_id uuid references public.vehicle_part_catalog(id) on delete set null,
  key text not null unique,
  name text not null,
  position text,
  simple_description text not null,
  technical_description text,
  function_text text,
  common_symptoms jsonb not null default '[]'::jsonb,
  inspection_steps jsonb not null default '[]'::jsonb,
  requirements jsonb not null default '{}'::jsonb,
  safety_level text not null default 'basic' check (safety_level in ('basic','caution','specialist')),
  default_priority text not null default 'normal' check (default_priority in ('low','normal','high','critical')),
  default_repair_category text not null default 'function' check (default_repair_category in ('critical','function','maintenance','aesthetic','upgrade')),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists vehicle_part_catalog_system_idx on public.vehicle_part_catalog(system_id, sort_order);

create table if not exists public.vehicle_part_state (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  part_catalog_id uuid not null references public.vehicle_part_catalog(id) on delete cascade,
  status text not null default 'review' check (status in ('good','review','repair','replace','missing','in_progress','solved')),
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  notes text,
  last_inspected_at timestamptz,
  repaired_at timestamptz,
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  parts_cost numeric(14,2) not null default 0 check (parts_cost >= 0),
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  commerce_product_id uuid references public.commerce_products(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(vehicle_id, part_catalog_id)
);
create index if not exists vehicle_part_state_vehicle_idx on public.vehicle_part_state(vehicle_id, status, priority);

create table if not exists public.vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  title text not null default 'Revisión básica',
  status text not null default 'completed' check (status in ('draft','in_progress','completed','cancelled')),
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_inspections_vehicle_idx on public.vehicle_inspections(vehicle_id, created_at desc);

create table if not exists public.vehicle_inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.vehicle_inspections(id) on delete cascade,
  part_catalog_id uuid not null references public.vehicle_part_catalog(id) on delete restrict,
  result text not null check (result in ('good','review','repair','replace','missing')),
  observations text,
  created_at timestamptz not null default now(),
  unique(inspection_id, part_catalog_id)
);

create table if not exists public.vehicle_repairs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  part_catalog_id uuid references public.vehicle_part_catalog(id) on delete set null,
  category text not null default 'function' check (category in ('critical','function','maintenance','aesthetic','upgrade')),
  status text not null default 'planned' check (status in ('planned','in_progress','completed','cancelled')),
  title text not null,
  diagnosis text,
  resolution text,
  parts_cost numeric(14,2) not null default 0 check (parts_cost >= 0),
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  estimated_cost numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),
  commerce_product_id uuid references public.commerce_products(id) on delete set null,
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicle_repairs_vehicle_idx on public.vehicle_repairs(vehicle_id, status, created_at desc);

create table if not exists public.vehicle_events (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  repair_id uuid references public.vehicle_repairs(id) on delete set null,
  event_type text not null,
  title text not null,
  description text,
  amount numeric(14,2) check (amount is null or amount >= 0),
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists vehicle_events_vehicle_idx on public.vehicle_events(vehicle_id, occurred_at desc);

create table if not exists public.vehicle_media_links (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  player_media_id uuid not null references public.player_media(id) on delete cascade,
  part_catalog_id uuid references public.vehicle_part_catalog(id) on delete set null,
  repair_id uuid references public.vehicle_repairs(id) on delete set null,
  phase text not null default 'general' check (phase in ('general','before','after','inspection')),
  created_at timestamptz not null default now(),
  unique(vehicle_id, player_media_id)
);
create index if not exists vehicle_media_links_vehicle_idx on public.vehicle_media_links(vehicle_id, created_at desc);

create table if not exists public.vehicle_3d_bindings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  creator_3d_asset_id uuid not null references public.creator_3d_assets(id) on delete restrict,
  representation_level smallint not null default 2 check (representation_level between 1 and 4),
  part_mesh_map jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehicle_3d_bindings_one_active_idx on public.vehicle_3d_bindings(vehicle_id) where is_active;

create table if not exists public.vehicle_part_compatibility (
  id uuid primary key default gen_random_uuid(),
  part_catalog_id uuid not null references public.vehicle_part_catalog(id) on delete cascade,
  commerce_product_id uuid references public.commerce_products(id) on delete cascade,
  make text,
  model text,
  generation text,
  year_min integer,
  year_max integer,
  engine text,
  version text,
  position text,
  oem_numbers text[] not null default '{}',
  compatibility_status text not null default 'unknown' check (compatibility_status in ('compatible','possible','incompatible','unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (year_min is null or year_max is null or year_min <= year_max)
);
create index if not exists vehicle_part_compatibility_lookup_idx on public.vehicle_part_compatibility(part_catalog_id, make, model, year_min, year_max);

insert into storage.buckets (id, name, public, file_size_limit)
values ('vehicle-media', 'vehicle-media', false, 12582912)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create schema if not exists private;
create or replace function private.touch_vehicle_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_vehicle_updated_at() from public, anon, authenticated;

drop trigger if exists vehicles_touch_updated_at on public.vehicles;
create trigger vehicles_touch_updated_at before update on public.vehicles for each row execute function private.touch_vehicle_updated_at();
drop trigger if exists vehicle_part_state_touch_updated_at on public.vehicle_part_state;
create trigger vehicle_part_state_touch_updated_at before update on public.vehicle_part_state for each row execute function private.touch_vehicle_updated_at();
drop trigger if exists vehicle_repairs_touch_updated_at on public.vehicle_repairs;
create trigger vehicle_repairs_touch_updated_at before update on public.vehicle_repairs for each row execute function private.touch_vehicle_updated_at();
drop trigger if exists vehicle_3d_bindings_touch_updated_at on public.vehicle_3d_bindings;
create trigger vehicle_3d_bindings_touch_updated_at before update on public.vehicle_3d_bindings for each row execute function private.touch_vehicle_updated_at();

alter table public.vehicles enable row level security;
alter table public.vehicle_system_catalog enable row level security;
alter table public.vehicle_part_catalog enable row level security;
alter table public.vehicle_part_state enable row level security;
alter table public.vehicle_inspections enable row level security;
alter table public.vehicle_inspection_items enable row level security;
alter table public.vehicle_repairs enable row level security;
alter table public.vehicle_events enable row level security;
alter table public.vehicle_media_links enable row level security;
alter table public.vehicle_3d_bindings enable row level security;
alter table public.vehicle_part_compatibility enable row level security;

drop policy if exists vehicles_select_player_members on public.vehicles;
create policy vehicles_select_player_members on public.vehicles for select to authenticated using (
  exists (
    select 1 from public.players p
    where p.id = vehicles.player_id
      and (p.owner_user_id = (select auth.uid()) or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = (select auth.uid()) and pm.status = 'active'
      ))
  )
);
drop policy if exists vehicles_insert_player_managers on public.vehicles;
create policy vehicles_insert_player_managers on public.vehicles for insert to authenticated with check (
  exists (
    select 1 from public.players p
    where p.id = vehicles.player_id
      and (p.owner_user_id = (select auth.uid()) or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role = any(array['owner','manager','editor'])
      ))
  )
);
drop policy if exists vehicles_update_player_managers on public.vehicles;
create policy vehicles_update_player_managers on public.vehicles for update to authenticated using (
  exists (
    select 1 from public.players p
    where p.id = vehicles.player_id
      and (p.owner_user_id = (select auth.uid()) or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role = any(array['owner','manager','editor'])
      ))
  )
) with check (
  exists (
    select 1 from public.players p
    where p.id = vehicles.player_id
      and (p.owner_user_id = (select auth.uid()) or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role = any(array['owner','manager','editor'])
      ))
  )
);
drop policy if exists vehicles_delete_player_managers on public.vehicles;
create policy vehicles_delete_player_managers on public.vehicles for delete to authenticated using (
  exists (
    select 1 from public.players p
    where p.id = vehicles.player_id
      and (p.owner_user_id = (select auth.uid()) or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role = any(array['owner','manager','editor'])
      ))
  )
);

create or replace function public.vehicle_can_view(p_vehicle_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.vehicles v
    join public.players p on p.id = v.player_id
    where v.id = p_vehicle_id
      and (p.owner_user_id = p_user_id or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = p_user_id and pm.status = 'active'
      ))
  );
$$;
create or replace function public.vehicle_can_manage(p_vehicle_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.vehicles v
    join public.players p on p.id = v.player_id
    where v.id = p_vehicle_id
      and (p.owner_user_id = p_user_id or exists (
        select 1 from public.player_members pm where pm.player_id = p.id and pm.user_id = p_user_id and pm.status = 'active' and pm.role = any(array['owner','manager','editor'])
      ))
  );
$$;
revoke all on function public.vehicle_can_view(uuid, uuid) from public, anon;
revoke all on function public.vehicle_can_manage(uuid, uuid) from public, anon;
grant execute on function public.vehicle_can_view(uuid, uuid) to authenticated;
grant execute on function public.vehicle_can_manage(uuid, uuid) to authenticated;

drop policy if exists vehicle_system_catalog_read on public.vehicle_system_catalog;
create policy vehicle_system_catalog_read on public.vehicle_system_catalog for select to authenticated using (true);
drop policy if exists vehicle_part_catalog_read on public.vehicle_part_catalog;
create policy vehicle_part_catalog_read on public.vehicle_part_catalog for select to authenticated using (true);
drop policy if exists vehicle_part_compatibility_read on public.vehicle_part_compatibility;
create policy vehicle_part_compatibility_read on public.vehicle_part_compatibility for select to authenticated using (true);

-- Child ownership always follows the vehicle; writes never authorize by caller-supplied player ids.
drop policy if exists vehicle_part_state_read on public.vehicle_part_state;
create policy vehicle_part_state_read on public.vehicle_part_state for select to authenticated using (public.vehicle_can_view(vehicle_id, (select auth.uid())));
drop policy if exists vehicle_part_state_write on public.vehicle_part_state;
create policy vehicle_part_state_write on public.vehicle_part_state for all to authenticated using (public.vehicle_can_manage(vehicle_id, (select auth.uid()))) with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

drop policy if exists vehicle_inspections_read on public.vehicle_inspections;
create policy vehicle_inspections_read on public.vehicle_inspections for select to authenticated using (public.vehicle_can_view(vehicle_id, (select auth.uid())));
drop policy if exists vehicle_inspections_write on public.vehicle_inspections;
create policy vehicle_inspections_write on public.vehicle_inspections for all to authenticated using (public.vehicle_can_manage(vehicle_id, (select auth.uid()))) with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

drop policy if exists vehicle_inspection_items_read on public.vehicle_inspection_items;
create policy vehicle_inspection_items_read on public.vehicle_inspection_items for select to authenticated using (exists (select 1 from public.vehicle_inspections i where i.id = inspection_id and public.vehicle_can_view(i.vehicle_id, (select auth.uid()))));
drop policy if exists vehicle_inspection_items_write on public.vehicle_inspection_items;
create policy vehicle_inspection_items_write on public.vehicle_inspection_items for all to authenticated using (exists (select 1 from public.vehicle_inspections i where i.id = inspection_id and public.vehicle_can_manage(i.vehicle_id, (select auth.uid())))) with check (exists (select 1 from public.vehicle_inspections i where i.id = inspection_id and public.vehicle_can_manage(i.vehicle_id, (select auth.uid()))));

drop policy if exists vehicle_repairs_read on public.vehicle_repairs;
create policy vehicle_repairs_read on public.vehicle_repairs for select to authenticated using (public.vehicle_can_view(vehicle_id, (select auth.uid())));
drop policy if exists vehicle_repairs_write on public.vehicle_repairs;
create policy vehicle_repairs_write on public.vehicle_repairs for all to authenticated using (public.vehicle_can_manage(vehicle_id, (select auth.uid()))) with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

drop policy if exists vehicle_events_read on public.vehicle_events;
create policy vehicle_events_read on public.vehicle_events for select to authenticated using (public.vehicle_can_view(vehicle_id, (select auth.uid())));
drop policy if exists vehicle_events_write on public.vehicle_events;
create policy vehicle_events_write on public.vehicle_events for all to authenticated using (public.vehicle_can_manage(vehicle_id, (select auth.uid()))) with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

drop policy if exists vehicle_media_links_read on public.vehicle_media_links;
create policy vehicle_media_links_read on public.vehicle_media_links for select to authenticated using (public.vehicle_can_view(vehicle_id, (select auth.uid())));
drop policy if exists vehicle_media_links_write on public.vehicle_media_links;
create policy vehicle_media_links_write on public.vehicle_media_links for all to authenticated using (public.vehicle_can_manage(vehicle_id, (select auth.uid()))) with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

drop policy if exists vehicle_3d_bindings_read on public.vehicle_3d_bindings;
create policy vehicle_3d_bindings_read on public.vehicle_3d_bindings for select to authenticated using (public.vehicle_can_view(vehicle_id, (select auth.uid())));
drop policy if exists vehicle_3d_bindings_write on public.vehicle_3d_bindings;
create policy vehicle_3d_bindings_write on public.vehicle_3d_bindings for all to authenticated using (public.vehicle_can_manage(vehicle_id, (select auth.uid()))) with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

grant select, insert, update, delete on public.vehicles, public.vehicle_part_state, public.vehicle_inspections, public.vehicle_inspection_items, public.vehicle_repairs, public.vehicle_events, public.vehicle_media_links, public.vehicle_3d_bindings to authenticated;
grant select on public.vehicle_system_catalog, public.vehicle_part_catalog, public.vehicle_part_compatibility to authenticated;

insert into public.vehicle_system_catalog (key, name, description, progress_weight, sort_order) values
('engine','Motor','Genera la potencia del vehículo.',1.4,10),
('brakes','Frenos','Reduce velocidad y detiene el vehículo.',1.6,20),
('suspension','Suspensión','Mantiene contacto y control entre ruedas y superficie.',1.3,30),
('steering','Dirección','Transmite el movimiento del volante a las ruedas.',1.4,40),
('transmission','Transmisión','Lleva el par del motor a las ruedas.',1.2,50),
('cooling','Refrigeración','Controla la temperatura de funcionamiento.',1.3,60),
('electrical','Electricidad','Alimentación, carga, arranque y circuitos.',1.2,70),
('wheels','Ruedas','Neumáticos, llantas y elementos directamente asociados.',1.6,80),
('lighting','Iluminación','Luces para ver, ser visto y señalizar.',1.1,90),
('body','Carrocería','Estructura exterior, cierres y terminaciones.',0.7,100),
('interior','Interior','Habitáculo, controles, asientos y terminaciones.',0.6,110),
('exhaust','Escape','Evacúa y trata gases de combustión.',0.9,120)
on conflict (key) do update set name=excluded.name, description=excluded.description, progress_weight=excluded.progress_weight, sort_order=excluded.sort_order;

with s as (select id,key from public.vehicle_system_catalog)
insert into public.vehicle_part_catalog (system_id,key,name,position,simple_description,technical_description,function_text,common_symptoms,inspection_steps,requirements,safety_level,default_priority,default_repair_category,sort_order)
select s.id, v.key, v.name, v.position, v.simple_description, v.technical_description, v.function_text, v.common_symptoms::jsonb, v.inspection_steps::jsonb, v.requirements::jsonb, v.safety_level, v.default_priority, v.default_repair_category, v.sort_order
from s
join (values
('engine','engine_oil','Aceite de motor',null,'Lubrica las partes internas del motor y ayuda a controlar temperatura y desgaste.','El aceite crea una película lubricante entre superficies móviles y transporta contaminantes hacia el filtro.','Reducir fricción, limpiar, sellar y disipar calor.','["nivel bajo","luz de aceite","ruidos mecánicos","aceite muy degradado"]','["Estacioná en piso nivelado y apagá el motor.","Esperá el tiempo indicado por el fabricante.","Revisá nivel con varilla o sistema electrónico y observá el aspecto."]','{"tools":[],"consumables":["aceite con especificación correcta","filtro si corresponde"],"difficulty":"basic","equipment":[]}','basic','high','maintenance',10),
('brakes','front_brake_pads','Pastillas de freno delanteras','front','Son el material que el cáliper presiona contra el disco para frenar.','Transforman energía cinética en calor mediante fricción contra el rotor.','Crear la fricción principal de frenado en el eje delantero.','["chirrido","espesor bajo","frenado débil","testigo de desgaste"]','["Observá el espesor visible cuando sea posible.","Compará desgaste de ambos lados.","Si hay ruido, vibración o fuga, registralo antes de desmontar."]','{"tools":["llave de rueda","herramientas del cáliper"],"consumables":["pastillas compatibles","limpiador de frenos"],"equipment":["crique","caballetes"],"difficulty":"intermediate"}','caution','critical','critical',10),
('brakes','front_brake_discs','Discos de freno delanteros','front','Son los discos metálicos que giran con la rueda y reciben la presión de las pastillas.','Los rotores disipan en calor la energía absorbida durante el frenado.','Dar una superficie estable de fricción y disipar calor.','["vibración al frenar","surcos","grietas","espesor insuficiente"]','["Buscá surcos, coloración por temperatura y grietas.","El espesor debe medirse y compararse con el mínimo del fabricante."]','{"tools":["calibre o micrómetro"],"consumables":[],"equipment":["crique","caballetes"],"difficulty":"intermediate"}','caution','critical','critical',20),
('brakes','brake_fluid','Líquido de frenos',null,'Transmite la fuerza del pedal hacia los frenos de las ruedas.','Fluido hidráulico higroscópico que trabaja bajo presión y temperatura elevadas.','Transmitir presión hidráulica sin comprimirse de forma apreciable.','["nivel bajo","pedal esponjoso","fugas","fluido contaminado"]','["Ubicá el depósito y verificá MIN/MAX sin abrir innecesariamente.","Si baja el nivel, buscá la causa: no lo trates sólo como una recarga."]','{"tools":[],"consumables":["fluido de especificación correcta"],"equipment":[],"difficulty":"intermediate"}','caution','critical','critical',30),
('suspension','front_shock_absorber','Amortiguador delantero','front','Controla el rebote de la suspensión para que la rueda copie el piso.','Amortigua oscilaciones convirtiendo movimiento en calor a través de resistencia hidráulica.','Controlar oscilaciones y mantener contacto neumático-suelo.','["rebote excesivo","golpes","pérdida de aceite","desgaste irregular del neumático"]','["Buscá pérdidas visibles y daños.","Compará altura y comportamiento entre ambos lados.","Registrá golpes o rebotes anormales durante circulación."]','{"tools":["herramientas de suspensión"],"consumables":[],"equipment":["crique","caballetes","compresor de espirales si aplica"],"difficulty":"advanced"}','specialist','high','function',10),
('wheels','front_tires','Neumáticos delanteros','front','Son el único contacto directo del auto con el piso en el eje delantero.','Su compuesto, estructura, presión y dibujo determinan adherencia, frenado y guiado.','Transmitir aceleración, frenado y fuerzas laterales al suelo.','["dibujo gastado","grietas","bultos","presión incorrecta","desgaste desigual"]','["Revisá dibujo en toda la banda.","Buscá cortes, bultos y grietas.","Medí presión en frío según la especificación del vehículo."]','{"tools":["medidor de presión"],"consumables":[],"equipment":[],"difficulty":"basic"}','basic','critical','critical',10),
('wheels','rear_tires','Neumáticos traseros','rear','Mantienen apoyo, estabilidad y frenado del eje trasero.','Su estado influye especialmente en estabilidad del vehículo durante maniobras y lluvia.','Transmitir fuerzas al suelo y mantener estabilidad.','["dibujo gastado","grietas","bultos","presión incorrecta","desgaste desigual"]','["Revisá dibujo en toda la banda.","Buscá cortes, bultos y grietas.","Medí presión en frío según la especificación del vehículo."]','{"tools":["medidor de presión"],"consumables":[],"equipment":[],"difficulty":"basic"}','basic','critical','critical',20),
('cooling','coolant_reservoir','Depósito de refrigerante',null,'Permite controlar y compensar la expansión del líquido refrigerante.','Forma parte del circuito presurizado o de recuperación según el diseño del vehículo.','Mantener reserva y compensar cambios de volumen del refrigerante.','["nivel bajo","manchas","olor dulce","sobretemperatura"]','["Revisá el nivel sólo con el sistema a temperatura segura.","Buscá manchas o residuos alrededor del depósito y mangueras.","Nunca abras un circuito caliente presurizado."]','{"tools":[],"consumables":["refrigerante de especificación correcta"],"equipment":[],"difficulty":"basic"}','caution','high','maintenance',10),
('electrical','battery','Batería',null,'Guarda energía eléctrica para arrancar y alimentar sistemas cuando hace falta.','Acumulador electroquímico que estabiliza tensión y entrega corriente elevada al arranque.','Dar energía de arranque y estabilizar la red de 12 V.','["arranque lento","luces débiles","bornes sulfatados","batería descargada"]','["Revisá fijación, carcasa y bornes.","Buscá corrosión o cables flojos.","Medí tensión sólo si sabés usar el instrumento correctamente."]','{"tools":["multímetro opcional"],"consumables":[],"equipment":[],"difficulty":"basic"}','caution','high','maintenance',10),
('lighting','headlights','Ópticas delanteras','front','Iluminan el camino y hacen visible el auto de frente.','Conjunto óptico que controla el haz de luz de baja/alta y, según versión, otras funciones.','Iluminar y señalizar con un patrón de haz correcto.','["luz apagada","condensación","óptica opaca","haz desalineado"]','["Probá baja y alta.","Compará ambos lados.","Buscá humedad, fisuras y soportes rotos."]','{"tools":[],"consumables":["lámpara o módulo compatible si corresponde"],"equipment":[],"difficulty":"basic"}','basic','high','function',10),
('steering','steering_system','Sistema de dirección',null,'Conecta lo que hacés con el volante con el giro de las ruedas.','Incluye columna, asistencia, caja o cremallera y articulaciones que convierten giro en ángulo de rueda.','Controlar la trayectoria con precisión y sin juego excesivo.','["juego en volante","golpes","dirección pesada","vibraciones"]','["Con el vehículo detenido verificá juego anormal de forma básica.","Registrá ruidos, tironeos o cambios de esfuerzo.","Una inspección de articulaciones requiere elevar el vehículo de forma segura."]','{"tools":[],"consumables":[],"equipment":["elevación segura para inspección completa"],"difficulty":"advanced"}','specialist','critical','critical',10),
('transmission','transmission_general','Transmisión',null,'Lleva la fuerza del motor hasta las ruedas usando distintas relaciones.','Conjunto de caja, embrague o convertidor, diferencial y semiejes según la arquitectura.','Adaptar par y velocidad y transmitirlos a las ruedas.','["cambios duros","patinamiento","ruidos","pérdidas","vibraciones"]','["Registrá cuándo aparece el síntoma: frío/caliente, marcha y carga.","Buscá pérdidas visibles sin meterte debajo de un auto sin soporte seguro."]','{"tools":[],"consumables":[],"equipment":[],"difficulty":"advanced"}','specialist','high','function',10),
('body','front_bumper','Paragolpes delantero','front','Protege y termina visualmente la parte delantera del auto.','La cubierta exterior y sus absorbedores/soportes administran impactos menores y aerodinámica.','Proteger componentes y completar la geometría exterior.','["fisuras","soportes rotos","desalineación","faltantes"]','["Mirá uniones laterales e inferiores.","Compará separaciones con guardabarros y ópticas.","Revisá si faltan fijaciones."]','{"tools":["herramientas de fijación según modelo"],"consumables":[],"equipment":[],"difficulty":"basic"}','basic','normal','aesthetic',10),
('interior','driver_seat','Butaca del conductor','front-left','Sujeta al conductor y define su posición respecto de controles y cinturón.','Estructura, correderas, espuma y sistemas de retención deben conservar fijación y geometría.','Posicionar y sostener al conductor de forma estable.','["juego en correderas","tapizado roto","ajuste trabado","fijación floja"]','["Probá todos los ajustes.","Verificá que trabe firmemente en posición.","Revisá visualmente anclajes accesibles."]','{"tools":[],"consumables":[],"equipment":[],"difficulty":"basic"}','caution','high','function',10),
('exhaust','exhaust_system','Sistema de escape',null,'Conduce los gases del motor hacia atrás y reduce ruido y emisiones.','Incluye colector, catalizador, tuberías, silenciadores, sensores y soportes según versión.','Evacuar gases, tratar emisiones y controlar ruido.','["ruido fuerte","olor a gases","vibración","piezas colgando","óxido perforante"]','["Con el sistema frío, observá soportes y corrosión visible.","No trabajes debajo del vehículo sin elevación segura.","Olor a gases en habitáculo requiere revisión prioritaria."]','{"tools":[],"consumables":[],"equipment":["elevación segura para inspección inferior"],"difficulty":"intermediate"}','caution','high','function',10)
) as v(system_key,key,name,position,simple_description,technical_description,function_text,common_symptoms,inspection_steps,requirements,safety_level,default_priority,default_repair_category,sort_order)
on s.key = v.system_key
on conflict (key) do update set
  system_id=excluded.system_id,
  name=excluded.name,
  position=excluded.position,
  simple_description=excluded.simple_description,
  technical_description=excluded.technical_description,
  function_text=excluded.function_text,
  common_symptoms=excluded.common_symptoms,
  inspection_steps=excluded.inspection_steps,
  requirements=excluded.requirements,
  safety_level=excluded.safety_level,
  default_priority=excluded.default_priority,
  default_repair_category=excluded.default_repair_category,
  sort_order=excluded.sort_order;
