-- CLOUVA Cloud Video Engine
-- Extiende media_generation_jobs en lugar de crear un segundo ledger de generación.

create table if not exists public.video_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text,
  master_prompt text not null default '',
  style_prompt text not null default '',
  provider text not null default 'google_vertex_ai',
  model text not null default 'veo-3.1-fast-generate-001',
  quality text not null default 'fast',
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9', '9:16')),
  target_duration_seconds integer not null default 8 check (target_duration_seconds between 4 and 7200),
  maintain_style boolean not null default true,
  maintain_character boolean not null default true,
  use_frame_continuity boolean not null default true,
  generate_clip_audio boolean not null default false,
  reference_assets jsonb not null default '[]'::jsonb,
  audio_storage_path text,
  audio_url text,
  status text not null default 'draft' check (status in (
    'draft', 'queued', 'generating', 'processing', 'compositing',
    'completed', 'failed', 'cancelled'
  )),
  progress integer not null default 0 check (progress between 0 and 100),
  estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  actual_cost_usd numeric check (actual_cost_usd is null or actual_cost_usd >= 0),
  cost_confirmed_at timestamptz,
  render_execution_name text,
  output_storage_path text,
  output_url text,
  thumbnail_storage_path text,
  thumbnail_url text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_projects_user_created_idx
  on public.video_projects (user_id, created_at desc);

create index if not exists video_projects_active_idx
  on public.video_projects (user_id, status)
  where status in ('queued', 'generating', 'processing', 'compositing');

create or replace function public.touch_video_projects_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_video_projects_updated_at() from public;

drop trigger if exists video_projects_touch_updated_at on public.video_projects;
create trigger video_projects_touch_updated_at
before update on public.video_projects
for each row execute function public.touch_video_projects_updated_at();

alter table public.video_projects enable row level security;
revoke all on public.video_projects from public, anon, authenticated;
grant select on public.video_projects to authenticated;
grant all on public.video_projects to service_role;

drop policy if exists video_projects_select_own_or_admin on public.video_projects;
create policy video_projects_select_own_or_admin
on public.video_projects for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select private.is_clouva_admin())
);

alter table public.media_generation_jobs
  add column if not exists provider text not null default 'google_gemini_api',
  add column if not exists project_id uuid references public.video_projects(id) on delete cascade,
  add column if not exists sequence_index integer,
  add column if not exists last_frame_storage_path text,
  add column if not exists last_frame_url text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_provider_sync_at timestamptz;

create unique index if not exists media_generation_jobs_project_sequence_uidx
  on public.media_generation_jobs (project_id, sequence_index)
  where project_id is not null and sequence_index is not null;

create index if not exists media_generation_jobs_project_status_idx
  on public.media_generation_jobs (project_id, status, sequence_index)
  where project_id is not null;

comment on table public.video_projects is
  'Long-form CLOUVA video projects orchestrating existing media_generation_jobs and a Cloud Run FFmpeg render.';
comment on column public.media_generation_jobs.project_id is
  'Optional long-form video project. media_generation_jobs remains the canonical generation-job ledger.';
