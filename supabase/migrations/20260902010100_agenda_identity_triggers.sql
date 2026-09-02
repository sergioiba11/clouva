-- Keep canonical default agendas attached to CLOUVA identities created after
-- the initial Agenda backfill. Presentation still comes from Player/Space;
-- these rows only own scheduling state.

begin;

create or replace function private.ensure_player_default_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agendas(
    name,owner_player_id,created_by_player_id,timezone,visibility,
    public_enabled,booking_enabled,is_default
  ) values (
    coalesce(nullif(new.display_name,''),'Player') || ' · Agenda',
    new.id,new.id,'America/Argentina/Buenos_Aires','connections',false,false,true
  )
  on conflict (owner_player_id) where owner_player_id is not null and is_default
  do update set name = excluded.name, updated_at = now();
  return new;
end;
$$;

create or replace function private.ensure_space_default_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_enabled boolean;
begin
  v_booking_enabled := 'bookings' = any(coalesce(new.enabled_modules,'{}'::text[]));

  insert into public.agendas(
    name,owner_space_id,created_by_player_id,timezone,visibility,
    public_enabled,booking_enabled,is_default
  ) values (
    new.name || ' · Agenda',new.id,new.owner_player_id,
    'America/Argentina/Buenos_Aires','connections',false,v_booking_enabled,true
  )
  on conflict (owner_space_id) where owner_space_id is not null and is_default
  do update set
    name = excluded.name,
    booking_enabled = excluded.booking_enabled,
    updated_at = now();
  return new;
end;
$$;

revoke all on function private.ensure_player_default_agenda() from public,anon,authenticated;
revoke all on function private.ensure_space_default_agenda() from public,anon,authenticated;

drop trigger if exists players_ensure_default_agenda on public.players;
create trigger players_ensure_default_agenda
after insert or update of display_name on public.players
for each row execute function private.ensure_player_default_agenda();

drop trigger if exists spaces_ensure_default_agenda on public.spaces;
create trigger spaces_ensure_default_agenda
after insert or update of name,owner_player_id,enabled_modules on public.spaces
for each row execute function private.ensure_space_default_agenda();

commit;
