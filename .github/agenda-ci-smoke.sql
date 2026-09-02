-- Behavioral smoke checks for the canonical Agenda package.
-- Runs only against the isolated CI database.

insert into auth.users(id,email,aud,role,raw_user_meta_data,raw_app_meta_data)
values
  ('00000000-0000-4000-8000-000000000001','agenda-a@example.test','authenticated','authenticated','{}','{}'),
  ('00000000-0000-4000-8000-000000000002','agenda-b@example.test','authenticated','authenticated','{}','{}');

insert into public.profiles(id,role)
values
  ('00000000-0000-4000-8000-000000000001','user'),
  ('00000000-0000-4000-8000-000000000002','user');

insert into public.players(id,owner_user_id,display_name,username)
values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Player A','player-a'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Player B','player-b');

insert into public.player_members(player_id,user_id,role,status)
values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner','active'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','owner','active');

insert into public.studios(id,owner_id,slug,name)
values ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','agenda-test-studio','Agenda Test Studio');

insert into public.spaces(
  id,type,slug,name,owner_player_id,business_kind,enabled_modules,legacy_studio_id
) values (
  '30000000-0000-4000-8000-000000000001','studio','agenda-test-space','Agenda Test Studio',
  '10000000-0000-4000-8000-000000000001','studio',array['studio_os','services','bookings','agenda'],
  '20000000-0000-4000-8000-000000000001'
);

insert into public.space_members(space_id,player_id,role,status)
values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','active');

insert into public.studio_services(id,studio_id,name,price,currency,price_type,cta_type,is_active)
values (
  '40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  'Sesión de prueba',null,'ARS','consultar','reservar',true
);

do $$
declare
  v_player_a_agenda uuid;
  v_player_b_agenda uuid;
  v_space_agenda uuid;
  v_event uuid;
  v_booking uuid;
  v_event_count integer;
  v_relation_count integer;
  v_booking_start timestamptz;
  v_booking_status text;
begin
  select id into v_player_a_agenda from public.agendas
  where owner_player_id='10000000-0000-4000-8000-000000000001' and is_default;
  select id into v_player_b_agenda from public.agendas
  where owner_player_id='10000000-0000-4000-8000-000000000002' and is_default;
  select id into v_space_agenda from public.agendas
  where owner_space_id='30000000-0000-4000-8000-000000000001' and is_default;

  if v_player_a_agenda is null or v_player_b_agenda is null or v_space_agenda is null then
    raise exception 'Default Agenda identity triggers did not create all expected agendas.';
  end if;

  if not (select booking_enabled from public.agendas where id=v_space_agenda) then
    raise exception 'Studio Space Agenda did not inherit booking capability.';
  end if;

  -- One canonical event shared by two Player agendas.
  insert into public.agenda_events(
    primary_agenda_id,created_by_player_id,title,event_type,start_at,end_at,event_timezone,visibility
  ) values (
    v_player_a_agenda,'10000000-0000-4000-8000-000000000001','Evento compartido','session',
    '2026-09-10 21:00:00+00','2026-09-10 22:00:00+00','America/Argentina/Buenos_Aires','participants'
  ) returning id into v_event;

  insert into public.agenda_event_agendas(event_id,agenda_id,relation) values
    (v_event,v_player_a_agenda,'primary'),
    (v_event,v_player_b_agenda,'invited');
  insert into public.agenda_event_participants(event_id,player_id,role,rsvp_status) values
    (v_event,'10000000-0000-4000-8000-000000000001','host','accepted'),
    (v_event,'10000000-0000-4000-8000-000000000002','participant','pending');

  select count(*) into v_event_count from public.agenda_events where id=v_event;
  select count(*) into v_relation_count from public.agenda_event_agendas where event_id=v_event;
  if v_event_count <> 1 or v_relation_count <> 2 then
    raise exception 'Canonical event fan-out invariant failed.';
  end if;

  update public.agenda_events set start_at='2026-09-10 22:00:00+00',end_at='2026-09-10 23:00:00+00' where id=v_event;
  if (select start_at from public.agenda_events where id=v_event) <> '2026-09-10 22:00:00+00'::timestamptz then
    raise exception 'Canonical event update did not persist.';
  end if;

  update public.agenda_event_participants
  set rsvp_status='declined'
  where event_id=v_event and player_id='10000000-0000-4000-8000-000000000002';
  if (select status from public.agenda_events where id=v_event) <> 'scheduled' then
    raise exception 'RSVP changed the canonical event status.';
  end if;

  -- Monday 21:00-02:00. 2026-09-08 01:00 America/Argentina/Buenos_Aires is
  -- Tuesday locally but must match Monday's overnight availability window.
  insert into public.agenda_availability_rules(
    agenda_id,weekday,start_local,end_local,timezone,is_available
  ) values (
    v_space_agenda,1,'21:00','02:00','America/Argentina/Buenos_Aires',true
  );

  select booking_id,agenda_event_id into v_booking,v_event
  from public.create_studio_booking_with_agenda(
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '2026-09-08 04:00:00+00',60,null,'ARS','not_required',null,'overnight smoke'
  );

  if v_booking is null or v_event is null then
    raise exception 'Booking bridge did not return canonical ids.';
  end if;
  if (select agenda_event_id from public.bookings where id=v_booking) <> v_event then
    raise exception 'Booking is not linked to its canonical Agenda event.';
  end if;
  if not exists (
    select 1 from public.agenda_event_agendas
    where event_id=v_event and agenda_id=v_space_agenda and relation='primary'
  ) then
    raise exception 'Booking event is missing from the Studio Space Agenda.';
  end if;
  if not exists (
    select 1 from public.agenda_event_agendas
    where event_id=v_event and agenda_id=v_player_b_agenda and relation='invited'
  ) then
    raise exception 'Booking event is missing from the buyer Player Agenda.';
  end if;

  -- Concurrent-equivalent second booking of the same occupied slot must fail.
  begin
    perform public.create_studio_booking_with_agenda(
      '40000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '2026-09-08 04:00:00+00',60,null,'ARS','not_required',null,'collision smoke'
    );
    raise exception 'Double booking was not rejected.';
  exception
    when exclusion_violation then null;
  end;

  -- Moving the canonical booking event keeps the legacy Booking row in sync.
  update public.agenda_events
  set start_at='2026-09-08 04:30:00+00',end_at='2026-09-08 05:30:00+00'
  where id=v_event;
  select scheduled_at into v_booking_start from public.bookings where id=v_booking;
  if v_booking_start <> '2026-09-08 04:30:00+00'::timestamptz then
    raise exception 'Moving Agenda event did not synchronize Booking time.';
  end if;

  update public.agenda_events set status='cancelled' where id=v_event;
  select status into v_booking_status from public.bookings where id=v_booking;
  if v_booking_status <> 'cancelled' then
    raise exception 'Cancelling Agenda event did not synchronize Booking status.';
  end if;
end
$$;
