-- Keep the existing Booking row and its canonical Agenda event synchronized when
-- an authorized Agenda editor moves or cancels a booking event.

begin;

create or replace function private.sync_agenda_event_booking_timing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id uuid;
  v_duration integer;
begin
  select b.id into v_booking_id
  from public.bookings b
  where b.agenda_event_id = new.id
  limit 1;

  if v_booking_id is null then
    return new;
  end if;

  if new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at then
    v_duration := greatest(1, ceil(extract(epoch from (new.end_at - new.start_at)) / 60.0)::integer);

    -- Updating the block runs the canonical overlap trigger. Any collision raises
    -- and rolls the original event move back in the same transaction.
    update public.agenda_blocks
    set start_at = new.start_at,
        end_at = new.end_at,
        updated_at = now()
    where booking_id = v_booking_id
      and status = 'active';

    update public.bookings
    set scheduled_at = new.start_at,
        duration_minutes = v_duration,
        updated_at = now()
    where id = v_booking_id;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.bookings
    set status = 'cancelled',
        updated_at = now()
    where id = v_booking_id
      and status <> 'cancelled';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_agenda_event_booking_timing() from public,anon,authenticated;

drop trigger if exists agenda_events_sync_booking_timing on public.agenda_events;
create trigger agenda_events_sync_booking_timing
after update of start_at,end_at,status on public.agenda_events
for each row execute function private.sync_agenda_event_booking_timing();

commit;
