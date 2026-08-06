-- CLOUVA Logo Engine V3: importación fiel de identidades reales, declaración
-- de titularidad y clearance interno/externo. Migración completamente aditiva.

create table if not exists public.brand_clearance_checks (
  id uuid primary key default gen_random_uuid(),
  brand_asset_version_id uuid not null references public.brand_asset_versions(id) on delete cascade,
  owner_type text not null check (owner_type in ('player', 'studio')),
  owner_id uuid not null,
  status text not null check (status in (
    'clear',
    'review_required',
    'blocked_internal_duplicate',
    'blocked_external_name_conflict',
    'blocked_external_visual_conflict',
    'blocked_combined_conflict',
    'external_check_unavailable'
  )),
  internal_similarity_score numeric,
  external_name_risk_score numeric,
  external_visual_risk_score numeric,
  class_overlap_score numeric,
  sources_checked jsonb not null default '[]'::jsonb,
  internal_matches jsonb not null default '[]'::jsonb,
  external_matches jsonb not null default '[]'::jsonb,
  decision_reasons jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists brand_clearance_checks_version_idx
  on public.brand_clearance_checks(brand_asset_version_id, checked_at desc);
create index if not exists brand_clearance_checks_owner_idx
  on public.brand_clearance_checks(owner_type, owner_id);
create index if not exists brand_clearance_checks_status_idx
  on public.brand_clearance_checks(status);

alter table public.brand_asset_versions
  add column if not exists import_mode text,
  add column if not exists source_crop jsonb,
  add column if not exists original_asset_url text,
  add column if not exists cleaned_asset_url text,
  add column if not exists standalone_symbol_available boolean not null default false,
  add column if not exists clearance_status text,
  add column if not exists clearance_check_id uuid references public.brand_clearance_checks(id) on delete set null,
  add column if not exists ownership_attested boolean not null default false,
  add column if not exists ownership_attested_by uuid references auth.users(id) on delete set null,
  add column if not exists ownership_attested_at timestamptz,
  add column if not exists source_kind text,
  add column if not exists source_note text;

alter table public.brand_asset_versions drop constraint if exists brand_asset_versions_import_mode_check;
alter table public.brand_asset_versions
  add constraint brand_asset_versions_import_mode_check
  check (import_mode is null or import_mode in ('real_identity_import', 'clouva_generated_redesign', 'standalone_creation'));

alter table public.brand_asset_versions drop constraint if exists brand_asset_versions_clearance_status_check;
alter table public.brand_asset_versions
  add constraint brand_asset_versions_clearance_status_check
  check (clearance_status is null or clearance_status in (
    'clear',
    'review_required',
    'blocked_internal_duplicate',
    'blocked_external_name_conflict',
    'blocked_external_visual_conflict',
    'blocked_combined_conflict',
    'external_check_unavailable'
  ));

alter table public.brand_asset_versions drop constraint if exists brand_asset_versions_source_kind_check;
alter table public.brand_asset_versions
  add constraint brand_asset_versions_source_kind_check
  check (source_kind is null or source_kind in ('own_logo_file', 'own_mockup', 'designer_delivery', 'reference_only'));

-- Nuevos estados operativos del job. No se toca ninguna fila existente.
alter table public.brand_generation_jobs drop constraint if exists brand_generation_jobs_status_check;
alter table public.brand_generation_jobs
  add constraint brand_generation_jobs_status_check
  check (status in (
    'queued', 'analyzing_source', 'detecting_logo', 'importing_identity',
    'generating_candidates', 'checking_uniqueness', 'checking_clearance',
    'awaiting_review', 'completed', 'failed'
  ));

alter table public.brand_clearance_checks enable row level security;

create policy brand_clearance_checks_select_owner_or_admin
  on public.brand_clearance_checks for select
  using (
    (owner_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = brand_clearance_checks.owner_id
        and m.user_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and (
      exists (
        select 1 from public.studio_members m
        where m.studio_id = brand_clearance_checks.owner_id
          and m.profile_id = auth.uid() and m.status = 'active'
          and m.role in ('owner', 'admin', 'manager', 'editor')
      )
      or exists (select 1 from public.studios s where s.id = brand_clearance_checks.owner_id and s.owner_id = auth.uid())
    ))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy brand_clearance_checks_admin_write
  on public.brand_clearance_checks for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- La base también aplica la compuerta; no se confía en el frontend ni solo
-- en la ruta API. `external_check_unavailable` y `review_required` no publican.
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
  v_clearance_status text;
  v_ownership_attested boolean;
  v_result public.brand_asset_versions%rowtype;
begin
  select v.brand_asset_id, v.status, v.clearance_status, v.ownership_attested
    into v_brand_asset_id, v_status, v_clearance_status, v_ownership_attested
  from public.brand_asset_versions v
  where v.id = p_version_id
  for update;

  if not found then
    raise exception 'La versión de marca no existe.';
  end if;
  if v_status = 'rejected' then
    raise exception 'Una identidad rechazada no puede publicarse.';
  end if;
  if coalesce(v_ownership_attested, false) is not true then
    raise exception 'Falta la declaración de titularidad o autorización de uso.';
  end if;
  if v_clearance_status is distinct from 'clear' then
    if v_clearance_status in (
      'blocked_internal_duplicate',
      'blocked_external_name_conflict',
      'blocked_external_visual_conflict',
      'blocked_combined_conflict'
    ) then
      raise exception 'Esta identidad presenta un conflicto y no puede publicarse.';
    end if;
    raise exception 'La identidad todavía requiere revisión de originalidad y propiedad intelectual.';
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
