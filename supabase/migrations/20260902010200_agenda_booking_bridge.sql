-- Unify the existing Studio Booking domain with canonical Agenda.
-- One DB transaction owns booking + event + participants + slot block.

begin;

alter table public.agenda_blocks
  add column if not exists expires_at timestamptz;
create index if not exists agenda_blocks_expiry_idx
  on public.agenda_blocks(expires_at)
  where status = 'active' and expires_at is not null;

create or replace function private.prevent_agenda_block_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then return new; end if;
  if new.expires_at is not null and new.expires_at <= now() then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(new.agenda_id::text, 0));

  if exists (
    select 1
    from public.agenda_blocks b
    where b.agenda_id = new.agenda_id
      and b.status = 'active'
      and (b.expires_at is null or b.expires_at > now())
      and b.id <> new.id
      and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
  ) then
    raise exception 'Ese horario ya no está disponible.' using errcode = '23P01';
  end if;

  return new;
end;
$$;

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

  select p.id into v_buyer_player_id
  from public.players p
  where p.owner_user_id = p_buyer_user_id
  limit 1;
  if v_buyer_player_id is null then raise exception 'No pudimos resolver el Player que reserva.'; end if;

  v_end_at := p_scheduled_at + make_interval(mins => p_duration_minutes);
  v_hold_expires_at := case when p_payment_status = 'pending' then now() + interval '20 minutes' else null end;

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

create or replace function private.sync_booking_agenda_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agenda_event_id is null then return new; end if;

  if new.status = 'cancelled' then
    update public.agenda_events
      set status = 'cancelled', updated_at = now()
      where id = new.agenda_event_id and status <> 'cancelled';
    update public.agenda_blocks
      set status = 'cancelled', updated_at = now()
      where booking_id = new.id and status = 'active';
  elsif new.status = 'completed' then
    update public.agenda_events
      set status = 'completed', updated_at = now()
      where id = new.agenda_event_id;
    update public.agenda_blocks
      set status = 'cancelled', updated_at = now()
      where booking_id = new.id and status = 'active';
  elsif new.status = 'confirmed' then
    update public.agenda_events
      set status = 'scheduled', updated_at = now()
      where id = new.agenda_event_id;
    update public.agenda_blocks
      set status = 'active', expires_at = null, updated_at = now()
      where booking_id = new.id;
  elsif new.payment_status = 'failed' then
    update public.agenda_events
      set status = 'cancelled', updated_at = now()
      where id = new.agenda_event_id;
    update public.agenda_blocks
      set status = 'cancelled', updated_at = now()
      where booking_id = new.id and status = 'active';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_booking_agenda_state() from public,anon,authenticated;
drop trigger if exists bookings_sync_agenda_state on public.bookings;
create trigger bookings_sync_agenda_state
after update of status,payment_status on public.bookings
for each row execute function private.sync_booking_agenda_state();

-- Canonical Space permissions become the Booking authorization boundary.
drop policy if exists bookings_select_buyer_or_manager_or_admin on public.bookings;
create policy bookings_select_buyer_or_space_manager
  on public.bookings for select
  using (
    buyer_id = (select auth.uid())
    or private.user_is_global_admin((select auth.uid()))
    or exists (
      select 1 from public.spaces sp
      where sp.legacy_studio_id = bookings.studio_id
        and private.space_role_for_user(sp.id,(select auth.uid())) in ('owner','admin','manager')
    )
  );

drop policy if exists bookings_update_manager_or_admin on public.bookings;
create policy bookings_update_space_manager
  on public.bookings for update
  using (
    private.user_is_global_admin((select auth.uid()))
    or exists (
      select 1 from public.spaces sp
      where sp.legacy_studio_id = bookings.studio_id
        and private.space_role_for_user(sp.id,(select auth.uid())) in ('owner','admin','manager')
    )
  )
  with check (
    private.user_is_global_admin((select auth.uid()))
    or exists (
      select 1 from public.spaces sp
      where sp.legacy_studio_id = bookings.studio_id
        and private.space_role_for_user(sp.id,(select auth.uid())) in ('owner','admin','manager')
    )
  );

commit;
