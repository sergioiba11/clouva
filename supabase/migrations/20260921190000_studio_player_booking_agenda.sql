create or replace function public.create_studio_booking_with_player_agenda(
  p_service_id uuid,
  p_studio_id uuid,
  p_buyer_user_id uuid,
  p_host_player_id uuid,
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
  v_studio_agenda public.agendas%rowtype;
  v_host_agenda public.agendas%rowtype;
  v_buyer_player_id uuid;
  v_host_player_id uuid;
  v_booking_id uuid;
  v_event_id uuid;
  v_end_at timestamptz;
  v_hold_expires_at timestamptz;
  v_lock_studio bigint;
  v_lock_host bigint;
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
  where ss.id=p_service_id and ss.studio_id=p_studio_id and ss.is_active=true and ss.cta_type='reservar'
  for share;
  if not found then raise exception 'El servicio no existe o no acepta reservas.'; end if;

  select * into v_space from public.spaces sp where sp.legacy_studio_id=p_studio_id limit 1;
  if not found then raise exception 'El Studio todavía no tiene un Space canónico.'; end if;

  select * into v_studio_agenda from public.agendas a
  where a.owner_space_id=v_space.id and a.is_default=true
  limit 1;
  if not found then raise exception 'El Studio todavía no tiene Agenda canónica.'; end if;
  if v_studio_agenda.booking_enabled=false then raise exception 'Las reservas no están habilitadas en esta Agenda.'; end if;

  v_host_player_id := coalesce(p_host_player_id, v_space.owner_player_id);
  if v_host_player_id is null then raise exception 'No pudimos resolver el Player anfitrión.'; end if;

  if p_host_player_id is not null and not exists (
    select 1 from public.player_studios ps
    where ps.studio_id=p_studio_id and ps.player_id=p_host_player_id and ps.status='active' and ps.is_visible=true
  ) then
    raise exception 'El Player seleccionado no pertenece a este Studio.';
  end if;

  select * into v_host_agenda from public.agendas a
  where a.owner_player_id=v_host_player_id and a.is_default=true
  limit 1;

  select p.id into v_buyer_player_id
  from public.players p
  where p.owner_user_id=p_buyer_user_id
  limit 1;
  if v_buyer_player_id is null then raise exception 'No pudimos resolver el Player que reserva.'; end if;

  v_end_at := p_scheduled_at + make_interval(mins=>p_duration_minutes);
  v_hold_expires_at := case when p_payment_status='pending' then now()+interval '20 minutes' else null end;

  v_lock_studio := hashtextextended(v_studio_agenda.id::text,0);
  v_lock_host := case when v_host_agenda.id is null then v_lock_studio else hashtextextended(v_host_agenda.id::text,0) end;
  perform pg_advisory_xact_lock(least(v_lock_studio, v_lock_host));
  if v_lock_host <> v_lock_studio then
    perform pg_advisory_xact_lock(greatest(v_lock_studio, v_lock_host));
  end if;

  if not private.agenda_slot_is_available(v_studio_agenda.id,p_scheduled_at,v_end_at) then
    raise exception 'Ese horario ya no está disponible.' using errcode='23P01';
  end if;
  if v_host_agenda.id is not null and v_host_agenda.id <> v_studio_agenda.id
     and not private.agenda_slot_is_available(v_host_agenda.id,p_scheduled_at,v_end_at) then
    raise exception 'El Player seleccionado ya está ocupado en ese horario.' using errcode='23P01';
  end if;

  insert into public.bookings(service_id,studio_id,buyer_id,scheduled_at,duration_minutes,status,price,currency,payment_status,external_reference,notes)
  values(v_service.id,p_studio_id,p_buyer_user_id,p_scheduled_at,p_duration_minutes,'requested',p_price,coalesce(nullif(p_currency,''),'ARS'),p_payment_status,p_external_reference,nullif(btrim(coalesce(p_notes,'')),''))
  returning id into v_booking_id;

  insert into public.agenda_events(primary_agenda_id,created_by_player_id,title,description,event_type,start_at,end_at,event_timezone,all_day,status,visibility,location_type,metadata)
  values(
    v_studio_agenda.id,
    v_buyer_player_id,
    'Reserva: '||v_service.name,
    nullif(btrim(coalesce(p_notes,'')),''),
    'booking',
    p_scheduled_at,
    v_end_at,
    v_studio_agenda.timezone,
    false,
    'scheduled',
    'participants',
    'unspecified',
    jsonb_build_object('booking_id',v_booking_id,'service_id',v_service.id,'studio_id',p_studio_id,'host_player_id',v_host_player_id)
  )
  returning id into v_event_id;

  update public.bookings set agenda_event_id=v_event_id where id=v_booking_id;

  insert into public.agenda_event_agendas(event_id,agenda_id,relation)
  values(v_event_id,v_studio_agenda.id,'primary')
  on conflict (event_id,agenda_id) do nothing;

  if v_host_agenda.id is not null and v_host_agenda.id <> v_studio_agenda.id then
    insert into public.agenda_event_agendas(event_id,agenda_id,relation)
    values(v_event_id,v_host_agenda.id,'invited')
    on conflict (event_id,agenda_id) do nothing;
  end if;

  insert into public.agenda_event_agendas(event_id,agenda_id,relation)
  select v_event_id,a.id,'invited'
  from public.agendas a
  where a.owner_player_id=v_buyer_player_id and a.is_default=true and a.id<>v_studio_agenda.id
  on conflict (event_id,agenda_id) do nothing;

  insert into public.agenda_event_participants(event_id,player_id,role,rsvp_status,invited_by_player_id)
  values
    (v_event_id,v_host_player_id,'host','accepted',v_buyer_player_id),
    (v_event_id,v_buyer_player_id,'participant','accepted',v_buyer_player_id)
  on conflict (event_id,player_id) do update
  set rsvp_status=excluded.rsvp_status,updated_at=now();

  insert into public.agenda_blocks(agenda_id,event_id,booking_id,start_at,end_at,reason,status,created_by_player_id,expires_at)
  values(v_studio_agenda.id,v_event_id,v_booking_id,p_scheduled_at,v_end_at,'Reserva: '||v_service.name,'active',v_buyer_player_id,v_hold_expires_at);

  if v_host_agenda.id is not null and v_host_agenda.id <> v_studio_agenda.id then
    insert into public.agenda_blocks(agenda_id,event_id,booking_id,start_at,end_at,reason,status,created_by_player_id,expires_at)
    values(v_host_agenda.id,v_event_id,v_booking_id,p_scheduled_at,v_end_at,'Reserva IGLÚ: '||v_service.name,'active',v_buyer_player_id,v_hold_expires_at);
  end if;

  return query select v_booking_id,v_event_id;
end;
$$;

revoke all on function public.create_studio_booking_with_player_agenda(uuid,uuid,uuid,uuid,timestamptz,integer,numeric,text,text,text,text) from public;
grant execute on function public.create_studio_booking_with_player_agenda(uuid,uuid,uuid,uuid,timestamptz,integer,numeric,text,text,text,text) to service_role;
