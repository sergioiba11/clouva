alter table public.profile_radio_settings
  add column if not exists podcast_rss_url text null,
  add column if not exists kick_channel_url text null;

comment on column public.profile_radio_settings.podcast_rss_url is
  'Optional podcast RSS source associated with this public radio/profile.';
comment on column public.profile_radio_settings.kick_channel_url is
  'Optional Kick channel URL associated with this public radio/profile. Live state must be verified separately.';
