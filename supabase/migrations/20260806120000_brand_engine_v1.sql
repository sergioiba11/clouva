-- CLOUVA Logo Engine -- Fase 1: registro central de marca (brand_assets/
-- brand_asset_versions/brand_generation_jobs/brand_asset_links) + conexión
-- con el generador de páginas VIP existente (player_profile_versions gana
-- brand_asset_version_id) + publish_player_profile_version gana un flag
-- explícito para nunca promover un logo a identidad oficial sin confirmación.
--
-- Reglas de producto que este esquema tiene que sostener (sesión 2026-08-06):
-- 1. Un logo oficial (brand_asset_versions.status = 'published') nunca se
--    rediseña automáticamente por subir otro mockup -- eso lo aplica la
--    lógica de lib/server/brand-engine/resolve-brand-asset.ts, no el schema,
--    pero el schema deja constancia de cuál versión está "published" (índice
--    único parcial, mismo patrón que player_profile_versions).
-- 2. Publicar una página nunca publica el logo solo -- publish_player_profile_
--    version ahora requiere p_publish_logo_too = true explícito para
--    promover el brand_asset_version ligado.
-- 3. brand_asset_links no permite el mismo vínculo duplicado.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('player', 'studio')),
  owner_id uuid not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  active_version_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Un brand_asset activo por dueño -- mismo principio que "una versión
-- publicada por Player/Estudio" en player_profile_versions.
create unique index brand_assets_one_active_per_owner
  on public.brand_assets(owner_type, owner_id)
  where status = 'active';

create index brand_assets_owner_idx on public.brand_assets(owner_type, owner_id);

create table public.brand_asset_versions (
  id uuid primary key default gen_random_uuid(),
  brand_asset_id uuid not null references public.brand_assets(id) on delete cascade,
  source_type text not null check (source_type in (
    'standalone', 'website_mockup', 'uploaded_logo', 'sketch', 'brand_reference', 'identity_brief'
  )),
  source_mockup_url text,
  primary_logo_url text,
  symbol_logo_url text,
  horizontal_logo_url text,
  vertical_logo_url text,
  square_logo_url text,
  transparent_logo_url text,
  white_logo_url text,
  black_logo_url text,
  favicon_url text,
  palette jsonb not null default '[]'::jsonb,
  visual_analysis jsonb not null default '{}'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  fingerprint jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  created_at timestamptz not null default now()
);

create index brand_asset_versions_asset_idx on public.brand_asset_versions(brand_asset_id);
-- Un publicado por brand_asset, mismo patrón que player_profile_versions.
create unique index brand_asset_versions_one_published_per_asset
  on public.brand_asset_versions(brand_asset_id)
  where status = 'published';

alter table public.brand_assets
  add constraint brand_assets_active_version_fk
  foreign key (active_version_id) references public.brand_asset_versions(id) on delete set null;

create table public.brand_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('player', 'studio')),
  owner_id uuid not null,
  status text not null default 'queued' check (status in (
    'queued', 'analyzing_source', 'detecting_logo', 'generating_candidates',
    'checking_uniqueness', 'awaiting_review', 'completed', 'failed'
  )),
  source text not null check (source in (
    'standalone', 'website_mockup', 'uploaded_logo', 'sketch', 'brand_reference', 'identity_brief'
  )),
  reference_image_urls jsonb not null default '[]'::jsonb,
  identity_facts jsonb not null default '{}'::jsonb,
  detected_logo jsonb not null default '{}'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  result_brand_asset_version_id uuid references public.brand_asset_versions(id) on delete set null,
  actual_cost_usd numeric(10,4),
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index brand_generation_jobs_owner_idx on public.brand_generation_jobs(owner_type, owner_id);
create index brand_generation_jobs_status_idx on public.brand_generation_jobs(status);

create table public.brand_asset_links (
  id uuid primary key default gen_random_uuid(),
  brand_asset_id uuid not null references public.brand_assets(id) on delete cascade,
  linked_type text not null check (linked_type in ('player_profile', 'studio_profile', 'page_version', 'project', 'product')),
  linked_id uuid not null,
  created_at timestamptz not null default now(),
  unique (brand_asset_id, linked_type, linked_id)
);

create index brand_asset_links_asset_idx on public.brand_asset_links(brand_asset_id);
create index brand_asset_links_linked_idx on public.brand_asset_links(linked_type, linked_id);

-- Cada versión de página generada guarda también el logo que usó -- "punto 4"
-- del pedido original ("Guardar también brand_asset_id en cada versión
-- generada"). Nullable: versiones viejas (pre-brand-engine) y las que no
-- pasaron por generación de logo (ej. reutilizando el oficial ya aprobado sin
-- ninguna adaptación) no tienen por qué tener una.
alter table public.player_profile_versions
  add column if not exists brand_asset_version_id uuid references public.brand_asset_versions(id) on delete set null;

-- Mismo campo en el job -- generating_assets (donde se resuelve el logo) y
-- assembling_profile (donde se inserta la versión final) son pasos HTTP
-- separados dentro del mismo state machine (Cloud Tasks los reinvoca uno por
-- uno); el resultado tiene que sobrevivir entre ambos igual que ya hacen
-- generated_assets/generated_layout.
alter table public.vip_profile_generation_jobs
  add column if not exists brand_asset_version_id uuid references public.brand_asset_versions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS -- mismo patrón que vip_profile_generation_jobs/player_profile_versions:
-- lectura para el dueño (owner/manager/editor del Player o Estudio) o admin;
-- toda escritura pasa por el service role desde las rutas API / el motor.
-- ---------------------------------------------------------------------------

alter table public.brand_assets enable row level security;
alter table public.brand_asset_versions enable row level security;
alter table public.brand_generation_jobs enable row level security;
alter table public.brand_asset_links enable row level security;

create policy brand_assets_select_owner_or_admin
  on public.brand_assets for select
  using (
    (owner_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = brand_assets.owner_id
        and m.user_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and (
      exists (
        select 1 from public.studio_members m
        where m.studio_id = brand_assets.owner_id
          and m.profile_id = auth.uid() and m.status = 'active'
          and m.role in ('owner', 'admin', 'manager', 'editor')
      )
      or exists (select 1 from public.studios s where s.id = brand_assets.owner_id and s.owner_id = auth.uid())
    ))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy brand_assets_admin_write
  on public.brand_assets for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy brand_asset_versions_select_owner_or_admin
  on public.brand_asset_versions for select
  using (
    exists (
      select 1 from public.brand_assets a
      where a.id = brand_asset_versions.brand_asset_id
        and (
          (a.owner_type = 'player' and exists (
            select 1 from public.player_members m
            where m.player_id = a.owner_id and m.user_id = auth.uid() and m.status = 'active'
              and m.role in ('owner', 'manager', 'editor')
          ))
          or (a.owner_type = 'studio' and (
            exists (
              select 1 from public.studio_members m
              where m.studio_id = a.owner_id and m.profile_id = auth.uid() and m.status = 'active'
                and m.role in ('owner', 'admin', 'manager', 'editor')
            )
            or exists (select 1 from public.studios s where s.id = a.owner_id and s.owner_id = auth.uid())
          ))
        )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy brand_asset_versions_admin_write
  on public.brand_asset_versions for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy brand_generation_jobs_select_owner_or_admin
  on public.brand_generation_jobs for select
  using (
    (owner_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = brand_generation_jobs.owner_id
        and m.user_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and (
      exists (
        select 1 from public.studio_members m
        where m.studio_id = brand_generation_jobs.owner_id
          and m.profile_id = auth.uid() and m.status = 'active'
          and m.role in ('owner', 'admin', 'manager', 'editor')
      )
      or exists (select 1 from public.studios s where s.id = brand_generation_jobs.owner_id and s.owner_id = auth.uid())
    ))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy brand_generation_jobs_admin_write
  on public.brand_generation_jobs for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy brand_asset_links_select_owner_or_admin
  on public.brand_asset_links for select
  using (
    exists (
      select 1 from public.brand_assets a
      where a.id = brand_asset_links.brand_asset_id
        and (
          (a.owner_type = 'player' and exists (
            select 1 from public.player_members m
            where m.player_id = a.owner_id and m.user_id = auth.uid() and m.status = 'active'
              and m.role in ('owner', 'manager', 'editor')
          ))
          or (a.owner_type = 'studio' and (
            exists (
              select 1 from public.studio_members m
              where m.studio_id = a.owner_id and m.profile_id = auth.uid() and m.status = 'active'
                and m.role in ('owner', 'admin', 'manager', 'editor')
            )
            or exists (select 1 from public.studios s where s.id = a.owner_id and s.owner_id = auth.uid())
          ))
        )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy brand_asset_links_admin_write
  on public.brand_asset_links for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- publish_brand_asset_version -- promueve una versión de marca a oficial:
-- archiva la publicada anterior del mismo brand_asset, marca la elegida como
-- 'published', actualiza brand_assets.active_version_id y sincroniza
-- players.logo_url/studios.logo_url. Es el único lugar que hace esa
-- sincronización -- tanto /logo (aprobar directo) como
-- publish_player_profile_version (cuando p_publish_logo_too = true) llaman a
-- esta misma función en vez de duplicar la lógica.
-- ---------------------------------------------------------------------------

create or replace function public.publish_brand_asset_version(p_version_id uuid)
returns public.brand_asset_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_asset_id uuid;
  v_owner_type text;
  v_owner_id uuid;
  v_status text;
  v_result public.brand_asset_versions%rowtype;
begin
  select v.brand_asset_id, v.status into v_brand_asset_id, v_status
  from public.brand_asset_versions v
  where v.id = p_version_id
  for update;

  if not found then
    raise exception 'La versión de marca no existe.';
  end if;

  select a.owner_type, a.owner_id into v_owner_type, v_owner_id
  from public.brand_assets a
  where a.id = v_brand_asset_id
  for update;

  update public.brand_asset_versions
  set status = 'approved'
  where brand_asset_id = v_brand_asset_id
    and status = 'published'
    and id != p_version_id;

  update public.brand_asset_versions
  set status = 'published'
  where id = p_version_id
  returning * into v_result;

  update public.brand_assets
  set active_version_id = p_version_id
  where id = v_brand_asset_id;

  if v_owner_type = 'player' then
    update public.players
    set logo_url = coalesce(v_result.primary_logo_url, logo_url)
    where id = v_owner_id;
  else
    update public.studios
    set logo_url = coalesce(v_result.primary_logo_url, logo_url)
    where id = v_owner_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_brand_asset_version(uuid) from public, anon, authenticated;
grant execute on function public.publish_brand_asset_version(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- publish_player_profile_version: gana p_publish_logo_too. Sin ese flag en
-- true, el logo_url de players/studios NO se toca (antes se sincronizaba
-- siempre desde asset_references -- eso es exactamente lo que ya no debe
-- pasar sin confirmación explícita del usuario). cover_url y el resto de la
-- identidad siguen sincronizando siempre, sin cambios -- la regla nueva es
-- específica del logo.
-- ---------------------------------------------------------------------------

-- Postgres trata (uuid) y (uuid, boolean) como sobrecargas DISTINTAS -- sin
-- este drop explícito, la función vieja (que todavía sincroniza logo_url sin
-- confirmación) quedaría viva en paralelo a la nueva, lista para que
-- cualquier llamada con un solo argumento reintroduzca el bug.
drop function if exists public.publish_player_profile_version(uuid);

create or replace function public.publish_player_profile_version(p_version_id uuid, p_publish_logo_too boolean default false)
returns public.player_profile_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_studio_id uuid;
  v_status text;
  v_result public.player_profile_versions%rowtype;
  v_cover_url text;
  v_palette text[];
begin
  select player_id, studio_id, status into v_player_id, v_studio_id, v_status
  from public.player_profile_versions
  where id = p_version_id
  for update;

  if not found then
    raise exception 'La versión no existe.';
  end if;
  if v_status = 'archived' then
    raise exception 'No se puede publicar una versión archivada.';
  end if;

  update public.player_profile_versions
  set status = 'archived'
  where coalesce(player_id, studio_id) = coalesce(v_player_id, v_studio_id)
    and status = 'published'
    and id != p_version_id;

  update public.player_profile_versions
  set status = 'published', published_at = now()
  where id = p_version_id
  returning * into v_result;

  select item->>'url' into v_cover_url
  from jsonb_array_elements(v_result.asset_references) item
  where item->>'kind' = 'cover'
  limit 1;

  select array_agg(value) into v_palette
  from jsonb_array_elements_text(coalesce(v_result.visual_config->'palette', '[]'::jsonb)) value;

  if v_player_id is not null then
    update public.players
    set
      cover_url = coalesce(v_cover_url, cover_url),
      palette = coalesce(v_palette, palette),
      accent_color = coalesce(v_palette[1], accent_color),
      tagline = coalesce(v_result.copy_config->>'tagline', tagline),
      short_bio = coalesce(v_result.copy_config->>'short_bio', short_bio),
      seo_title = coalesce(v_result.copy_config->>'seo_title', seo_title),
      seo_description = coalesce(v_result.copy_config->>'seo_description', seo_description),
      share_title = coalesce(v_result.copy_config->>'share_title', share_title),
      share_description = coalesce(v_result.copy_config->>'share_description', share_description),
      og_image_url = coalesce(v_cover_url, og_image_url)
    where id = v_player_id;
  else
    update public.studios
    set
      cover_url = coalesce(v_cover_url, cover_url),
      palette = coalesce(v_palette, palette),
      accent_color = coalesce(v_palette[1], accent_color),
      tagline = coalesce(v_result.copy_config->>'tagline', tagline),
      short_bio = coalesce(v_result.copy_config->>'short_bio', short_bio),
      seo_title = coalesce(v_result.copy_config->>'seo_title', seo_title),
      seo_description = coalesce(v_result.copy_config->>'seo_description', seo_description),
      share_title = coalesce(v_result.copy_config->>'share_title', share_title),
      share_description = coalesce(v_result.copy_config->>'share_description', share_description),
      og_image_url = coalesce(v_cover_url, og_image_url)
    where id = v_studio_id;
  end if;

  -- El logo NUNCA se sincroniza acá sin confirmación explícita -- p_publish_
  -- logo_too en true es esa confirmación (viene del diálogo que ve el
  -- usuario al publicar). Reusa publish_brand_asset_version en vez de
  -- duplicar la lógica de sincronización.
  if p_publish_logo_too and v_result.brand_asset_version_id is not null then
    perform public.publish_brand_asset_version(v_result.brand_asset_version_id);
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_player_profile_version(uuid, boolean) from public, anon, authenticated;
grant execute on function public.publish_player_profile_version(uuid, boolean) to service_role;
