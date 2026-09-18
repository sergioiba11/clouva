-- CLOUVA Structures
-- Spatial evidence projects built from real photos/screenshots.
-- Binary media stays in the existing CLOUVA generated-media GCS bucket.
-- Supabase stores ownership, spatial metadata, graph relations and render history.

create table if not exists public.structures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  structure_type text not null default 'building',
  description text,
  location_name text,
  latitude double precision,
  longitude double precision,
  origin_latitude double precision,
  origin_longitude double precision,
  historical_notes text,
  reconstruction_rules jsonb not null default '[]'::jsonb,
  blockout jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','uploading','analyzing','spatializing','review','ready','rendering','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.structure_upload_batches (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  source_name text,
  source_kind text not null default 'files' check (source_kind in ('files','zip')),
  status text not null default 'uploading' check (status in ('uploading','completed','failed')),
  file_count integer not null default 0 check (file_count >= 0),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.structure_images (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  batch_id uuid references public.structure_upload_batches(id) on delete set null,
  storage_path text not null,
  public_url text not null,
  original_filename text not null,
  original_path text,
  ordered_filename text,
  width integer,
  height integer,
  mime_type text not null,
  byte_size bigint not null default 0 check (byte_size >= 0),
  sha256 text not null,
  perceptual_hash text,
  source_type text not null default 'unknown',
  latitude double precision,
  longitude double precision,
  altitude double precision,
  heading double precision,
  pitch double precision,
  roll double precision,
  fov double precision,
  local_x double precision,
  local_y double precision,
  local_z double precision,
  cardinal_direction text,
  sector text,
  scene_type text,
  description text,
  visible_surfaces jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  priority integer not null default 0,
  manual_verified boolean not null default false,
  duplicate_of uuid references public.structure_images(id) on delete set null,
  analysis_status text not null default 'uploaded'
    check (analysis_status in ('uploaded','metadata_ready','analyzing','analyzed','needs_review','verified','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.structure_surfaces (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  parent_id uuid references public.structure_surfaces(id) on delete set null,
  slug text not null,
  name text not null,
  type text not null default 'landmark',
  geometry jsonb not null default '{}'::jsonb,
  orientation double precision,
  materials jsonb not null default '[]'::jsonb,
  notes text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (structure_id, slug)
);

create table if not exists public.structure_image_surface_links (
  structure_id uuid not null references public.structures(id) on delete cascade,
  image_id uuid not null references public.structure_images(id) on delete cascade,
  surface_id uuid not null references public.structure_surfaces(id) on delete cascade,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source text not null default 'analysis',
  created_at timestamptz not null default now(),
  primary key (image_id, surface_id)
);

create table if not exists public.structure_camera_nodes (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  image_id uuid not null unique references public.structure_images(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  altitude double precision,
  local_x double precision,
  local_y double precision,
  local_z double precision,
  heading double precision,
  pitch double precision,
  roll double precision,
  fov double precision,
  target_x double precision,
  target_y double precision,
  target_z double precision,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.structure_rules (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  rule text not null,
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.structure_render_jobs (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.structures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','rendering','partial','completed','failed')),
  views_requested jsonb not null default '[]'::jsonb,
  input_manifest jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists public.structure_render_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.structure_render_jobs(id) on delete cascade,
  structure_id uuid not null references public.structures(id) on delete cascade,
  view_key text not null,
  prompt text not null,
  reference_image_ids jsonb not null default '[]'::jsonb,
  storage_path text not null,
  public_url text not null,
  mime_type text not null,
  provider_operation_id text,
  created_at timestamptz not null default now(),
  unique (job_id, view_key)
);

create index if not exists structures_owner_idx on public.structures(owner_id, updated_at desc);
create index if not exists structure_images_structure_idx on public.structure_images(structure_id, created_at);
create index if not exists structure_images_spatial_idx on public.structure_images(structure_id, latitude desc, longitude, heading);
create index if not exists structure_images_status_idx on public.structure_images(structure_id, analysis_status);
create index if not exists structure_images_hash_idx on public.structure_images(structure_id, sha256);
create index if not exists structure_surfaces_structure_idx on public.structure_surfaces(structure_id);
create index if not exists structure_camera_nodes_structure_idx on public.structure_camera_nodes(structure_id);
create index if not exists structure_rules_structure_idx on public.structure_rules(structure_id, active, priority desc);
create index if not exists structure_render_jobs_structure_idx on public.structure_render_jobs(structure_id, created_at desc);
create index if not exists structure_render_outputs_structure_idx on public.structure_render_outputs(structure_id, created_at desc);

alter table public.structures enable row level security;
alter table public.structure_upload_batches enable row level security;
alter table public.structure_images enable row level security;
alter table public.structure_surfaces enable row level security;
alter table public.structure_image_surface_links enable row level security;
alter table public.structure_camera_nodes enable row level security;
alter table public.structure_rules enable row level security;
alter table public.structure_render_jobs enable row level security;
alter table public.structure_render_outputs enable row level security;

drop policy if exists structures_owner_all on public.structures;
create policy structures_owner_all on public.structures
for all to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

drop policy if exists structure_upload_batches_owner_all on public.structure_upload_batches;
create policy structure_upload_batches_owner_all on public.structure_upload_batches
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_upload_batches.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_upload_batches.structure_id
    and s.owner_id = (select auth.uid())
));

drop policy if exists structure_images_owner_all on public.structure_images;
create policy structure_images_owner_all on public.structure_images
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_images.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_images.structure_id
    and s.owner_id = (select auth.uid())
));

drop policy if exists structure_surfaces_owner_all on public.structure_surfaces;
create policy structure_surfaces_owner_all on public.structure_surfaces
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_surfaces.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_surfaces.structure_id
    and s.owner_id = (select auth.uid())
));

drop policy if exists structure_image_surface_links_owner_all on public.structure_image_surface_links;
create policy structure_image_surface_links_owner_all on public.structure_image_surface_links
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_image_surface_links.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_image_surface_links.structure_id
    and s.owner_id = (select auth.uid())
));

drop policy if exists structure_camera_nodes_owner_all on public.structure_camera_nodes;
create policy structure_camera_nodes_owner_all on public.structure_camera_nodes
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_camera_nodes.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_camera_nodes.structure_id
    and s.owner_id = (select auth.uid())
));

drop policy if exists structure_rules_owner_all on public.structure_rules;
create policy structure_rules_owner_all on public.structure_rules
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_rules.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_rules.structure_id
    and s.owner_id = (select auth.uid())
));

drop policy if exists structure_render_jobs_owner_all on public.structure_render_jobs;
create policy structure_render_jobs_owner_all on public.structure_render_jobs
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_render_jobs.structure_id
    and s.owner_id = (select auth.uid())
))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.structures s
    where s.id = structure_render_jobs.structure_id
      and s.owner_id = (select auth.uid())
  )
);

drop policy if exists structure_render_outputs_owner_all on public.structure_render_outputs;
create policy structure_render_outputs_owner_all on public.structure_render_outputs
for all to authenticated
using (exists (
  select 1 from public.structures s
  where s.id = structure_render_outputs.structure_id
    and s.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.structures s
  where s.id = structure_render_outputs.structure_id
    and s.owner_id = (select auth.uid())
));

grant select, insert, update, delete on public.structures to authenticated;
grant select, insert, update, delete on public.structure_upload_batches to authenticated;
grant select, insert, update, delete on public.structure_images to authenticated;
grant select, insert, update, delete on public.structure_surfaces to authenticated;
grant select, insert, update, delete on public.structure_image_surface_links to authenticated;
grant select, insert, update, delete on public.structure_camera_nodes to authenticated;
grant select, insert, update, delete on public.structure_rules to authenticated;
grant select, insert, update, delete on public.structure_render_jobs to authenticated;
grant select, insert, update, delete on public.structure_render_outputs to authenticated;

comment on table public.structures is 'CLOUVA Structures reconstruction projects. Media remains in the existing CLOUVA generated-media bucket.';
comment on table public.structure_images is 'Spatial evidence images for a CLOUVA Structures project.';
comment on table public.structure_camera_nodes is 'Camera nodes derived from deterministic metadata and reviewed visual analysis.';
comment on table public.structure_render_jobs is 'CLOUVA Cloud four-view reconstruction render jobs.';
