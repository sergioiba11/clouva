-- Recurrence exceptions must invalidate subscribed clients even when the base
-- series row itself did not otherwise change. Touching the canonical series
-- makes the existing agenda_events Realtime subscription refresh the view.

begin;

create or replace function private.touch_agenda_series_from_exception()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series_id uuid;
begin
  v_series_id := coalesce(new.series_event_id, old.series_event_id);
  update public.agenda_events
    set updated_at = now()
    where id = v_series_id;
  return coalesce(new, old);
end;
$$;

revoke all on function private.touch_agenda_series_from_exception() from public,anon,authenticated;

drop trigger if exists agenda_event_exceptions_touch_series on public.agenda_event_exceptions;
create trigger agenda_event_exceptions_touch_series
after insert or update or delete on public.agenda_event_exceptions
for each row execute function private.touch_agenda_series_from_exception();

commit;
