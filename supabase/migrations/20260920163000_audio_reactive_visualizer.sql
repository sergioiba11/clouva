-- CLOUVA Audio Reactive Visualizer
-- Extiende video_projects: el mismo Cloud Video Engine puede funcionar como
-- video tradicional o visualizer dirigido por el master de audio.

alter table public.video_projects
  add column if not exists project_mode text not null default 'video',
  add column if not exists visualizer_reactivity numeric not null default 1.0,
  add column if not exists audio_analysis_status text not null default 'idle',
  add column if not exists audio_analysis jsonb,
  add column if not exists audio_analysis_error text,
  add column if not exists audio_analysis_execution_name text;

alter table public.video_projects
  drop constraint if exists video_projects_project_mode_check,
  add constraint video_projects_project_mode_check
    check (project_mode in ('video', 'visualizer'));

alter table public.video_projects
  drop constraint if exists video_projects_visualizer_reactivity_check,
  add constraint video_projects_visualizer_reactivity_check
    check (visualizer_reactivity between 0.25 and 2.0);

alter table public.video_projects
  drop constraint if exists video_projects_audio_analysis_status_check,
  add constraint video_projects_audio_analysis_status_check
    check (audio_analysis_status in ('idle', 'queued', 'analyzing', 'completed', 'failed'));

comment on column public.video_projects.project_mode is
  'video = generador tradicional; visualizer = timeline y composición dirigidos por análisis del audio master.';
comment on column public.video_projects.audio_analysis is
  'Análisis persistente del master: duración, BPM, beats, secciones, energía y eventos de flow.';
comment on column public.video_projects.visualizer_reactivity is
  'Intensidad del movimiento reactivo aplicado durante la composición final.';
