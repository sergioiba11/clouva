-- CLOUVA Audio Reactive Visualizer — project state
alter table public.video_projects
  add column if not exists project_mode text not null default 'video',
  add column if not exists visualizer_reactivity numeric not null default 1.0,
  add column if not exists audio_analysis_status text not null default 'idle',
  add column if not exists audio_analysis jsonb,
  add column if not exists audio_analysis_error text,
  add column if not exists audio_analysis_execution_name text;
