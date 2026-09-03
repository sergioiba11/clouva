-- Player live location: one current GPS state per Player.
-- Exact coordinates are public only while the owner explicitly has live mode enabled
-- and the heartbeat is fresh. No location history is stored.

create table public.player_live_locations (
  player_id uuid primary key references public.players(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  altitude_m double precision,
  heading_deg double precision check (heading_deg is null or (heading_deg >= 0 and heading_deg <= 360)),
  speed_mps double precision check (speed_mps is null or speed_mps >= 0),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index player_live_locations_fresh_idx
  on public.player_live_locations(updated_at desc)
  where is_enabled = true;

create function public.touch_player_live_location()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_at = coalesce(new.created_at, now());
  end if;
  return new;
end;
$$;

create trigger player_live_locations_touch
  before insert or update on public.player_live_locations
  for each row execute function public.touch_player_live_location();

alter table public.player_live_locations enable row level security;
alter table public.player_live_locations replica identity full;

-- A visitor can only read an actively broadcast location and only while the
-- heartbeat is current. The owner can always read their own row so the toggle
-- can restore its previous state after navigation/reload.
create policy player_live_locations_select_live_or_owner
  on public.player_live_locations
  for select
  using (
    (
      is_enabled = true
      and updated_at > now() - interval '2 minutes'
    )
    or exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

create policy player_live_locations_insert_owner
  on public.player_live_locations
  for insert
  with check (
    exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

create policy player_live_locations_update_owner
  on public.player_live_locations
  for update
  using (
    exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

grant select on table public.player_live_locations to anon;
grant select, insert, update on table public.player_live_locations to authenticated;

alter publication supabase_realtime add table public.player_live_locations;
