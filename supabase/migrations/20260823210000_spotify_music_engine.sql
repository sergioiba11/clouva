-- CLOUVA Music Engine / Spotify foundation.
-- Personal OAuth credentials continue to live only in social_connections.

create table if not exists public.player_music_connections (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  provider text not null check (provider in ('spotify')),
  connection_type text not null default 'artist' check (connection_type in ('artist')),
  external_artist_id text not null,
  external_uri text not null,
  external_url text not null,
  artist_name text not null,
  artist_image_url text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified')),
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, provider, connection_type),
  unique (provider, external_artist_id, player_id)
);

create index if not exists player_music_connections_player_idx
  on public.player_music_connections(player_id, provider);

create table if not exists public.external_music_tracks (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  provider text not null check (provider in ('spotify')),
  external_track_id text not null,
  external_track_uri text not null,
  external_album_id text,
  title text not null,
  artist_name text not null,
  album_name text,
  cover_url text,
  external_url text not null,
  release_date text,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_track_id, player_id)
);

create index if not exists external_music_tracks_player_idx
  on public.external_music_tracks(player_id, provider, release_date desc);

-- This helper is intentionally SECURITY DEFINER so membership checks are not
-- coupled to player_members/players client RLS. It is callable only by signed-in
-- users (and the service role), never by anon.
create or replace function public.can_manage_player(check_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.players p
      where p.id = check_player_id and p.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.player_members m
      where m.player_id = check_player_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and m.role in ('owner','manager','editor')
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    );
$$;

revoke all on function public.can_manage_player(uuid) from public;
revoke all on function public.can_manage_player(uuid) from anon;
revoke all on function public.can_manage_player(uuid) from authenticated;
grant execute on function public.can_manage_player(uuid) to authenticated, service_role;

alter table public.player_music_connections enable row level security;
alter table public.external_music_tracks enable row level security;

-- Public reads are expressed directly against the already-public Player model.
-- Manager reads are a separate authenticated-only policy so anon never needs
-- EXECUTE on the SECURITY DEFINER authorization helper.
drop policy if exists player_music_connections_read on public.player_music_connections;
drop policy if exists player_music_connections_public_read on public.player_music_connections;
create policy player_music_connections_public_read
  on public.player_music_connections for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_music_connections.player_id
        and p.is_published = true
        and p.publication_status = 'published'
        and coalesce(p.privacy_status, 'public') <> 'private'
    )
  );

drop policy if exists player_music_connections_manager_read on public.player_music_connections;
create policy player_music_connections_manager_read
  on public.player_music_connections for select
  to authenticated
  using (public.can_manage_player(player_id));

drop policy if exists player_music_connections_manage on public.player_music_connections;
create policy player_music_connections_manage
  on public.player_music_connections for all
  to authenticated
  using (public.can_manage_player(player_id))
  with check (public.can_manage_player(player_id));

drop policy if exists external_music_tracks_read on public.external_music_tracks;
drop policy if exists external_music_tracks_public_read on public.external_music_tracks;
create policy external_music_tracks_public_read
  on public.external_music_tracks for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = external_music_tracks.player_id
        and p.is_published = true
        and p.publication_status = 'published'
        and coalesce(p.privacy_status, 'public') <> 'private'
    )
  );

drop policy if exists external_music_tracks_manager_read on public.external_music_tracks;
create policy external_music_tracks_manager_read
  on public.external_music_tracks for select
  to authenticated
  using (public.can_manage_player(player_id));

drop policy if exists external_music_tracks_manage on public.external_music_tracks;
create policy external_music_tracks_manage
  on public.external_music_tracks for all
  to authenticated
  using (public.can_manage_player(player_id))
  with check (public.can_manage_player(player_id));

-- If an earlier pre-release iteration created this helper, remove it after the
-- policies no longer depend on it so it cannot be exposed as an RPC.
drop function if exists public.can_view_player_music(uuid);

-- Keep timestamps correct for direct authenticated writes as well as server writes.
create or replace function public.touch_music_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists player_music_connections_touch_updated_at on public.player_music_connections;
create trigger player_music_connections_touch_updated_at
before update on public.player_music_connections
for each row execute function public.touch_music_updated_at();

drop trigger if exists external_music_tracks_touch_updated_at on public.external_music_tracks;
create trigger external_music_tracks_touch_updated_at
before update on public.external_music_tracks
for each row execute function public.touch_music_updated_at();
