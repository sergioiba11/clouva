-- Durable job table for the Avatar Analyzer, backing Cloud Run Job executions
-- instead of the worker's in-process background-thread + local-file job state.

begin;

create table public.avatar_analyzer_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid references public.user_avatars(id) on delete set null,
  operation text not null default 'full_analysis',
  requested_rig_profile text,
  status text not null default 'queued'
    check (status in (
      'queued', 'starting', 'running', 'persisting',
      'completed', 'failed', 'cancel_requested', 'cancelled'
    )),
  progress numeric,
  phase text,
  source_storage_path text,
  source_sha256 text,
  cloud_run_execution text,
  run_id text,
  result_prefix text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index avatar_analyzer_jobs_user_id_created_at_idx
  on public.avatar_analyzer_jobs (user_id, created_at desc);

create index avatar_analyzer_jobs_avatar_id_idx
  on public.avatar_analyzer_jobs (avatar_id);

-- Partial index to cheaply answer "is there already a non-terminal job for
-- this avatar" -- the app-level concurrency guard (one analysis at a time).
create index avatar_analyzer_jobs_active_by_avatar_idx
  on public.avatar_analyzer_jobs (avatar_id)
  where status in ('queued', 'starting', 'running', 'persisting', 'cancel_requested');

alter table public.avatar_analyzer_jobs enable row level security;

-- Reads only: a user can see their own jobs. All writes happen through the
-- Next.js server routes using the service-role key (which bypasses RLS), so
-- there are deliberately no insert/update/delete policies for authenticated
-- or anon roles here.
create policy "avatar_analyzer_jobs_select_own"
  on public.avatar_analyzer_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

commit;
