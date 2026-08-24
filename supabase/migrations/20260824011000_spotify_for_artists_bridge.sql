-- Spotify for Artists bridge
-- Keep the normal Spotify OAuth account separate from the professional artist workspace.
-- Public catalog metadata is synced through Spotify Web API; private Spotify for Artists
-- analytics can be imported from the CSV exports Spotify officially provides.

alter table public.players
  add column if not exists spotify_for_artists_id text,
  add column if not exists spotify_for_artists_url text,
  add column if not exists spotify_for_artists_status text,
  add column if not exists spotify_artist_data jsonb not null default '{}'::jsonb,
  add column if not exists spotify_artist_data_updated_at timestamptz,
  add column if not exists spotify_for_artists_last_import_at timestamptz;

create index if not exists players_spotify_artist_id_idx
  on public.players (spotify_artist_id)
  where spotify_artist_id is not null;

create index if not exists players_spotify_for_artists_id_idx
  on public.players (spotify_for_artists_id)
  where spotify_for_artists_id is not null;

create table if not exists public.spotify_for_artists_imports (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null default 'generic',
  file_name text not null,
  headers jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists spotify_for_artists_imports_player_idx
  on public.spotify_for_artists_imports (player_id, imported_at desc);

create index if not exists spotify_for_artists_imports_owner_idx
  on public.spotify_for_artists_imports (owner_user_id, imported_at desc);

alter table public.spotify_for_artists_imports enable row level security;

revoke all on public.spotify_for_artists_imports from anon;
grant select, insert, delete on public.spotify_for_artists_imports to authenticated;

-- Policies are intentionally owner-scoped. Server routes still validate Player ownership
-- before using the service-role client.
do $$
begin
  create policy spotify_for_artists_imports_select_own
    on public.spotify_for_artists_imports
    for select
    to authenticated
    using (owner_user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy spotify_for_artists_imports_insert_own
    on public.spotify_for_artists_imports
    for insert
    to authenticated
    with check (owner_user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy spotify_for_artists_imports_delete_own
    on public.spotify_for_artists_imports
    for delete
    to authenticated
    using (owner_user_id = auth.uid());
exception when duplicate_object then null;
end $$;
