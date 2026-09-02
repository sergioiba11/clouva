-- CLOUVA canonical Agenda.
-- One event is one entity; Player and Space identities only decide ownership,
-- presentation and authority. Studios use their already-normalized Space.

begin;

create table if not exists public.agendas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_player_id uuid references public.players(id) on delete cascade,
  owner_space_id uuid references public.spaces(id) on delete cascade,
  created_by_player_id uuid not null references public.players(id) on delete restrict,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  visibility text not null default 'connections' check (visibility in ('private','connections','public')),
  public_enabled boolean not null default false,
  booking_enabled boolean not null default false,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agendas_exactly_one_owner check (num_nonnulls(owner_player_id, owner_space_id) = 1)
);

create unique index if not exists agendas_default_player_unique
  on public.agendas(owner_player_id) where owner_player_id is not null and is_default;
create unique index if not exists agendas_default_space_unique
  on public.agendas(owner_space_id) where owner_space_id is not null and is_default;
create index if not exists agendas_owner_player_idx on public.agendas(owner_player_id) where owner_player_id is not null;
create index if not exists agendas_owner_space_idx on public.agendas(owner_space_id) where owner_space_id is not null;

create table if not exists public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  primary_agenda_id uuid not null references public.agendas(id) on delete cascade,
  created_by_player_id uuid not null references public.players(id) on delete restrict,
  title text not null,
  description text,
  event_type text not null default 'event',
  start_at timestamptz not null,
  end_at timestamptz not null,
  event_timezone text not null default 'America/Argentina/Buenos_Aires',
  all_day boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  visibility text not null default 'private' check (visibility in ('private','participants','connections','public')),
  location_type text not null default 'unspecified' check (location_type in ('unspecified','physical','online','hybrid')),
  location_text text,
  location_url text,
  recurrence_rule text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenda_events_time_order check (end_at > start_at)
);

create index if not exists agenda_events_primary_start_idx on public.agenda_events(primary_agenda_id,start_at);
create index if not exists agenda_events_window_idx on public.agenda_events(start_at,end_at) where status <> 'cancelled';
create index if not exists agenda_events_creator_idx on public.agenda_events(created_by_player_id,created_at desc);

create table if not exists public.agenda_event_agendas (
  event_id uuid not null references public.agenda_events(id) on delete cascade,
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  relation text not null default 'shared' check (relation in ('primary','shared','invited')),
  created_at timestamptz not null default now(),
  primary key (event_id, agenda_id)
);

create unique index if not exists agenda_event_agendas_one_primary
  on public.agenda_event_agendas(event_id) where relation = 'primary';
create index if not exists agenda_event_agendas_agenda_idx on public.agenda_event_agendas(agenda_id,event_id);

create table if not exists public.agenda_event_participants (
  event_id uuid not null references public.agenda_events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null default 'participant' check (role in ('host','participant')),
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending','accepted','declined','maybe')),
  invited_by_player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, player_id)
);

create index if not exists agenda_event_participants_player_idx
  on public.agenda_event_participants(player_id,rsvp_status,event_id);

create table if not exists public.agenda_members (
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null check (role in ('viewer','participant','editor')),
  status text not null default 'pending' check (status in ('pending','active','declined','revoked')),
  invited_by_player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agenda_id, player_id)
);

create index if not exists agenda_members_player_status_idx on public.agenda_members(player_id,status);

create table if not exists public.agenda_availability_rules (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_local time not null,
  end_local time not null,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  valid_from date,
  valid_until date,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenda_availability_rule_time_order check (end_local <> start_local),
  constraint agenda_availability_rule_dates check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists agenda_availability_rules_agenda_weekday_idx
  on public.agenda_availability_rules(agenda_id,weekday,valid_from,valid_until);

create table if not exists public.agenda_blocks (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  event_id uuid references public.agenda_events(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  status text not null default 'active' check (status in ('active','cancelled')),
  created_by_player_id uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agenda_blocks_time_order check (end_at > start_at)
);

create index if not exists agenda_blocks_agenda_window_idx
  on public.agenda_blocks(agenda_id,start_at,end_at) where status = 'active';
create unique index if not exists agenda_blocks_event_unique
  on public.agenda_blocks(event_id) where event_id is not null and status = 'active';
create unique index if not exists agenda_blocks_booking_unique
  on public.agenda_blocks(booking_id) where booking_id is not null and status = 'active';

create table if not exists public.agenda_event_exceptions (
  id uuid primary key default gen_random_uuid(),
  series_event_id uuid not null references public.agenda_events(id) on delete cascade,
  occurrence_start_at timestamptz not null,
  action text not null check (action in ('cancelled','modified')),
  override_event_id uuid references public.agenda_events(id) on delete cascade,
  created_by_player_id uuid not null references public.players(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_event_id, occurrence_start_at),
  constraint agenda_event_exception_override check (
    (action = 'cancelled' and override_event_id is null)
    or (action = 'modified' and override_event_id is not null)
  )
);

alter table public.bookings add column if not exists agenda_event_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookings_agenda_event_id_fkey'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_agenda_event_id_fkey
      foreign key (agenda_event_id) references public.agenda_events(id) on delete set null;
  end if;
end
$$;
create unique index if not exists bookings_agenda_event_unique
  on public.bookings(agenda_event_id) where agenda_event_id is not null;

-- Agenda is a real Business/Studio capability for current Spaces as well as
-- newly-created ones (the TS defaults are updated in the same feature branch).
update public.spaces
set enabled_modules = array_append(enabled_modules, 'agenda'),
    updated_at = now()
where (business_kind is not null or type in ('studio','business','spot'))
  and not ('agenda' = any(enabled_modules));

-- Existing identities receive one canonical default agenda without creating a
-- second Studio identity. Studio agendas are owned by the Studio's Space.
insert into public.agendas(name,owner_player_id,created_by_player_id,timezone,visibility,public_enabled,booking_enabled,is_default)
select coalesce(nullif(p.display_name,''),'Player') || ' · Agenda', p.id, p.id,
       'America/Argentina/Buenos_Aires','connections',false,false,true
from public.players p
where not exists (
  select 1 from public.agendas a where a.owner_player_id = p.id and a.is_default
);

insert into public.agendas(name,owner_space_id,created_by_player_id,timezone,visibility,public_enabled,booking_enabled,is_default)
select sp.name || ' · Agenda', sp.id, sp.owner_player_id,
       'America/Argentina/Buenos_Aires','connections',false,
       ('bookings' = any(coalesce(sp.enabled_modules,'{}'::text[]))),true
from public.spaces sp
where not exists (
  select 1 from public.agendas a where a.owner_space_id = sp.id and a.is_default
);

create or replace function private.touch_agenda_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.agenda_user_manages_player(p_user_id uuid, p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_player_id is not null and (
    private.user_is_global_admin(p_user_id)
    or exists (
      select 1 from public.players p
      where p.id = p_player_id and p.owner_user_id = p_user_id
    )
    or exists (
      select 1 from public.player_members pm
      where pm.player_id = p_player_id
        and pm.user_id = p_user_id
        and pm.status = 'active'
        and pm.role in ('owner','manager','editor')
    )
  );
$$;

create or replace function private.agenda_role_for_user(p_agenda_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agenda public.agendas%rowtype;
  v_space_role text;
  v_member_role text;
begin
  if p_agenda_id is null or p_user_id is null then return null; end if;
  if private.user_is_global_admin(p_user_id) then return 'owner'; end if;

  select * into v_agenda from public.agendas a where a.id = p_agenda_id;
  if not found then return null; end if;

  if v_agenda.owner_player_id is not null
     and private.agenda_user_manages_player(p_user_id,v_agenda.owner_player_id) then
    return 'owner';
  end if;

  if v_agenda.owner_space_id is not null then
    v_space_role := private.space_role_for_user(v_agenda.owner_space_id,p_user_id);
    if v_space_role = 'owner' then return 'owner'; end if;
    if v_space_role in ('admin','manager') then return 'editor'; end if;
    if v_space_role is not null then return 'viewer'; end if;
  end if;

  select am.role into v_member_role
  from public.agenda_members am
  where am.agenda_id = p_agenda_id
    and am.status = 'active'
    and private.agenda_user_manages_player(p_user_id,am.player_id)
  order by case am.role when 'editor' then 1 when 'participant' then 2 else 3 end
  limit 1;

  return v_member_role;
end;
$$;

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
        (
          e.visibility = 'public'
          and exists (
            select 1
            from public.agenda_event_agendas ea
            join public.agendas a on a.id = ea.agenda_id
            where ea.event_id = e.id and a.public_enabled
          )
        )
        or (
          p_user_id is not null
          and (
            exists (
              select 1 from public.agenda_event_agendas ea
              where ea.event_id = e.id
                and private.agenda_role_for_user(ea.agenda_id,p_user_id) is not null
            )
            or exists (
              select 1 from public.agenda_event_participants ep
              where ep.event_id = e.id
                and private.agenda_user_manages_player(p_user_id,ep.player_id)
            )
          )
        )
      )
  );
$$;

create or replace function private.agenda_event_can_manage(p_event_id uuid, p_user_id uuid)
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
        or private.agenda_role_for_user(e.primary_agenda_id,p_user_id) in ('owner','editor')
      )
  );
$$;

create or replace function private.prevent_agenda_block_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'active' then return new; end if;

  -- Serialize collision checks per Agenda. This makes booking slot protection
  -- transactional without forbidding normal overlapping non-booking events.
  perform pg_advisory_xact_lock(hashtextextended(new.agenda_id::text, 0));

  if exists (
    select 1
    from public.agenda_blocks b
    where b.agenda_id = new.agenda_id
      and b.status = 'active'
      and b.id <> new.id
      and tstzrange(b.start_at,b.end_at,'[)') && tstzrange(new.start_at,new.end_at,'[)')
  ) then
    raise exception 'Ese horario ya no está disponible.' using errcode = '23P01';
  end if;

  return new;
end;
$$;

revoke all on function private.touch_agenda_updated_at() from public,anon,authenticated;
revoke all on function private.agenda_user_manages_player(uuid,uuid) from public,anon,authenticated;
revoke all on function private.agenda_role_for_user(uuid,uuid) from public,anon,authenticated;
revoke all on function private.agenda_event_can_read(uuid,uuid) from public,anon,authenticated;
revoke all on function private.agenda_event_can_manage(uuid,uuid) from public,anon,authenticated;
revoke all on function private.prevent_agenda_block_overlap() from public,anon,authenticated;

create trigger agendas_touch_updated_at
before update on public.agendas for each row execute function private.touch_agenda_updated_at();
create trigger agenda_events_touch_updated_at
before update on public.agenda_events for each row execute function private.touch_agenda_updated_at();
create trigger agenda_event_participants_touch_updated_at
before update on public.agenda_event_participants for each row execute function private.touch_agenda_updated_at();
create trigger agenda_members_touch_updated_at
before update on public.agenda_members for each row execute function private.touch_agenda_updated_at();
create trigger agenda_availability_rules_touch_updated_at
before update on public.agenda_availability_rules for each row execute function private.touch_agenda_updated_at();
create trigger agenda_blocks_touch_updated_at
before update on public.agenda_blocks for each row execute function private.touch_agenda_updated_at();
create trigger agenda_event_exceptions_touch_updated_at
before update on public.agenda_event_exceptions for each row execute function private.touch_agenda_updated_at();
create trigger agenda_blocks_prevent_overlap
before insert or update of agenda_id,start_at,end_at,status on public.agenda_blocks
for each row execute function private.prevent_agenda_block_overlap();

alter table public.agendas enable row level security;
alter table public.agenda_events enable row level security;
alter table public.agenda_event_agendas enable row level security;
alter table public.agenda_event_participants enable row level security;
alter table public.agenda_members enable row level security;
alter table public.agenda_availability_rules enable row level security;
alter table public.agenda_blocks enable row level security;
alter table public.agenda_event_exceptions enable row level security;

revoke insert,update,delete on public.agendas from anon,authenticated;
revoke insert,update,delete on public.agenda_events from anon,authenticated;
revoke insert,update,delete on public.agenda_event_agendas from anon,authenticated;
revoke insert,update,delete on public.agenda_event_participants from anon,authenticated;
revoke insert,update,delete on public.agenda_members from anon,authenticated;
revoke insert,update,delete on public.agenda_availability_rules from anon,authenticated;
revoke insert,update,delete on public.agenda_blocks from anon,authenticated;
revoke insert,update,delete on public.agenda_event_exceptions from anon,authenticated;

grant select on public.agendas to anon,authenticated;
grant select on public.agenda_events to anon,authenticated;
grant select on public.agenda_event_agendas to anon,authenticated;
grant select on public.agenda_event_participants to authenticated;
grant select on public.agenda_members to authenticated;
grant select on public.agenda_availability_rules to authenticated;
grant select on public.agenda_blocks to authenticated;
grant select on public.agenda_event_exceptions to authenticated;

create policy agendas_public_or_authorized_select on public.agendas
for select to anon,authenticated
using (public_enabled or private.agenda_role_for_user(id,(select auth.uid())) is not null);

create policy agenda_events_authorized_select on public.agenda_events
for select to anon,authenticated
using (private.agenda_event_can_read(id,(select auth.uid())));

create policy agenda_event_agendas_authorized_select on public.agenda_event_agendas
for select to anon,authenticated
using (private.agenda_event_can_read(event_id,(select auth.uid())));

create policy agenda_event_participants_self_or_manager_select on public.agenda_event_participants
for select to authenticated
using (
  private.agenda_user_manages_player((select auth.uid()),player_id)
  or private.agenda_event_can_manage(event_id,(select auth.uid()))
);

create policy agenda_members_self_or_manager_select on public.agenda_members
for select to authenticated
using (
  private.agenda_user_manages_player((select auth.uid()),player_id)
  or private.agenda_role_for_user(agenda_id,(select auth.uid())) in ('owner','editor')
);

create policy agenda_availability_authorized_select on public.agenda_availability_rules
for select to authenticated
using (private.agenda_role_for_user(agenda_id,(select auth.uid())) is not null);

create policy agenda_blocks_authorized_select on public.agenda_blocks
for select to authenticated
using (private.agenda_role_for_user(agenda_id,(select auth.uid())) is not null);

create policy agenda_event_exceptions_authorized_select on public.agenda_event_exceptions
for select to authenticated
using (private.agenda_event_can_read(series_event_id,(select auth.uid())));

-- Realtime is the propagation layer; RLS remains the authorization layer.
do $$
begin
  begin alter publication supabase_realtime add table public.agendas; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.agenda_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.agenda_event_agendas; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.agenda_event_participants; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.agenda_blocks; exception when duplicate_object then null; end;
end
$$;

commit;
