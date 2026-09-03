alter table public.players
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_latitude_range'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_latitude_range
      check (latitude is null or latitude between -90 and 90);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_longitude_range'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_longitude_range
      check (longitude is null or longitude between -180 and 180);
  end if;
end
$$;

comment on column public.players.latitude is
  'Latitude of the public locality configured by the Player; never device GPS or a private address.';
comment on column public.players.longitude is
  'Longitude of the public locality configured by the Player; never device GPS or a private address.';
