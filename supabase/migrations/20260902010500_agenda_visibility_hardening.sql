-- Keep direct Supabase/RLS reads aligned with the server Agenda visibility rules.
-- Owners/editors can read operational events; connected viewers only receive
-- connection/public events unless they are explicit event participants.

begin;

create or replace function private.agenda_event_can_read(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agenda_events e
    where e.id = p_event_id
      and (
        -- Anonymous/public access is deliberately narrow: both the event and
        -- at least one linked Agenda must be public.
        (
          e.visibility = 'public'
          and exists (
            select 1
            from public.agenda_event_agendas ea
            join public.agendas a on a.id = ea.agenda_id
            where ea.event_id = e.id
              and a.public_enabled
          )
        )
        or (
          p_user_id is not null
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
        )
      )
  );
$$;

revoke all on function private.agenda_event_can_read(uuid,uuid) from public,anon,authenticated;

commit;
