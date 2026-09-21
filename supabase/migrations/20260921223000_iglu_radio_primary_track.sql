alter table public.profile_radio_settings
  add column if not exists primary_track_id uuid null references public.radio_tracks(id) on delete set null;

comment on column public.profile_radio_settings.primary_track_id is
  'Optional canonical radio track selected as the primary fallback playback for this public radio/profile.';
