-- CLOUVA Video AI Lab — LTX video-to-video jobs.
create table if not exists public.video_enhance_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'AI Enhance' check (char_length(title) between 1 and 160),
  source_storage_path text,
  source_url text,
  source_filename text,
  source_size_bytes bigint check (source_size_bytes is null or source_size_bytes > 0),
  prompt text not null default '',
  negative_prompt text not null default 'blurry, jittery, distorted, inconsistent motion, text, watermark',
  model text not null default 'ltxv-13b-0.9.8-distilled-fp8',
  mode text not null default 'balanced' check (mode in ('faithful','balanced','reimagine')),
  transform_strength numeric not null default 0.45 check (transform_strength between 0 and 1),
  preserve_motion boolean not null default true,
  preserve_camera boolean not null default true,
  preserve_subject boolean not null default true,
  preserve_audio boolean not null default true,
  output_resolution text not null default '720p' check (output_resolution in ('480p','720p')),
  output_fps integer not null default 24 check (output_fps in (24,25,30)),
  seed bigint not null default 171198,
  trim_start_seconds numeric not null default 0 check (trim_start_seconds >= 0),
  trim_duration_seconds numeric check (trim_duration_seconds is null or trim_duration_seconds > 0),
  status text not null default 'draft' check (status in ('draft','queued','processing','completed','failed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  execution_name text,
  output_storage_path text,
  output_url text,
  thumbnail_storage_path text,
  thumbnail_url text,
  gpu_seconds numeric,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_enhance_jobs_user_created_idx
  on public.video_enhance_jobs (user_id, created_at desc);
create index if not exists video_enhance_jobs_active_idx
  on public.video_enhance_jobs (user_id, status)
  where status in ('queued','processing');

create or replace function public.touch_video_enhance_jobs_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.touch_video_enhance_jobs_updated_at() from public;
drop trigger if exists video_enhance_jobs_touch_updated_at on public.video_enhance_jobs;
create trigger video_enhance_jobs_touch_updated_at
before update on public.video_enhance_jobs
for each row execute function public.touch_video_enhance_jobs_updated_at();

alter table public.video_enhance_jobs enable row level security;
revoke all on public.video_enhance_jobs from public, anon, authenticated;
grant select on public.video_enhance_jobs to authenticated;
grant all on public.video_enhance_jobs to service_role;

drop policy if exists video_enhance_jobs_select_own_or_admin on public.video_enhance_jobs;
create policy video_enhance_jobs_select_own_or_admin
on public.video_enhance_jobs for select to authenticated
using (
  (select auth.uid()) = user_id
  or (select private.is_clouva_admin())
);

comment on table public.video_enhance_jobs is
  'CLOUVA video-to-video enhancement jobs executed by the LTX GPU Cloud Run worker.';
