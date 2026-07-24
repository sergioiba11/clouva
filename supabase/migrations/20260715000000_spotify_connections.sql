create table if not exists public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text not null unique,
  spotify_display_name text,
  spotify_email text,
  spotify_avatar_url text,
  spotify_profile_url text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.spotify_connections enable row level security;

revoke all on public.spotify_connections from anon, authenticated;

drop policy if exists "Users can read Spotify public connection metadata" on public.spotify_connections;
create policy "Users can read Spotify public connection metadata"
on public.spotify_connections
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can disconnect Spotify" on public.spotify_connections;
create policy "Users can disconnect Spotify"
on public.spotify_connections
for delete
to authenticated
using (auth.uid() = user_id);

comment on table public.spotify_connections is 'Private Spotify OAuth credentials. Access and refresh tokens must only be read with the service role from server routes.';
