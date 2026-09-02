-- Booking must honor Agenda availability, manual blocks and existing events,
-- not only another booking row. The same advisory lock serializes the full
-- availability check + write path.

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
  v_has_available_rules boolean;
  v_rule public.agenda_availability_rules%rowtype;
  v_rule_start timestamp;
  v_rule_end timestamp;
  v_matches_available boolean := false;
begin
  if p_agenda_id is null or p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    return false;
  end if;

  select * into v_agenda from public.agendas a where a.id = p_agenda_id;
  if not found then return false; end if;

  -- Existing calendar occupancy is authoritative for the slot.
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

  -- Manual/booking blocks also occupy time; expired checkout holds do not.
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
  -- PostgreSQL dow: Sunday=0 ... Saturday=6, matching Agenda schema.
  v_weekday := extract(dow from v_local_start)::smallint;

  select exists (
    select 1 from public.agenda_availability_rules r
    where r.agenda_id = p_agenda_id and r.is_available = true
  ) into v_has_available_rules;

  -- No positive schedule means open-by-default; blocks/events still apply.
  if not v_has_available_rules then
    return not exists (
      select 1
      from public.agenda_availability_rules r
      where r.agenda_id = p_agenda_id
        and r.is_available = false
        and r.weekday = v_weekday
        and (r.valid_from is null or r.valid_from <= v_local_date)
        and (r.valid_until is null or r.valid_until >= v_local_date)
        and (
          case when r.end_local > r.start_local
            then v_local_start >= v_local_date + r.start_local
             and v_local_end <= v_local_date + r.end_local
            else v_local_start >= v_local_date + r.start_local
             and v_local_end <= (v_local_date + interval '1 day') + r.end_local
          end
        )
    );
  end if;

  for v_rule in
    select * from public.agenda_availability_rules r
    where r.agenda_id = p_agenda_id
      and r.weekday = v_weekday
      and (r.valid_from is null or r.valid_from <= v_local_date)
      and (r.valid_until is null or r.valid_until >= v_local_date)
  loop
    v_rule_start := v_local_date + v_rule.start_local;
    v_rule_end := case when v_rule.end_local > v_rule.start_local
      then v_local_date + v_rule.end_local
      else (v_local_date + interval '1 day') + v_rule.end_local
    end;

    if v_local_start >= v_rule_start and v_local_end <= v_rule_end then
      if v_rule.is_available = false then return false; end if;
      v_matches_available := true;
    end if;
  end loop;

  return v_matches_available;
end;
$$;

revoke all on function private.agenda_slot_is_available(uuid,timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.create_studio_booking_with_agenda(
  p_service_id uuid,
  p_studio_id uuid,
  p_buyer_user_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_price numeric,
  p_currency text,
  p_payment_status text,
  p_external_reference text default null,
  p_notes text default null
)
returns table(booking_id uuid, agenda_event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.studio_services%rowtype;
  v_space public.spaces%rowtype;
  v_agenda public.agendas%rowtype;
  v_buyer_player_id uuid;
  v_booking_id uuid;
  v_event_id uuid;
  v_end_at timestamptz;
  v_hold_expires_at timestamptz;
begin
  if p_buyer_user_id is null or p_scheduled_at is null or p_scheduled_at <= now() then
    raise exception 'La fecha de la reserva debe ser futura.';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 15 or p_duration_minutes > 480 then
    raise exception 'La duración de la reserva es inválida.';
  end if;
  if p_payment_status not in ('not_required','pending') then
    raise exception 'Estado de pago inicial inválido.';
  end if;

  select * into v_service
  from public.studio_services ss
  where ss.id = p_service_id
    and ss.studio_id = p_studio_id
    and ss.is_active = true
    and ss.cta_type = 'reservar'
  for share;
  if not found then raise exception 'El servicio no existe o no acepta reservas.'; end if;

  select * into v_space
  from public.spaces sp
  where sp.legacy_studio_id = p_studio_id
  limit 1;
  if not found then raise exception 'El Studio todavía no tiene un Space canónico.'; end if;

  select * into v_agenda
  from public.agendas a
  where a.owner_space_id = v_space.id and a.is_default = true
  limit 1;
  if not found then raise exception 'El Studio todavía no tiene Agenda canónica.'; end if;
  if v_agenda.booking_enabled = false then raise exception 'Las reservas no están habilitadas en esta Agenda.'; end if;

  select p.id into v_buyer_player_id
  from public.players p
  where p.owner_user_id = p_buyer_user_id
  limit 1;
  if v_buyer_player_id is null then raise exception 'No pudimos resolver el Player que reserva.'; end if;

  v_end_at := p_scheduled_at + make_interval(mins => p_duration_minutes);
  v_hold_expires_at := case when p_payment_status = 'pending' then now() + interval '20 minutes' else null end;

  -- Lock before consulting availability, so two concurrent attempts cannot
  -- both pass and then write the same slot.
  perform pg_advisory_xact_lock(hashtextextended(v_agenda.id::text, 0));
  if not private.agenda_slot_is_available(v_agenda.id,p_scheduled_at,v_end_at) then
    raise exception 'Ese horario ya no está disponible.' using errcode = '23P01';
  end if;

  insert into public.bookings(
    service_id,studio_id,buyer_id,scheduled_at,duration_minutes,status,
    price,currency,payment_status,external_reference,notes
  ) values (
    v_service.id,p_studio_id,p_buyer_user_id,p_scheduled_at,p_duration_minutes,'requested',
    p_price,coalesce(nullif(p_currency,''),'ARS'),p_payment_status,p_external_reference,nullif(btrim(coalesce(p_notes,'')),'')
  ) returning id into v_booking_id;

  insert into public.agenda_events(
    primary_agenda_id,created_by_player_id,title,description,event_type,
    start_at,end_at,event_timezone,all_day,status,visibility,
    location_type,metadata
  ) values (
    v_agenda.id,v_buyer_player_id,'Reserva: ' || v_service.name,
    nullif(btrim(coalesce(p_notes,'')),''),'booking',p_scheduled_at,v_end_at,
    v_agenda.timezone,false,'scheduled','participants','unspecified',
    jsonb_build_object('booking_id',v_booking_id,'service_id',v_service.id,'studio_id',p_studio_id)
  ) returning id into v_event_id;

  update public.bookings set agenda_event_id = v_event_id where id = v_booking_id;

  insert into public.agenda_event_agendas(event_id,agenda_id,relation)
  values (v_event_id,v_agenda.id,'primary');

  insert into public.agenda_event_participants(event_id,player_id,role,rsvp_status,invited_by_player_id)
  values
    (v_event_id,v_space.owner_player_id,'host','accepted',v_buyer_player_id),
    (v_event_id,v_buyer_player_id,'participant','accepted',v_buyer_player_id)
  on conflict (event_id,player_id) do update
    set rsvp_status = excluded.rsvp_status, updated_at = now();

  insert into public.agenda_event_agendas(event_id,agenda_id,relation)
  select v_event_id,a.id,'invited'
  from public.agendas a
  where a.owner_player_id = v_buyer_player_id and a.is_default = true
    and a.id <> v_agenda.id
  on conflict (event_id,agenda_id) do nothing;

  insert into public.agenda_blocks(
    agenda_id,event_id,booking_id,start_at,end_at,reason,status,
    created_by_player_id,expires_at
  ) values (
    v_agenda.id,v_event_id,v_booking_id,p_scheduled_at,v_end_at,
    'Reserva: ' || v_service.name,'active',v_buyer_player_id,v_hold_expires_at
  );

  return query select v_booking_id,v_event_id;
end;
$$;

revoke all on function public.create_studio_booking_with_agenda(uuid,uuid,uuid,timestamptz,integer,numeric,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_studio_booking_with_agenda(uuid,uuid,uuid,timestamptz,integer,numeric,text,text,text,text)
  to service_role;

commit;
