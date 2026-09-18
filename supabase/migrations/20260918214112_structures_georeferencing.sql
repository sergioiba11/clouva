-- CLOUVA Structures — georeferencing, synchronized map/3D and spatial features.
-- Extends the existing Structures schema without removing or renaming legacy fields.

alter table public.structures
  add column if not exists origin_alt double precision,
  add column if not exists north_rotation_deg double precision not null default 0,
  add column if not exists map_zoom double precision,
  add column if not exists map_type text not null default 'satellite';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'structures_map_type_check'
  ) then
    alter table public.structures
      add constraint structures_map_type_check
      check (map_type in ('roadmap','satellite'));
  end if;
end $$;

alter table public.structure_camera_nodes
  add column if not exists position_x double precision,
  add column if not exists position_y double precision,
  add column if not exists position_z double precision,
  add column if not exists spatial_status text;

create table if not exists public.structure_spatial_features (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  feature_type text not null,
  name text,
  geometry jsonb not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint structure_spatial_features_type_check
    check (feature_type in (
      'reference_point',
      'building_footprint',
      'lot',
      'court',
      'patio',
      'sidewalk',
      'street',
      'wall',
      'custom'
    ))
);

create index if not exists structure_spatial_features_structure_idx
  on public.structure_spatial_features(structure_id, feature_type, updated_at desc);

alter table public.structure_spatial_features enable row level security;

drop policy if exists structure_spatial_features_owner_all on public.structure_spatial_features;
create policy structure_spatial_features_owner_all on public.structure_spatial_features
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_spatial_features.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_spatial_features.structure_id
    and s.owner_id = (select auth.uid())
));

revoke all on table public.structure_spatial_features from anon;
grant select, insert, update, delete on table public.structure_spatial_features to authenticated, service_role;

comment on table public.structure_spatial_features is
  'Reusable GeoJSON spatial features shared by Google Maps, the local metric 3D world and future reconstruction tools.';
comment on column public.structures.origin_alt is
  'Optional altitude of the local metric world origin in meters.';
comment on column public.structures.north_rotation_deg is
  'Clockwise rotation used to align geographic north with the Structures local world.';
comment on column public.structure_camera_nodes.position_x is
  'Local metric X axis: east after north rotation.';
comment on column public.structure_camera_nodes.position_y is
  'Local metric Y axis: altitude.';
comment on column public.structure_camera_nodes.position_z is
  'Local metric Z axis: south after north rotation.';
