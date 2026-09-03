-- CLOUVA: trusted map + private purchase identity.
-- Public Player locality stays in players.location/latitude/longitude.
-- Precise session GPS and purchase data live only in private, RLS-protected tables.

create table if not exists public.account_private_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_private_data_birth_not_future check (date_of_birth is null or date_of_birth <= current_date)
);

create table if not exists public.user_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Principal',
  recipient_name text not null,
  recipient_phone text,
  recipient_email text,
  address_line_1 text not null,
  address_line_2 text,
  city text not null,
  province text not null,
  postal_code text not null,
  country text not null default 'AR',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_addresses_country_length check (char_length(country) = 2)
);

create unique index if not exists user_addresses_one_default_per_user
  on public.user_addresses(user_id) where is_default;
create index if not exists user_addresses_user_idx on public.user_addresses(user_id, updated_at desc);

create table if not exists public.trusted_map_connections (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint trusted_map_connections_not_self check (requester_user_id <> recipient_user_id),
  constraint trusted_map_connections_status check (status in ('pending','accepted','rejected','revoked'))
);

create unique index if not exists trusted_map_connections_unique_pair
  on public.trusted_map_connections(least(requester_user_id, recipient_user_id), greatest(requester_user_id, recipient_user_id));
create index if not exists trusted_map_connections_requester_idx on public.trusted_map_connections(requester_user_id, status);
create index if not exists trusted_map_connections_recipient_idx on public.trusted_map_connections(recipient_user_id, status);

create table if not exists public.trusted_map_groups (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trusted_map_groups_name_length check (char_length(btrim(name)) between 1 and 80)
);

create table if not exists public.trusted_map_group_members (
  group_id uuid not null references public.trusted_map_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (group_id, user_id),
  constraint trusted_map_group_members_status check (status in ('pending','accepted','rejected','left','revoked'))
);
create index if not exists trusted_map_group_members_user_idx on public.trusted_map_group_members(user_id, status);

create table if not exists public.trusted_map_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  sharing_status text not null default 'paused',
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint trusted_map_locations_latitude check (latitude is null or latitude between -90 and 90),
  constraint trusted_map_locations_longitude check (longitude is null or longitude between -180 and 180),
  constraint trusted_map_locations_accuracy check (accuracy_meters is null or accuracy_meters >= 0),
  constraint trusted_map_locations_status check (sharing_status in ('sharing','paused')),
  constraint trusted_map_locations_coordinates_pair check ((latitude is null) = (longitude is null))
);
create index if not exists trusted_map_locations_expiry_idx on public.trusted_map_locations(expires_at);

create or replace function public.trusted_map_is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trusted_map_groups g
    left join public.trusted_map_group_members m
      on m.group_id = g.id and m.user_id = p_user_id and m.status = 'accepted'
    where g.id = p_group_id and (g.owner_user_id = p_user_id or m.user_id is not null)
  );
$$;

create or replace function public.trusted_map_can_view_user(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() = p_target_user_id
    or exists (
      select 1 from public.trusted_map_connections c
      where c.status = 'accepted'
        and ((c.requester_user_id = auth.uid() and c.recipient_user_id = p_target_user_id)
          or (c.recipient_user_id = auth.uid() and c.requester_user_id = p_target_user_id))
    )
    or exists (
      select 1
      from public.trusted_map_group_members mine
      join public.trusted_map_group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid() and mine.status = 'accepted'
        and theirs.user_id = p_target_user_id and theirs.status = 'accepted'
    )
    or exists (
      select 1
      from public.trusted_map_groups g
      join public.trusted_map_group_members theirs on theirs.group_id = g.id
      where g.owner_user_id = auth.uid()
        and theirs.user_id = p_target_user_id and theirs.status = 'accepted'
    )
    or exists (
      select 1
      from public.trusted_map_groups g
      join public.trusted_map_group_members mine on mine.group_id = g.id
      where g.owner_user_id = p_target_user_id
        and mine.user_id = auth.uid() and mine.status = 'accepted'
    );
$$;

create or replace function public.trusted_map_has_audience(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trusted_map_connections c
    where c.status = 'accepted' and (c.requester_user_id = p_user_id or c.recipient_user_id = p_user_id)
  ) or exists (
    select 1
    from public.trusted_map_group_members me
    join public.trusted_map_group_members other on other.group_id = me.group_id and other.user_id <> p_user_id and other.status = 'accepted'
    where me.user_id = p_user_id and me.status = 'accepted'
  ) or exists (
    select 1 from public.trusted_map_groups g
    join public.trusted_map_group_members other on other.group_id = g.id and other.status = 'accepted'
    where g.owner_user_id = p_user_id
  );
$$;

revoke all on function public.trusted_map_is_group_member(uuid, uuid) from public;
revoke all on function public.trusted_map_can_view_user(uuid) from public;
revoke all on function public.trusted_map_has_audience(uuid) from public;
grant execute on function public.trusted_map_is_group_member(uuid, uuid) to authenticated;
grant execute on function public.trusted_map_can_view_user(uuid) to authenticated;
grant execute on function public.trusted_map_has_audience(uuid) to authenticated;

alter table public.account_private_data enable row level security;
alter table public.user_addresses enable row level security;
alter table public.trusted_map_connections enable row level security;
alter table public.trusted_map_groups enable row level security;
alter table public.trusted_map_group_members enable row level security;
alter table public.trusted_map_locations enable row level security;

drop policy if exists account_private_data_own on public.account_private_data;
create policy account_private_data_own on public.account_private_data
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_addresses_own on public.user_addresses;
create policy user_addresses_own on public.user_addresses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists trusted_map_connections_participants_read on public.trusted_map_connections;
create policy trusted_map_connections_participants_read on public.trusted_map_connections
  for select to authenticated
  using (requester_user_id = auth.uid() or recipient_user_id = auth.uid());

drop policy if exists trusted_map_groups_members_read on public.trusted_map_groups;
create policy trusted_map_groups_members_read on public.trusted_map_groups
  for select to authenticated
  using (owner_user_id = auth.uid() or public.trusted_map_is_group_member(id, auth.uid()));

drop policy if exists trusted_map_group_members_group_read on public.trusted_map_group_members;
create policy trusted_map_group_members_group_read on public.trusted_map_group_members
  for select to authenticated
  using (user_id = auth.uid() or public.trusted_map_is_group_member(group_id, auth.uid()));

drop policy if exists trusted_map_locations_authorized_read on public.trusted_map_locations;
create policy trusted_map_locations_authorized_read on public.trusted_map_locations
  for select to authenticated
  using (public.trusted_map_can_view_user(user_id));

drop policy if exists trusted_map_locations_own_insert on public.trusted_map_locations;
create policy trusted_map_locations_own_insert on public.trusted_map_locations
  for insert to authenticated
  with check (user_id = auth.uid() and public.trusted_map_has_audience(auth.uid()));

drop policy if exists trusted_map_locations_own_update on public.trusted_map_locations;
create policy trusted_map_locations_own_update on public.trusted_map_locations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.trusted_map_has_audience(auth.uid()));

drop policy if exists trusted_map_locations_own_delete on public.trusted_map_locations;
create policy trusted_map_locations_own_delete on public.trusted_map_locations
  for delete to authenticated
  using (user_id = auth.uid());

-- Realtime carries only the latest row. There is deliberately no position-history table.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trusted_map_locations'
     ) then
    alter publication supabase_realtime add table public.trusted_map_locations;
  end if;
end $$;
