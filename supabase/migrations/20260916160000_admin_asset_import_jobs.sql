create table if not exists public.admin_asset_import_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  source_filename text not null,
  source_size bigint not null check (source_size > 0),
  source_content_type text not null default 'application/zip',
  staging_bucket text not null,
  staging_path text not null unique,
  destination_folder text not null default 'uploads',
  status text not null default 'created' check (status in ('created','uploading_archive','archive_uploaded','queued','extracting','importing','completed','completed_with_errors','failed','cancelled')),
  phase text not null default 'preparing' check (phase in ('preparing','uploading','analyzing','importing','completed','failed','cancelled')),
  total_files integer not null default 0 check (total_files >= 0),
  processed_files integer not null default 0 check (processed_files >= 0),
  success_files integer not null default 0 check (success_files >= 0),
  failed_files integer not null default 0 check (failed_files >= 0),
  current_file text,
  uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  total_bytes bigint not null check (total_bytes > 0),
  upload_percent numeric(6,2) not null default 0 check (upload_percent >= 0 and upload_percent <= 100),
  import_percent numeric(6,2) not null default 0 check (import_percent >= 0 and import_percent <= 100),
  overall_percent numeric(6,2) not null default 0 check (overall_percent >= 0 and overall_percent <= 100),
  worker_task_name text,
  worker_attempts integer not null default 0 check (worker_attempts >= 0),
  error_message text,
  started_at timestamptz,
  uploaded_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists admin_asset_import_jobs_created_by_created_at_idx
  on public.admin_asset_import_jobs (created_by, created_at desc);
create index if not exists admin_asset_import_jobs_status_updated_at_idx
  on public.admin_asset_import_jobs (status, updated_at desc);

alter table public.admin_asset_import_jobs enable row level security;

comment on table public.admin_asset_import_jobs is
  'Durable admin ZIP import jobs for CLOUVA Asset Explorer. Accessed through authenticated admin server routes only.';

create table if not exists public.admin_asset_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.admin_asset_import_jobs(id) on delete cascade,
  original_path text not null,
  filename text not null,
  destination_path text not null,
  content_type text not null,
  size bigint not null default 0 check (size >= 0),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','skipped')),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, original_path)
);

create index if not exists admin_asset_import_items_job_status_idx
  on public.admin_asset_import_items (job_id, status, created_at);

alter table public.admin_asset_import_items enable row level security;

comment on table public.admin_asset_import_items is
  'Per-entry durable progress for Asset Explorer ZIP imports; binary payloads stay in GCS.';
