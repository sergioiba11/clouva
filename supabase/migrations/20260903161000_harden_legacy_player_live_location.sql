-- CLOUVA privacy boundary: the legacy player_live_locations table must never expose GPS publicly.
-- The consent-based Mapa de confianza uses trusted_map_locations as its only active realtime location store.
-- Keep this legacy table owner-only for compatibility while removing its former public-live behavior.

drop policy if exists player_live_locations_select_live_or_owner on public.player_live_locations;
drop policy if exists player_live_locations_insert_owner on public.player_live_locations;
drop policy if exists player_live_locations_update_owner on public.player_live_locations;
drop policy if exists player_live_locations_delete_owner on public.player_live_locations;
drop policy if exists player_live_locations_owner_read on public.player_live_locations;
drop policy if exists player_live_locations_owner_insert on public.player_live_locations;
drop policy if exists player_live_locations_owner_update on public.player_live_locations;
drop policy if exists player_live_locations_owner_delete on public.player_live_locations;

alter table public.player_live_locations enable row level security;

create policy player_live_locations_owner_read
on public.player_live_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.players p
    where p.id = player_live_locations.player_id
      and p.owner_user_id = auth.uid()
  )
);

create policy player_live_locations_owner_insert
on public.player_live_locations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.players p
    where p.id = player_live_locations.player_id
      and p.owner_user_id = auth.uid()
  )
);

create policy player_live_locations_owner_update
on public.player_live_locations
for update
to authenticated
using (
  exists (
    select 1
    from public.players p
    where p.id = player_live_locations.player_id
      and p.owner_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.players p
    where p.id = player_live_locations.player_id
      and p.owner_user_id = auth.uid()
  )
);

create policy player_live_locations_owner_delete
on public.player_live_locations
for delete
to authenticated
using (
  exists (
    select 1
    from public.players p
    where p.id = player_live_locations.player_id
      and p.owner_user_id = auth.uid()
  )
);

revoke all on table public.player_live_locations from anon;
grant select, insert, update, delete on table public.player_live_locations to authenticated;

-- It is not part of the active Mapa de confianza and must not emit a second realtime GPS stream.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'player_live_locations'
  ) then
    alter publication supabase_realtime drop table public.player_live_locations;
  end if;
end $$;

comment on table public.player_live_locations is
  'Legacy owner-only location storage. Not public and not used by Mapa de confianza; trusted_map_locations is the consent-based realtime source.';
