-- Public identity fields used by Player SEO/AEO/Knowledge Graph output.
-- Idempotent because production may already contain these columns.
alter table public.players
  add column if not exists alternate_names text[] not null default '{}'::text[],
  add column if not exists country text,
  add column if not exists birth_place text,
  add column if not exists schema_job_title text,
  add column if not exists public_identity_label text;

-- player_music_connections started Spotify-only. Keep the same source of truth
-- and expand its provider vocabulary instead of creating a parallel table.
alter table public.player_music_connections
  drop constraint if exists player_music_connections_provider_check;

alter table public.player_music_connections
  add constraint player_music_connections_provider_check
  check (provider in ('spotify','apple_music','youtube','youtube_music','soundcloud','instagram'));
