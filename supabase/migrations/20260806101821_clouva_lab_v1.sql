begin;

create table if not exists public.ui_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  route text not null,
  platform text not null default 'responsive' check (platform in ('mobile', 'desktop', 'responsive')),
  draft_config jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_config) = 'object'),
  published_config jsonb not null default '{}'::jsonb check (jsonb_typeof(published_config) = 'object'),
  draft_revision integer not null default 1 check (draft_revision > 0),
  published_version integer not null default 0 check (published_version >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.ui_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.ui_pages(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'published' check (status in ('published', 'restored', 'imported')),
  source_version integer,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (page_id, version_number)
);

create table if not exists public.ui_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.ui_pages(id) on delete cascade,
  block_key text not null,
  block_type text not null,
  label text not null,
  editable_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(editable_fields) = 'array'),
  sort_order integer not null default 0,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (page_id, block_key)
);

create table if not exists public.ui_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('image', 'video', 'icon', 'audio', 'other')),
  url text not null,
  alt_text text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ui_feature_flags (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9_.-]*$'),
  description text,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists ui_page_versions_page_created_idx
  on public.ui_page_versions (page_id, version_number desc);
create index if not exists ui_blocks_page_order_idx
  on public.ui_blocks (page_id, sort_order, block_key);
create index if not exists ui_assets_kind_created_idx
  on public.ui_assets (kind, created_at desc);

alter table public.ui_pages enable row level security;
alter table public.ui_page_versions enable row level security;
alter table public.ui_blocks enable row level security;
alter table public.ui_assets enable row level security;
alter table public.ui_feature_flags enable row level security;

revoke all on public.ui_pages from anon;
revoke all on public.ui_page_versions from anon;
revoke all on public.ui_blocks from anon;
revoke all on public.ui_assets from anon;
revoke all on public.ui_feature_flags from anon;

grant select, insert, update, delete on public.ui_pages to authenticated;
grant select, insert, update, delete on public.ui_page_versions to authenticated;
grant select, insert, update, delete on public.ui_blocks to authenticated;
grant select, insert, update, delete on public.ui_assets to authenticated;
grant select, insert, update, delete on public.ui_feature_flags to authenticated;

drop policy if exists "clouva lab admins manage pages" on public.ui_pages;
create policy "clouva lab admins manage pages"
on public.ui_pages for all
to authenticated
using ((select private.is_clouva_admin()))
with check ((select private.is_clouva_admin()));

drop policy if exists "clouva lab admins manage versions" on public.ui_page_versions;
create policy "clouva lab admins manage versions"
on public.ui_page_versions for all
to authenticated
using ((select private.is_clouva_admin()))
with check ((select private.is_clouva_admin()));

drop policy if exists "clouva lab admins manage blocks" on public.ui_blocks;
create policy "clouva lab admins manage blocks"
on public.ui_blocks for all
to authenticated
using ((select private.is_clouva_admin()))
with check ((select private.is_clouva_admin()));

drop policy if exists "clouva lab admins manage assets" on public.ui_assets;
create policy "clouva lab admins manage assets"
on public.ui_assets for all
to authenticated
using ((select private.is_clouva_admin()))
with check ((select private.is_clouva_admin()));

drop policy if exists "clouva lab admins manage flags" on public.ui_feature_flags;
create policy "clouva lab admins manage flags"
on public.ui_feature_flags for all
to authenticated
using ((select private.is_clouva_admin()))
with check ((select private.is_clouva_admin()));

create or replace function public.ui_get_published_page(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'slug', p.slug,
    'name', p.name,
    'route', p.route,
    'platform', p.platform,
    'version', p.published_version,
    'published_at', p.published_at,
    'config', p.published_config
  )
  from public.ui_pages p
  where p.slug = p_slug
    and p.published_version > 0;
$$;

revoke all on function public.ui_get_published_page(text) from public;
grant execute on function public.ui_get_published_page(text) to anon, authenticated;

create or replace function public.ui_save_page_draft(p_slug text, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  next_page public.ui_pages%rowtype;
begin
  if not private.is_clouva_admin() then
    raise exception 'Acceso administrativo requerido';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'La configuración debe ser un objeto JSON';
  end if;

  update public.ui_pages
  set draft_config = p_config,
      draft_revision = draft_revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where slug = p_slug
  returning * into next_page;

  if not found then
    raise exception 'Página de interfaz inexistente: %', p_slug;
  end if;

  insert into public.admin_audit_logs(admin_user_id, action, module, target_type, target_id, metadata)
  values (
    auth.uid(),
    'save_ui_draft',
    'clouva_lab',
    'ui_page',
    next_page.id::text,
    jsonb_build_object('slug', next_page.slug, 'draft_revision', next_page.draft_revision)
  );

  return jsonb_build_object(
    'slug', next_page.slug,
    'draft_revision', next_page.draft_revision,
    'updated_at', next_page.updated_at,
    'config', next_page.draft_config
  );
end;
$$;

create or replace function public.ui_publish_page(p_slug text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  locked_page public.ui_pages%rowtype;
  next_version integer;
begin
  if not private.is_clouva_admin() then
    raise exception 'Acceso administrativo requerido';
  end if;

  select * into locked_page
  from public.ui_pages
  where slug = p_slug
  for update;

  if not found then
    raise exception 'Página de interfaz inexistente: %', p_slug;
  end if;

  next_version := locked_page.published_version + 1;

  insert into public.ui_page_versions(page_id, version_number, status, config, note, created_by)
  values (locked_page.id, next_version, 'published', locked_page.draft_config, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  update public.ui_pages
  set published_config = draft_config,
      published_version = next_version,
      published_by = auth.uid(),
      published_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where id = locked_page.id;

  insert into public.admin_audit_logs(admin_user_id, action, module, target_type, target_id, metadata)
  values (
    auth.uid(),
    'publish_ui_page',
    'clouva_lab',
    'ui_page',
    locked_page.id::text,
    jsonb_build_object('slug', locked_page.slug, 'version', next_version, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );

  return jsonb_build_object('slug', locked_page.slug, 'version', next_version, 'published_at', now());
end;
$$;

create or replace function public.ui_restore_page_version(
  p_slug text,
  p_version_number integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  locked_page public.ui_pages%rowtype;
  source_row public.ui_page_versions%rowtype;
  next_version integer;
begin
  if not private.is_clouva_admin() then
    raise exception 'Acceso administrativo requerido';
  end if;

  select * into locked_page
  from public.ui_pages
  where slug = p_slug
  for update;

  if not found then
    raise exception 'Página de interfaz inexistente: %', p_slug;
  end if;

  select * into source_row
  from public.ui_page_versions
  where page_id = locked_page.id
    and version_number = p_version_number;

  if not found then
    raise exception 'Versión inexistente: %', p_version_number;
  end if;

  next_version := locked_page.published_version + 1;

  insert into public.ui_page_versions(
    page_id,
    version_number,
    status,
    source_version,
    config,
    note,
    created_by
  )
  values (
    locked_page.id,
    next_version,
    'restored',
    source_row.version_number,
    source_row.config,
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Restauración de la versión ' || source_row.version_number),
    auth.uid()
  );

  update public.ui_pages
  set draft_config = source_row.config,
      published_config = source_row.config,
      draft_revision = draft_revision + 1,
      published_version = next_version,
      published_by = auth.uid(),
      published_at = now(),
      updated_by = auth.uid(),
      updated_at = now()
  where id = locked_page.id;

  insert into public.admin_audit_logs(admin_user_id, action, module, target_type, target_id, metadata)
  values (
    auth.uid(),
    'restore_ui_page',
    'clouva_lab',
    'ui_page',
    locked_page.id::text,
    jsonb_build_object('slug', locked_page.slug, 'source_version', source_row.version_number, 'new_version', next_version)
  );

  return jsonb_build_object(
    'slug', locked_page.slug,
    'source_version', source_row.version_number,
    'version', next_version,
    'published_at', now(),
    'config', source_row.config
  );
end;
$$;

revoke all on function public.ui_save_page_draft(text, jsonb) from public, anon;
revoke all on function public.ui_publish_page(text, text) from public, anon;
revoke all on function public.ui_restore_page_version(text, integer, text) from public, anon;
grant execute on function public.ui_save_page_draft(text, jsonb) to authenticated;
grant execute on function public.ui_publish_page(text, text) to authenticated;
grant execute on function public.ui_restore_page_version(text, integer, text) to authenticated;

insert into public.ui_pages (
  slug,
  name,
  route,
  platform,
  draft_config,
  published_config,
  draft_revision,
  published_version,
  published_at
)
values (
  'mobile-home',
  'Home mobile',
  '/',
  'mobile',
  $config${
    "schemaVersion": 1,
    "page": "mobile-home",
    "theme": {
      "backgroundColor": "#030307",
      "accentColor": "#9d3ef5",
      "accentSecondary": "#b251ff",
      "borderColor": "rgba(136,45,226,0.44)",
      "pagePadding": 16,
      "sectionGap": 11,
      "radius": 22,
      "glowStrength": 0.55
    },
    "header": {
      "logoText": "CLOUVA",
      "brandAvatarUrl": "/assets/home-mobile/brand-avatar.webp",
      "showBrandAvatar": true,
      "showNotificationDot": true
    },
    "hero": {
      "eyebrow": "Bienvenido de nuevo",
      "title": "Crea. Personaliza.\nConecta.",
      "subtitle": "Viví tu propio mundo.",
      "imageUrl": "/assets/home-mobile/hero.webp",
      "height": 310,
      "textWidth": 58,
      "contentPaddingLeft": 22,
      "primaryLabel": "Entrar a mi Avatar",
      "primaryHref": "/mi-flow/avatar",
      "secondaryLabel": "Explorar Mundos",
      "secondaryHref": "/matrix"
    },
    "music": {
      "visible": true,
      "coverUrl": "/assets/home-mobile/music-cover.webp",
      "title": "Vida de Flows",
      "artist": "Clouva",
      "currentTime": "1:32",
      "duration": "3:24",
      "progress": 61,
      "favoriteDefault": true
    },
    "cards": {
      "continue": {
        "visible": true,
        "title": "Continuar\ncreando",
        "body": "Seguí diseñando\ntu próximo ítem.",
        "imageUrl": "/assets/home-mobile/continue.webp",
        "href": "/creator-studio"
      },
      "iglu": {
        "visible": true,
        "title": "Entrar\nal Iglú",
        "body": "Tu estudio.\nTu música.\nTu universo.",
        "imageUrl": "/assets/home-mobile/iglu.webp",
        "href": "/studios/iglu"
      }
    },
    "navigation": {
      "homeLabel": "Inicio",
      "avatarLabel": "Avatar",
      "createLabel": "Crear",
      "marketplaceLabel": "Marketplace"
    },
    "sections": ["hero", "music", "features"]
  }$config$::jsonb,
  $config${
    "schemaVersion": 1,
    "page": "mobile-home",
    "theme": {
      "backgroundColor": "#030307",
      "accentColor": "#9d3ef5",
      "accentSecondary": "#b251ff",
      "borderColor": "rgba(136,45,226,0.44)",
      "pagePadding": 16,
      "sectionGap": 11,
      "radius": 22,
      "glowStrength": 0.55
    },
    "header": {
      "logoText": "CLOUVA",
      "brandAvatarUrl": "/assets/home-mobile/brand-avatar.webp",
      "showBrandAvatar": true,
      "showNotificationDot": true
    },
    "hero": {
      "eyebrow": "Bienvenido de nuevo",
      "title": "Crea. Personaliza.\nConecta.",
      "subtitle": "Viví tu propio mundo.",
      "imageUrl": "/assets/home-mobile/hero.webp",
      "height": 310,
      "textWidth": 58,
      "contentPaddingLeft": 22,
      "primaryLabel": "Entrar a mi Avatar",
      "primaryHref": "/mi-flow/avatar",
      "secondaryLabel": "Explorar Mundos",
      "secondaryHref": "/matrix"
    },
    "music": {
      "visible": true,
      "coverUrl": "/assets/home-mobile/music-cover.webp",
      "title": "Vida de Flows",
      "artist": "Clouva",
      "currentTime": "1:32",
      "duration": "3:24",
      "progress": 61,
      "favoriteDefault": true
    },
    "cards": {
      "continue": {
        "visible": true,
        "title": "Continuar\ncreando",
        "body": "Seguí diseñando\ntu próximo ítem.",
        "imageUrl": "/assets/home-mobile/continue.webp",
        "href": "/creator-studio"
      },
      "iglu": {
        "visible": true,
        "title": "Entrar\nal Iglú",
        "body": "Tu estudio.\nTu música.\nTu universo.",
        "imageUrl": "/assets/home-mobile/iglu.webp",
        "href": "/studios/iglu"
      }
    },
    "navigation": {
      "homeLabel": "Inicio",
      "avatarLabel": "Avatar",
      "createLabel": "Crear",
      "marketplaceLabel": "Marketplace"
    },
    "sections": ["hero", "music", "features"]
  }$config$::jsonb,
  1,
  1,
  now()
)
on conflict (slug) do nothing;

insert into public.ui_page_versions(page_id, version_number, status, config, note)
select p.id, 1, 'imported', p.published_config, 'Versión inicial importada desde la Home mobile existente'
from public.ui_pages p
where p.slug = 'mobile-home'
  and not exists (
    select 1 from public.ui_page_versions v where v.page_id = p.id and v.version_number = 1
  );

insert into public.ui_blocks(page_id, block_key, block_type, label, editable_fields, sort_order, is_required)
select p.id, block.block_key, block.block_type, block.label, block.editable_fields, block.sort_order, block.is_required
from public.ui_pages p
cross join (
  values
    ('header', 'header', 'Header', '["logoText","brandAvatarUrl","showBrandAvatar","showNotificationDot"]'::jsonb, 0, true),
    ('hero', 'hero', 'Hero principal', '["eyebrow","title","subtitle","imageUrl","height","textWidth","contentPaddingLeft","primaryLabel","primaryHref","secondaryLabel","secondaryHref"]'::jsonb, 10, true),
    ('music', 'music-player', 'Reproductor musical', '["visible","coverUrl","title","artist","currentTime","duration","progress","favoriteDefault"]'::jsonb, 20, false),
    ('continue', 'feature-card', 'Continuar creando', '["visible","title","body","imageUrl","href"]'::jsonb, 30, false),
    ('iglu', 'feature-card', 'Entrar al Iglú', '["visible","title","body","imageUrl","href"]'::jsonb, 40, false),
    ('navigation', 'bottom-navigation', 'Navegación inferior', '["homeLabel","avatarLabel","createLabel","marketplaceLabel"]'::jsonb, 50, true)
) as block(block_key, block_type, label, editable_fields, sort_order, is_required)
where p.slug = 'mobile-home'
on conflict (page_id, block_key) do nothing;

insert into public.ui_feature_flags(key, description, enabled, config)
values (
  'clouva_lab.enabled',
  'Habilita el editor visual administrado de CLOUVA Lab.',
  true,
  '{"version":1}'::jsonb
)
on conflict (key) do nothing;

commit;
