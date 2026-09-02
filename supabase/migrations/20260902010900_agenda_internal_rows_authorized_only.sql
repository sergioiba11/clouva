-- Internal Agenda rows are never the public API. Even authenticated strangers
-- must consume public Agenda data through the dedicated server DTO, which strips
-- internal ids and private participant/permission fields. Direct table reads are
-- reserved for users who actually belong to the Agenda/event context.

begin;

create or replace function private.agenda_event_can_read(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.agenda_events e
    where e.id = p_event_id
      and (
        private.agenda_user_manages_player(p_user_id,e.created_by_player_id)
        or exists (
          select 1
          from public.agenda_event_participants ep
          where ep.event_id = e.id
            and private.agenda_user_manages_player(p_user_id,ep.player_id)
        )
        or exists (
          select 1
          from public.agenda_event_agendas ea
          where ea.event_id = e.id
            and private.agenda_role_for_user(ea.agenda_id,p_user_id) in ('owner','editor')
        )
        or (
          e.visibility in ('connections','public')
          and exists (
            select 1
            from public.agenda_event_agendas ea
            where ea.event_id = e.id
              and private.agenda_role_for_user(ea.agenda_id,p_user_id) is not null
          )
        )
      )
  );
$$;

revoke all on function private.agenda_event_can_read(uuid,uuid) from public,anon,authenticated;

drop policy if exists agendas_authorized_select on public.agendas;
create policy agendas_authorized_select on public.agendas
for select to authenticated
using (private.agenda_role_for_user(id,(select auth.uid())) is not null);

drop policy if exists agenda_events_authorized_select on public.agenda_events;
create policy agenda_events_authorized_select on public.agenda_events
for select to authenticated
using (private.agenda_event_can_read(id,(select auth.uid())));

drop policy if exists agenda_event_agendas_authorized_select on public.agenda_event_agendas;
create policy agenda_event_agendas_authorized_select on public.agenda_event_agendas
for select to authenticated
using (private.agenda_event_can_read(event_id,(select auth.uid())));

drop policy if exists agenda_event_participants_authorized_event_select on public.agenda_event_participants;
create policy agenda_event_participants_authorized_event_select on public.agenda_event_participants
for select to authenticated
using (private.agenda_event_can_read(event_id,(select auth.uid())));

commit;
