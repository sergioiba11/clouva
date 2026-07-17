begin;

create table if not exists public.rig_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid,
  worker_job_id text,

  status text not null default 'creating'
    check (status in ('creating', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
  stage text,
  progress smallint not null default 0
    check (progress between 0 and 100),

  rigging_strategy text,
  template_mode boolean not null default false,

  request_payload jsonb not null default '{}'::jsonb,
  worker_snapshot jsonb not null default '{}'::jsonb,
  worker_fingerprint text,

  result_storage_path text,
  error_message text,

  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  last_synced_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rig_jobs_worker_job_id_not_blank
    check (worker_job_id is null or length(btrim(worker_job_id)) > 0),
  constraint rig_jobs_finished_state_consistency
    check (
      (status in ('completed', 'failed', 'cancelled') and finished_at is not null)
      or
      (status in ('creating', 'queued', 'processing') and finished_at is null)
    )
);

create unique index if not exists rig_jobs_worker_job_id_unique_idx
  on public.rig_jobs (worker_job_id)
  where worker_job_id is not null;

create index if not exists rig_jobs_user_status_created_idx
  on public.rig_jobs (user_id, status, created_at desc);

create index if not exists rig_jobs_user_asset_created_idx
  on public.rig_jobs (user_id, asset_id, created_at desc)
  where asset_id is not null;

create index if not exists rig_jobs_active_activity_idx
  on public.rig_jobs (last_activity_at)
  where status in ('creating', 'queued', 'processing');

create table if not exists public.rig_logs (
  id uuid primary key default gen_random_uuid(),
  rig_job_id uuid not null references public.rig_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  level text not null default 'info'
    check (level in ('debug', 'info', 'warning', 'error')),
  source text not null default 'api'
    check (source in ('api', 'worker', 'blender', 'watchdog')),
  stage text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),

  constraint rig_logs_message_not_blank
    check (length(btrim(message)) > 0),
  constraint rig_logs_dedupe_key_not_blank
    check (dedupe_key is null or length(btrim(dedupe_key)) > 0)
);

create index if not exists rig_logs_job_created_idx
  on public.rig_logs (rig_job_id, created_at);

create index if not exists rig_logs_user_created_idx
  on public.rig_logs (user_id, created_at desc);

create unique index if not exists rig_logs_job_dedupe_unique_idx
  on public.rig_logs (rig_job_id, dedupe_key)
  where dedupe_key is not null;

create or replace function public.set_rig_record_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rig_jobs_set_updated_at on public.rig_jobs;
create trigger rig_jobs_set_updated_at
before update on public.rig_jobs
for each row execute function public.set_rig_record_updated_at();

alter table public.rig_jobs enable row level security;
alter table public.rig_logs enable row level security;

revoke all on table public.rig_jobs from anon, authenticated;
revoke all on table public.rig_logs from anon, authenticated;

grant select on table public.rig_jobs to authenticated;
grant select on table public.rig_logs to authenticated;

drop policy if exists "Users read own rig jobs" on public.rig_jobs;
create policy "Users read own rig jobs"
on public.rig_jobs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users read own rig logs" on public.rig_logs;
create policy "Users read own rig logs"
on public.rig_logs
for select
to authenticated
using (auth.uid() = user_id);

comment on table public.rig_jobs is
  'Fuente de verdad persistente para trabajos de Auto Rig enviados a workers externos.';
comment on column public.rig_jobs.id is
  'Identificador interno estable de CLOUVA. No depende del identificador del worker.';
comment on column public.rig_jobs.worker_job_id is
  'Identificador externo devuelto por el worker de Blender/Railway.';
comment on column public.rig_jobs.worker_fingerprint is
  'Huella del último estado observado; permite detectar actividad real sin memoria de proceso.';
comment on table public.rig_logs is
  'Historial auditable y deduplicado de eventos del pipeline de rigging.';

commit;
