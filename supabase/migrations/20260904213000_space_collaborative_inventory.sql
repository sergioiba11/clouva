begin;

-- CLOUVA Space Inventory Core
-- Canonical operational inventory for Studios, Spots, clubs and businesses.
-- Commerce-linked items reference commerce_products / variants instead of copying commercial stock.

create table if not exists public.space_inventory_categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  display_order integer not null default 0,
  active boolean not null default true,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(space_id, slug)
);

create index if not exists space_inventory_categories_space_active_idx
  on public.space_inventory_categories(space_id, active, display_order);

create table if not exists public.space_inventory_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  category_id uuid references public.space_inventory_categories(id) on delete set null,
  name text not null,
  description text,
  image_url text,
  stock_source text not null default 'managed' check (stock_source in ('managed','commerce_product','commerce_variant')),
  quantity numeric(18,4) not null default 0 check (quantity >= 0),
  unit text not null default 'unidad',
  minimum_quantity numeric(18,4) not null default 0 check (minimum_quantity >= 0),
  ideal_quantity numeric(18,4) check (ideal_quantity is null or ideal_quantity >= 0),
  unit_cost numeric(18,4) check (unit_cost is null or unit_cost >= 0),
  replacement_cost numeric(18,4) check (replacement_cost is null or replacement_cost >= 0),
  supplier text,
  physical_location text,
  last_purchase_at timestamptz,
  notes text,
  barcode_value text,
  commerce_product_id uuid references public.commerce_products(id) on delete set null,
  commerce_variant_id uuid references public.commerce_product_variants(id) on delete set null,
  added_by_player_id uuid references public.players(id) on delete set null,
  added_by_user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint space_inventory_items_stock_source_shape check (
    (stock_source='managed' and commerce_product_id is null and commerce_variant_id is null)
    or (stock_source='commerce_product' and commerce_product_id is not null and commerce_variant_id is null)
    or (stock_source='commerce_variant' and commerce_product_id is not null and commerce_variant_id is not null)
  )
);

create index if not exists space_inventory_items_space_active_idx
  on public.space_inventory_items(space_id, active, category_id);
create index if not exists space_inventory_items_commerce_product_idx
  on public.space_inventory_items(commerce_product_id) where commerce_product_id is not null;
create unique index if not exists space_inventory_items_space_commerce_variant_unique
  on public.space_inventory_items(space_id, commerce_variant_id) where commerce_variant_id is not null;
create unique index if not exists space_inventory_items_space_commerce_product_unique
  on public.space_inventory_items(space_id, commerce_product_id)
  where stock_source='commerce_product' and commerce_product_id is not null;

create table if not exists public.space_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  item_id uuid not null references public.space_inventory_items(id) on delete restrict,
  delta numeric(18,4) not null check (delta <> 0),
  unit text not null,
  movement_type text not null check (movement_type in ('COMPRA','INGRESO','CONSUMO','VENTA','REGALO','ROTURA','PERDIDA','AJUSTE')),
  reason text,
  reference_type text,
  reference_id uuid,
  player_id uuid references public.players(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  quantity_before numeric(18,4),
  quantity_after numeric(18,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists space_inventory_movements_space_created_idx
  on public.space_inventory_movements(space_id, created_at desc);
create index if not exists space_inventory_movements_item_created_idx
  on public.space_inventory_movements(item_id, created_at desc);

create table if not exists public.space_inventory_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  item_id uuid references public.space_inventory_items(id) on delete set null,
  name text not null,
  quantity_needed numeric(18,4) not null default 1 check (quantity_needed > 0),
  unit text not null default 'unidad',
  priority text not null default 'normal' check (priority in ('baja','normal','alta','urgente')),
  estimated_price numeric(18,2) check (estimated_price is null or estimated_price >= 0),
  actual_price numeric(18,2) check (actual_price is null or actual_price >= 0),
  supplier text,
  receipt_url text,
  status text not null default 'pendiente' check (status in ('pendiente','comprado','ingresado','cancelado')),
  source text not null default 'manual' check (source in ('manual','stock_minimum')),
  added_by_player_id uuid references public.players(id) on delete set null,
  added_by_user_id uuid references auth.users(id) on delete set null,
  purchased_by_player_id uuid references public.players(id) on delete set null,
  purchased_by_user_id uuid references auth.users(id) on delete set null,
  entered_by_player_id uuid references public.players(id) on delete set null,
  entered_by_user_id uuid references auth.users(id) on delete set null,
  purchased_at timestamptz,
  entered_at timestamptz,
  inventory_movement_id uuid unique references public.space_inventory_movements(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists space_inventory_purchase_requests_space_status_idx
  on public.space_inventory_purchase_requests(space_id, status, priority, created_at desc);
create unique index if not exists space_inventory_purchase_requests_auto_open_unique
  on public.space_inventory_purchase_requests(space_id, item_id)
  where source='stock_minimum' and status in ('pendiente','comprado');

create table if not exists public.space_board_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null,
  description text,
  category text,
  price numeric(18,2) check (price is null or price >= 0),
  currency text not null default 'ARS',
  availability text not null default 'disponible' check (availability in ('disponible','agotado','pausado')),
  active boolean not null default true,
  image_url text,
  item_id uuid references public.space_inventory_items(id) on delete set null,
  commerce_product_id uuid references public.commerce_products(id) on delete set null,
  is_free boolean not null default false,
  display_order integer not null default 0,
  created_by_player_id uuid references public.players(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists space_board_entries_space_active_idx
  on public.space_board_entries(space_id, active, display_order);

-- Resolve the Player controlled by a user inside a Space. This keeps every movement attributable to a Player.
create or replace function private.space_player_for_user(p_space_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.player_id
  from public.space_members sm
  where sm.space_id = p_space_id
    and sm.status = 'active'
    and private.user_controls_player(p_user_id, sm.player_id)
  order by case sm.role when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end
  limit 1;
$$;

revoke all on function private.space_player_for_user(uuid,uuid) from public, anon, authenticated;

-- Atomic managed-stock movement. Commerce-linked items are intentionally rejected here:
-- their quantity remains canonical in commerce_products / commerce_product_variants.
create or replace function public.record_space_inventory_movement(
  p_item_id uuid,
  p_delta numeric,
  p_movement_type text,
  p_actor_user_id uuid,
  p_reason text default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.space_inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.space_inventory_items%rowtype;
  v_before numeric(18,4);
  v_after numeric(18,4);
  v_player_id uuid;
  v_movement public.space_inventory_movements%rowtype;
  v_needed numeric(18,4);
begin
  if p_actor_user_id is null or p_delta is null or p_delta = 0 then
    raise exception 'Movimiento inválido';
  end if;
  if p_movement_type not in ('COMPRA','INGRESO','CONSUMO','VENTA','REGALO','ROTURA','PERDIDA','AJUSTE') then
    raise exception 'Tipo de movimiento inválido';
  end if;

  select * into v_item from public.space_inventory_items where id=p_item_id and active=true for update;
  if not found then raise exception 'Ítem inexistente'; end if;
  if v_item.stock_source <> 'managed' then
    raise exception 'El stock de este ítem pertenece al Commerce canónico';
  end if;
  if not public.space_can(v_item.space_id, 'inventory') and not private.user_is_global_admin(p_actor_user_id) then
    -- space_can uses auth.uid(); service-role calls therefore also validate via the explicit role below.
    if private.space_role_for_user(v_item.space_id,p_actor_user_id) not in ('owner','admin','manager','inventory') then
      raise exception 'Sin permiso de inventario';
    end if;
  end if;

  v_player_id := private.space_player_for_user(v_item.space_id,p_actor_user_id);
  if v_player_id is null and not private.user_is_global_admin(p_actor_user_id) then
    raise exception 'El usuario no controla un Player activo de este Space';
  end if;

  v_before := v_item.quantity;
  v_after := v_before + p_delta;
  if v_after < 0 then raise exception 'Stock insuficiente'; end if;

  update public.space_inventory_items
  set quantity=v_after,
      last_purchase_at=case when p_movement_type='COMPRA' and p_delta>0 then now() else last_purchase_at end,
      updated_at=now()
  where id=v_item.id;

  insert into public.space_inventory_movements(
    space_id,item_id,delta,unit,movement_type,reason,reference_type,reference_id,
    player_id,user_id,quantity_before,quantity_after,metadata
  ) values (
    v_item.space_id,v_item.id,p_delta,v_item.unit,p_movement_type,p_reason,p_reference_type,p_reference_id,
    v_player_id,p_actor_user_id,v_before,v_after,coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_movement;

  if v_item.minimum_quantity > 0 and v_after <= v_item.minimum_quantity then
    v_needed := greatest(coalesce(v_item.ideal_quantity,v_item.minimum_quantity)-v_after, 0.0001);
    insert into public.space_inventory_purchase_requests(
      space_id,item_id,name,quantity_needed,unit,priority,estimated_price,supplier,status,source,
      added_by_player_id,added_by_user_id,notes
    ) values (
      v_item.space_id,v_item.id,v_item.name,v_needed,v_item.unit,'normal',
      case when v_item.replacement_cost is not null then v_item.replacement_cost * v_needed else null end,
      v_item.supplier,'pendiente','stock_minimum',v_player_id,p_actor_user_id,'Generado automáticamente por stock mínimo.'
    ) on conflict do nothing;
  end if;

  return v_movement;
end;
$$;

revoke all on function public.record_space_inventory_movement(uuid,numeric,text,uuid,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_space_inventory_movement(uuid,numeric,text,uuid,text,text,uuid,jsonb) to service_role;

create or replace function public.enter_space_inventory_purchase(
  p_purchase_id uuid,
  p_actor_user_id uuid
)
returns public.space_inventory_purchase_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.space_inventory_purchase_requests%rowtype;
  v_movement public.space_inventory_movements%rowtype;
  v_player_id uuid;
begin
  select * into v_purchase from public.space_inventory_purchase_requests where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente'; end if;
  if v_purchase.status='ingresado' then return v_purchase; end if;
  if v_purchase.item_id is null then raise exception 'La compra necesita un ítem asociado para ingresar stock'; end if;
  if private.space_role_for_user(v_purchase.space_id,p_actor_user_id) not in ('owner','admin','manager','inventory')
     and not private.user_is_global_admin(p_actor_user_id) then
    raise exception 'Sin permiso de inventario';
  end if;

  v_player_id := private.space_player_for_user(v_purchase.space_id,p_actor_user_id);
  select * into v_movement from public.record_space_inventory_movement(
    v_purchase.item_id,
    v_purchase.quantity_needed,
    'COMPRA',
    p_actor_user_id,
    'Ingreso desde compras pendientes',
    'space_inventory_purchase',
    v_purchase.id,
    jsonb_build_object('actual_price',v_purchase.actual_price,'estimated_price',v_purchase.estimated_price)
  );

  update public.space_inventory_purchase_requests
  set status='ingresado',entered_at=now(),entered_by_player_id=v_player_id,entered_by_user_id=p_actor_user_id,
      inventory_movement_id=v_movement.id,updated_at=now()
  where id=v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

revoke all on function public.enter_space_inventory_purchase(uuid,uuid) from public, anon, authenticated;
grant execute on function public.enter_space_inventory_purchase(uuid,uuid) to service_role;

alter table public.space_inventory_categories enable row level security;
alter table public.space_inventory_items enable row level security;
alter table public.space_inventory_movements enable row level security;
alter table public.space_inventory_purchase_requests enable row level security;
alter table public.space_board_entries enable row level security;

revoke all on public.space_inventory_categories from anon, authenticated;
revoke all on public.space_inventory_items from anon, authenticated;
revoke all on public.space_inventory_movements from anon, authenticated;
revoke all on public.space_inventory_purchase_requests from anon, authenticated;
revoke all on public.space_board_entries from anon, authenticated;

grant select on public.space_inventory_categories to authenticated;
grant select on public.space_inventory_items to authenticated;
grant select on public.space_inventory_movements to authenticated;
grant select on public.space_inventory_purchase_requests to authenticated;
grant select on public.space_board_entries to authenticated;

create policy space_inventory_categories_member_select on public.space_inventory_categories
for select to authenticated using (public.space_role_for_current_user(space_id) is not null);
create policy space_inventory_items_member_select on public.space_inventory_items
for select to authenticated using (public.space_role_for_current_user(space_id) is not null);
create policy space_inventory_movements_member_select on public.space_inventory_movements
for select to authenticated using (public.space_role_for_current_user(space_id) is not null);
create policy space_inventory_purchase_requests_member_select on public.space_inventory_purchase_requests
for select to authenticated using (public.space_role_for_current_user(space_id) is not null);
create policy space_board_entries_member_select on public.space_board_entries
for select to authenticated using (public.space_role_for_current_user(space_id) is not null);

-- 223 is the first real instance. These are data seeds, not application hardcodes.
with target as (select id from public.spaces where slug='223-social-club' limit 1),
seed(name,slug,display_order) as (values
  ('Estudio','estudio',10),
  ('Provisiones','provisiones',20),
  ('Herramientas','herramientas',30),
  ('Consumibles','consumibles',40),
  ('Artículos de limpieza','articulos-de-limpieza',50),
  ('Comida','comida',60),
  ('Bebidas','bebidas',70),
  ('Pinturas','pinturas',80),
  ('Tecnología','tecnologia',90),
  ('Auriculares','auriculares',100),
  ('Papelería','papeleria',110),
  ('Equipamiento','equipamiento',120),
  ('Jalea','jalea',130),
  ('Otros','otros',999)
)
insert into public.space_inventory_categories(space_id,name,slug,display_order)
select target.id,seed.name,seed.slug,seed.display_order from target cross join seed
on conflict(space_id,slug) do update set name=excluded.name,display_order=excluded.display_order,active=true,updated_at=now();

with target as (select id from public.spaces where slug='223-social-club' limit 1),
seed(name,description,category,is_free,display_order) as (values
  ('Horas de estudio','Sesiones y horas de estudio dentro de 223.','Estudio',false,10),
  ('Tragos','Tragos disponibles en el estudio.','Bebidas',false,20),
  ('Cervezas','Cervezas disponibles en el estudio.','Bebidas',false,30),
  ('Agua','Agua para artistas y Players.','Bebidas',true,40)
)
insert into public.space_board_entries(space_id,name,description,category,is_free,display_order,active,availability)
select target.id,seed.name,seed.description,seed.category,seed.is_free,seed.display_order,true,'disponible'
from target cross join seed
where not exists (
  select 1 from public.space_board_entries b where b.space_id=target.id and lower(b.name)=lower(seed.name)
);

commit;