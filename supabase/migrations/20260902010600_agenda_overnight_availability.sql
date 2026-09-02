-- Correct availability windows that cross midnight (for example 21:00-02:00).
-- A booking at 01:00 Tuesday must be able to match Monday's overnight rule.

begin;

create or replace function private.agenda_slot_is_available(
  p_agenda_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agenda public.agendas%rowtype;
  v_local_start timestamp;
  v_local_end timestamp;
  v_local_date date;
  v_weekday smallint;
  v_previous_weekday smallint;
  v_has_available_rules boolean;
  v_rule public.agenda_availability_rules%rowtype;
  v_anchor_date date;
  v_rule_start timestamp;
  v_rule_end timestamp;
  v_matches_available boolean := false;
begin
  if p_agenda_id is null or p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    return false;
  end if;

  select * into v_agenda from public.agendas a where a.id = p_agenda_id;
  if not found then return false; end if;

  if exists (
    select 1
    from public.agenda_event_agendas ea
    join public.agenda_events e on e.id = ea.event_id
    where ea.agenda_id = p_agenda_id
      and e.status = 'scheduled'
      and tstzrange(e.start_at,e.end_at,'[)') && tstzrange(p_start_at,p_end_at,'[)')
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.agenda_blocks b
    where b.agenda_id = p_agenda_id
      and b.status = 'active'
      and (b.expires_at is null or b.expires_at > now())
      and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(p_start_at,p_end_at,'[)')
  ) then
    return false;
  end if;

  v_local_start := p_start_at at time zone v_agenda.timezone;
  v_local_end := p_end_at at time zone v_agenda.timezone;
  v_local_date := v_local_start::date;
  v_weekday := extract(dow from v_local_start)::smallint;
  v_previous_weekday := ((v_weekday + 6) % 7)::smallint;

  select exists (
    select 1
    from public.agenda_availability_rules r
    where r.agenda_id = p_agenda_id
      and r.is_available = true
  ) into v_has_available_rules;

  -- Evaluate both today's rules and the previous day's overnight windows.
  for v_rule in
    select *
    from public.agenda_availability_rules r
    where r.agenda_id = p_agenda_id
      and (
        r.weekday = v_weekday
        or (r.weekday = v_previous_weekday and r.end_local < r.start_local)
      )
  loop
    v_anchor_date := case
      when v_rule.weekday = v_previous_weekday and v_rule.end_local < v_rule.start_local
        then v_local_date - 1
      else v_local_date
    end;

    if v_rule.valid_from is not null and v_rule.valid_from > v_anchor_date then
      continue;
    end if;
    if v_rule.valid_until is not null and v_rule.valid_until < v_anchor_date then
      continue;
    end if;

    v_rule_start := v_anchor_date + v_rule.start_local;
    v_rule_end := case
      when v_rule.end_local > v_rule.start_local
        then v_anchor_date + v_rule.end_local
      else (v_anchor_date + interval '1 day') + v_rule.end_local
    end;

    if v_local_start >= v_rule_start and v_local_end <= v_rule_end then
      if v_rule.is_available = false then
        return false;
      end if;
      v_matches_available := true;
    end if;
  end loop;

  -- With no positive rules the Agenda is open by default, except for explicit
  -- negative windows, blocks and occupied events checked above.
  if not v_has_available_rules then
    return true;
  end if;

  return v_matches_available;
end;
$$;

revoke all on function private.agenda_slot_is_available(uuid,timestamptz,timestamptz) from public,anon,authenticated;

commit;
