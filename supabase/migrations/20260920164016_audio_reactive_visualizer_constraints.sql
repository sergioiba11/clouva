-- CLOUVA Audio Reactive Visualizer — constraints and documentation
alter table public.video_projects
  add constraint video_projects_project_mode_check
    check (project_mode in ('video', 'visualizer')),
  add constraint video_projects_visualizer_reactivity_check
    check (visualizer_reactivity between 0.25 and 2.0),
  add constraint video_projects_audio_analysis_status_check
    check (audio_analysis_status in ('idle', 'queued', 'analyzing', 'completed', 'failed'));

comment on column public.video_projects.project_mode is
  'video = generador tradicional; visualizer = timeline y composición dirigidos por análisis del audio master.';
comment on column public.video_projects.audio_analysis is
  'Análisis persistente del master: duración, BPM, beats, secciones, energía y eventos de flow.';
comment on column public.video_projects.visualizer_reactivity is
  'Intensidad del movimiento reactivo aplicado durante la composición final.';
