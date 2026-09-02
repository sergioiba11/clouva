-- Public Agenda data is served through the dedicated server DTO, never through
-- direct anonymous Data API access to internal Agenda tables. Authenticated
-- users keep RLS-scoped reads. Event readers may see participant rows so RSVP
-- Realtime updates propagate to every authorized participant/editor.

begin;

revoke select on public.agendas from anon;
revoke select on public.agenda_events from anon;
revoke select on public.agenda_event_agendas from anon;

drop policy if exists agendas_public_or_authorized_select on public.agendas;
create policy agendas_authorized_select on public.agendas
for select to authenticated
using (
  public_enabled
  or private.agenda_role_for_user(id,(select auth.uid())) is not null
);

drop policy if exists agenda_events_authorized_select on public.agenda_events;
create policy agenda_events_authorized_select on public.agenda_events
for select to authenticated
using (private.agenda_event_can_read(id,(select auth.uid())));

drop policy if exists agenda_event_agendas_authorized_select on public.agenda_event_agendas;
create policy agenda_event_agendas_authorized_select on public.agenda_event_agendas
for select to authenticated
using (private.agenda_event_can_read(event_id,(select auth.uid())));

drop policy if exists agenda_event_participants_self_or_manager_select on public.agenda_event_participants;
create policy agenda_event_participants_authorized_event_select on public.agenda_event_participants
for select to authenticated
using (private.agenda_event_can_read(event_id,(select auth.uid())));

commit;
