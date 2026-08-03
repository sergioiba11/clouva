-- CLOUVA multirol + Studio OS foundation.
-- Preserves the existing identity, billing, Players and Estudios architecture.
-- This migration intentionally does not touch Avatar Analyzer, Blender, Unreal
-- or any 3D pipeline table.

begin;

-- ---------------------------------------------------------------------------
-- User modes: intentions/capabilities are not professional identity or auth roles.
-- ---------------------------------------------------------------------------

create table if not exists public.profile_modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in (
    'explore', 'player', 'services', 'studio_owner', 'studio_manager', 'seller', 'gamer'
  )),
  status text not null default 'active' check (status in ('active', 'inactive')),
  activated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, mode)
);

create index if not exists profile_modes_user_idx on public.profile_modes(user_id, status);
alter table public.profile_modes enable row level security;
drop policy if exists profile_modes_select_self_or_admin on public.profile_modes;
create policy profile_modes_select_self_or_admin
  on public.profile_modes for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------------
-- Rename the too-narrow fan table into the canonical studio membership table.
-- Existing rows, FKs and IDs are preserved.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.studio_fan_memberships') is not null
     and to_regclass('public.studio_memberships') is null then
    alter table public.studio_fan_memberships rename to studio_memberships;
  end if;
end $$;

alter table public.studio_memberships
  add column if not exists player_id uuid references public.players(id) on delete set null,
  add column if not exists public_role_key text,
  add column if not exists public_role_label text,
  add column if not exists area_key text,
  add column if not exists area_label text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.studio_memberships
  drop constraint if exists studio_fan_memberships_status_check;
alter table public.studio_memberships
  drop constraint if exists studio_memberships_status_check;
alter table public.studio_memberships
  add constraint studio_memberships_status_check
  check (status in ('pending', 'active', 'cancelled', 'expired', 'rejected'));

create unique index if not exists studio_memberships_studio_player_unique
  on public.studio_memberships(studio_id, player_id)
  where player_id is not null;
create index if not exists studio_memberships_player_idx
  on public.studio_memberships(player_id, status);

-- Public role/area are plan configuration, not global Player identity.
alter table public.studio_membership_plans
  add column if not exists public_role_key text not null default 'artist',
  add column if not exists public_role_label text not null default 'Artista',
  add column if not exists area_key text not null default 'artistic',
  add column if not exists area_label text not null default 'Artística',
  add column if not exists join_policy text not null default 'automatic',
  add column if not exists requires_approval boolean not null default false,
  add column if not exists display_badge text;

alter table public.studio_membership_plans
  drop constraint if exists studio_membership_plans_join_policy_check;
alter table public.studio_membership_plans
  add constraint studio_membership_plans_join_policy_check
  check (join_policy in ('automatic', 'approval', 'invitation_only'));

-- player_studios is the public projection of a Player inside a Studio.
alter table public.player_studios
  add column if not exists area_key text,
  add column if not exists area_label text,
  add column if not exists source_membership_id uuid references public.studio_memberships(id) on delete set null,
  add column if not exists status text not null default 'active';

alter table public.player_studios
  drop constraint if exists player_studios_status_check;
alter table public.player_studios
  add constraint player_studios_status_check check (status in ('pending', 'active', 'inactive'));

-- Retains contextual intent when a user joins before having a Player.
create table if not exists public.pending_studio_joins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  plan_id uuid references public.studio_membership_plans(id) on delete set null,
  membership_id uuid references public.studio_memberships(id) on delete cascade,
  return_path text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, studio_id)
);

alter table public.pending_studio_joins enable row level security;
drop policy if exists pending_studio_joins_select_self_or_admin on public.pending_studio_joins;
create policy pending_studio_joins_select_self_or_admin
  on public.pending_studio_joins for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------------
-- Studio OS belongs to the Studio. Managers do not buy personal VIP to work.
-- ---------------------------------------------------------------------------

alter table public.studios
  add column if not exists studio_os_status text not null default 'pending',
  add column if not exists studio_os_subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  add column if not exists studio_os_activated_at timestamptz,
  add column if not exists studio_os_expires_at timestamptz;

alter table public.studios
  drop constraint if exists studios_studio_os_status_check;
alter table public.studios
  add constraint studios_studio_os_status_check
  check (studio_os_status in ('pending', 'active', 'grace', 'suspended', 'cancelled', 'legacy_active'));

alter table public.billing_subscriptions
  add column if not exists studio_id uuid references public.studios(id) on delete set null;
create index if not exists billing_subscriptions_studio_idx
  on public.billing_subscriptions(studio_id, status, created_at desc)
  where studio_id is not null;

-- Product identity only. Price remains an explicit business configuration.
insert into public.billing_products (code, name, description, entitlement_tier, is_active, metadata)
values (
  'clouva_studio_os',
  'CLOUVA Studio OS',
  'Sistema operativo para crear, administrar y monetizar un Estudio dentro de CLOUVA.',
  'studio_member',
  false,
  '{"product_scope":"studio_os"}'::jsonb
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    entitlement_tier = excluded.entitlement_tier,
    metadata = public.billing_products.metadata || excluded.metadata;

-- Existing real Studios keep working while they migrate to a paid Studio OS plan.
update public.studios
set studio_os_status = 'legacy_active',
    studio_os_activated_at = coalesce(studio_os_activated_at, created_at)
where studio_os_status = 'pending';

-- Invitations no longer force every invited manager to purchase global VIP.
alter table public.studio_access_claims alter column requires_vip set default false;
update public.studio_access_claims set requires_vip = false where status = 'pending';

-- ---------------------------------------------------------------------------
-- Permission helpers: internal permission + active Studio OS, no personal VIP.
-- ---------------------------------------------------------------------------

create or replace function public.is_studio_os_active(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.studios s
    where s.id = p_studio_id
      and s.studio_os_status in ('active', 'grace', 'legacy_active')
      and (s.studio_os_expires_at is null or s.studio_os_expires_at > now())
  );
$$;

create or replace function public.can_manage_studio(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and public.is_studio_os_active(p_studio_id)
    and (
      exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = auth.uid())
      or exists (
        select 1 from public.studio_members sm
        where sm.studio_id = p_studio_id
          and sm.profile_id = auth.uid()
          and sm.status = 'active'
          and sm.role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
      )
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    );
$$;

create or replace function public.can_manage_studio(p_studio_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and p_user_id = auth.uid()
    and public.is_studio_os_active(p_studio_id)
    and (
      exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = p_user_id)
      or exists (
        select 1 from public.studio_members sm
        where sm.studio_id = p_studio_id
          and sm.profile_id = p_user_id
          and sm.status = 'active'
          and sm.role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
      )
      or exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin')
    );
$$;

-- Studio creation is server/RPC only from now on.
drop policy if exists studios_insert_entitled on public.studios;

-- ---------------------------------------------------------------------------
-- Atomic Studio creation and membership/public-affiliation projection.
-- ---------------------------------------------------------------------------

create or replace function public.create_studio_os_draft(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_city text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_studio public.studios%rowtype;
  v_player_id uuid;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'La cuenta no tiene un perfil CLOUVA válido';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'El nombre del Estudio es obligatorio';
  end if;

  v_base_slug := lower(regexp_replace(coalesce(nullif(btrim(p_slug), ''), btrim(p_name)), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then v_base_slug := 'estudio'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.studios where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  insert into public.studios (
    owner_id, name, slug, city, description,
    is_published, publication_status, studio_os_status
  ) values (
    p_user_id, btrim(p_name), v_slug, nullif(btrim(p_city), ''), nullif(btrim(p_description), ''),
    false, 'draft', 'pending'
  ) returning * into v_studio;

  insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
  values (v_studio.id, p_user_id, 'owner', 'active', now())
  on conflict (studio_id, profile_id) do update
  set role = 'owner', status = 'active', joined_at = coalesce(public.studio_members.joined_at, now());

  select id into v_player_id from public.players where owner_user_id = p_user_id limit 1;
  if v_player_id is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label,
      is_primary, is_visible, status, joined_at
    ) values (
      v_player_id, v_studio.id, 'Fundador', 'direction', 'Dirección',
      false, false, 'pending', now()
    )
    on conflict (player_id, studio_id) do update
    set role = 'Fundador', area_key = 'direction', area_label = 'Dirección',
        status = 'pending', is_visible = false, left_at = null, updated_at = now();
  end if;

  insert into public.studio_membership_plans (
    studio_id, name, slug, description, is_free, price, billing_interval,
    benefits, display_order, public_role_key, public_role_label,
    area_key, area_label, join_policy, requires_approval, display_badge, created_by
  ) values (
    v_studio.id, 'Artista', 'artista', 'Sumate gratis como Artista del Estudio.',
    true, null, null,
    '["Aparecer como Artista del Estudio","Recibir novedades y oportunidades"]'::jsonb,
    0, 'artist', 'Artista', 'artistic', 'Artística', 'automatic', false, 'ARTISTA', p_user_id
  );

  insert into public.profile_modes (user_id, mode, status)
  values (p_user_id, 'studio_owner', 'active')
  on conflict (user_id, mode) do update
  set status = 'active', activated_at = now(), updated_at = now();

  return jsonb_build_object(
    'id', v_studio.id,
    'slug', v_studio.slug,
    'name', v_studio.name,
    'studioOsStatus', v_studio.studio_os_status
  );
end;
$$;

create or replace function public.activate_studio_membership(
  p_user_id uuid,
  p_studio_id uuid,
  p_plan_id uuid,
  p_source text default 'direct',
  p_subscription_id uuid default null,
  p_force_active boolean default false,
  p_return_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.studio_membership_plans%rowtype;
  v_membership public.studio_memberships%rowtype;
  v_player_id uuid;
  v_status text;
begin
  select * into v_plan
  from public.studio_membership_plans
  where id = p_plan_id and studio_id = p_studio_id and is_active = true;

  if not found then raise exception 'El plan no está disponible'; end if;
  if v_plan.join_policy = 'invitation_only' and not p_force_active then
    raise exception 'Este plan requiere una invitación';
  end if;

  v_status := case
    when p_force_active then 'active'
    when v_plan.requires_approval or v_plan.join_policy = 'approval' then 'pending'
    else 'active'
  end;

  select id into v_player_id from public.players where owner_user_id = p_user_id limit 1;

  insert into public.studio_memberships (
    studio_id, user_id, player_id, plan_id, status, source, subscription_id,
    public_role_key, public_role_label, area_key, area_label,
    approved_by, approved_at, joined_at, updated_at
  ) values (
    p_studio_id, p_user_id, v_player_id, v_plan.id, v_status, coalesce(nullif(p_source, ''), 'direct'), p_subscription_id,
    v_plan.public_role_key, v_plan.public_role_label, v_plan.area_key, v_plan.area_label,
    case when p_force_active then p_user_id else null end,
    case when p_force_active then now() else null end,
    now(), now()
  )
  on conflict (studio_id, user_id) do update
  set player_id = coalesce(excluded.player_id, public.studio_memberships.player_id),
      plan_id = excluded.plan_id,
      status = excluded.status,
      source = excluded.source,
      subscription_id = coalesce(excluded.subscription_id, public.studio_memberships.subscription_id),
      public_role_key = excluded.public_role_key,
      public_role_label = excluded.public_role_label,
      area_key = excluded.area_key,
      area_label = excluded.area_label,
      approved_by = coalesce(excluded.approved_by, public.studio_memberships.approved_by),
      approved_at = coalesce(excluded.approved_at, public.studio_memberships.approved_at),
      joined_at = case when public.studio_memberships.status <> 'active' and excluded.status = 'active' then now() else public.studio_memberships.joined_at end,
      updated_at = now()
  returning * into v_membership;

  if v_status = 'active' and v_player_id is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label, source_membership_id,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      v_player_id, p_studio_id, v_plan.public_role_label, v_plan.area_key, v_plan.area_label, v_membership.id,
      false, true, 'active', now(), null
    )
    on conflict (player_id, studio_id) do update
    set role = excluded.role,
        area_key = excluded.area_key,
        area_label = excluded.area_label,
        source_membership_id = excluded.source_membership_id,
        is_visible = true,
        status = 'active',
        left_at = null,
        updated_at = now();

    delete from public.pending_studio_joins where user_id = p_user_id and studio_id = p_studio_id;
  elsif v_status = 'active' then
    insert into public.pending_studio_joins (
      user_id, studio_id, plan_id, membership_id, return_path, status
    ) values (
      p_user_id, p_studio_id, v_plan.id, v_membership.id, p_return_path, 'pending'
    )
    on conflict (user_id, studio_id) do update
    set plan_id = excluded.plan_id,
        membership_id = excluded.membership_id,
        return_path = coalesce(excluded.return_path, public.pending_studio_joins.return_path),
        status = 'pending',
        completed_at = null;
  end if;

  return jsonb_build_object(
    'membershipId', v_membership.id,
    'status', v_status,
    'playerId', v_player_id,
    'needsPlayer', v_player_id is null,
    'publicRole', v_plan.public_role_label,
    'area', v_plan.area_label
  );
end;
$$;

create or replace function public.complete_pending_studio_joins(p_user_id uuid, p_player_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.studio_memberships%rowtype;
  v_count integer := 0;
begin
  if not exists (select 1 from public.players where id = p_player_id and owner_user_id = p_user_id) then
    raise exception 'El Player no pertenece a la cuenta';
  end if;

  for v_membership in
    select * from public.studio_memberships
    where user_id = p_user_id and status = 'active'
  loop
    update public.studio_memberships
    set player_id = p_player_id, updated_at = now()
    where id = v_membership.id;

    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label, source_membership_id,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      p_player_id, v_membership.studio_id, coalesce(v_membership.public_role_label, 'Miembro'),
      v_membership.area_key, v_membership.area_label, v_membership.id,
      false, true, 'active', coalesce(v_membership.joined_at, now()), null
    )
    on conflict (player_id, studio_id) do update
    set role = excluded.role,
        area_key = excluded.area_key,
        area_label = excluded.area_label,
        source_membership_id = excluded.source_membership_id,
        is_visible = true,
        status = 'active',
        left_at = null,
        updated_at = now();

    update public.pending_studio_joins
    set status = 'completed', completed_at = now()
    where user_id = p_user_id and studio_id = v_membership.studio_id and status = 'pending';
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.activate_studio_os(
  p_studio_id uuid,
  p_subscription_id uuid,
  p_period_end timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.studios
  set studio_os_status = 'active',
      studio_os_subscription_id = p_subscription_id,
      studio_os_activated_at = coalesce(studio_os_activated_at, now()),
      studio_os_expires_at = p_period_end,
      is_published = true,
      publication_status = 'published',
      updated_at = now()
  where id = p_studio_id;

  update public.player_studios
  set status = 'active', is_visible = true, updated_at = now()
  where studio_id = p_studio_id and role = 'Fundador';
end;
$$;

-- Sensitive mutations are server-only.
revoke all on function public.create_studio_os_draft(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.activate_studio_membership(uuid, uuid, uuid, text, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.complete_pending_studio_joins(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_studio_os(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_studio_os_draft(uuid, text, text, text, text) to service_role;
grant execute on function public.activate_studio_membership(uuid, uuid, uuid, text, uuid, boolean, text) to service_role;
grant execute on function public.complete_pending_studio_joins(uuid, uuid) to service_role;
grant execute on function public.activate_studio_os(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Canonical RLS after the table rename.
-- ---------------------------------------------------------------------------

alter table public.studio_memberships enable row level security;
drop policy if exists studio_fan_memberships_select_self_or_manager on public.studio_memberships;
drop policy if exists studio_fan_memberships_admin_write on public.studio_memberships;
drop policy if exists studio_memberships_select_self_or_manager on public.studio_memberships;
drop policy if exists studio_memberships_admin_write on public.studio_memberships;
create policy studio_memberships_select_self_or_manager
  on public.studio_memberships for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.studio_members sm
      where sm.studio_id = studio_memberships.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
    )
    or exists (select 1 from public.studios s where s.id = studio_memberships.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy studio_memberships_admin_write
  on public.studio_memberships for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- Data backfill: modes, memberships, default plan, and 223 roles.
-- ---------------------------------------------------------------------------

insert into public.profile_modes (user_id, mode, status)
select owner_user_id, 'player', 'active' from public.players where owner_user_id is not null
on conflict (user_id, mode) do nothing;
insert into public.profile_modes (user_id, mode, status)
select owner_id, 'studio_owner', 'active' from public.studios
on conflict (user_id, mode) do nothing;
insert into public.profile_modes (user_id, mode, status)
select distinct profile_id, 'studio_manager', 'active'
from public.studio_members where status = 'active' and role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
on conflict (user_id, mode) do nothing;

-- Every existing Studio remains administrable and has an explicit owner row.
insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
select id, owner_id, 'owner', 'active', coalesce(created_at, now()) from public.studios
on conflict (studio_id, profile_id) do update set role = 'owner', status = 'active';

-- Default free membership becomes Artista, not a generic fan label.
update public.studio_membership_plans
set name = case when name = 'Miembro' then 'Artista' else name end,
    slug = case when slug = 'miembro' then 'artista' else slug end,
    description = case when name = 'Miembro' then 'Sumate gratis como Artista del Estudio.' else description end,
    public_role_key = coalesce(nullif(public_role_key, ''), 'artist'),
    public_role_label = case when is_free then 'Artista' else coalesce(nullif(public_role_label, ''), name) end,
    area_key = case when is_free then 'artistic' else coalesce(nullif(area_key, ''), 'creative') end,
    area_label = case when is_free then 'Artística' else coalesce(nullif(area_label, ''), 'Creativa') end,
    join_policy = case when is_free then 'automatic' else join_policy end,
    requires_approval = case when is_free then false else requires_approval end,
    display_badge = coalesce(display_badge, upper(case when is_free then 'ARTISTA' else name end)),
    updated_at = now();

-- Backfill membership Player + public role snapshot where possible.
update public.studio_memberships sm
set player_id = p.id,
    public_role_key = coalesce(sm.public_role_key, mp.public_role_key),
    public_role_label = coalesce(sm.public_role_label, mp.public_role_label),
    area_key = coalesce(sm.area_key, mp.area_key),
    area_label = coalesce(sm.area_label, mp.area_label),
    updated_at = now()
from public.players p
left join public.studio_membership_plans mp on mp.id = sm.plan_id
where p.owner_user_id = sm.user_id;

insert into public.player_studios (
  player_id, studio_id, role, area_key, area_label, source_membership_id,
  is_primary, is_visible, status, joined_at
)
select sm.player_id, sm.studio_id, coalesce(sm.public_role_label, 'Miembro'),
       sm.area_key, sm.area_label, sm.id,
       false, true, 'active', sm.joined_at
from public.studio_memberships sm
where sm.status = 'active' and sm.player_id is not null
on conflict (player_id, studio_id) do update
set role = excluded.role,
    area_key = excluded.area_key,
    area_label = excluded.area_label,
    source_membership_id = excluded.source_membership_id,
    is_visible = true,
    status = 'active',
    left_at = null,
    updated_at = now();

-- 223 Social Club: Bless is the owner/founder; Clouva remains Socio/Admin.
do $$
declare
  v_studio_id uuid;
  v_bless_player uuid;
  v_bless_user uuid;
  v_clouva_player uuid;
  v_clouva_user uuid;
begin
  select id into v_studio_id from public.studios where slug = '223-social-club';
  select id, owner_user_id into v_bless_player, v_bless_user from public.players where slug = '0800bless';
  select id, owner_user_id into v_clouva_player, v_clouva_user from public.players where slug = 'clouva';

  if v_studio_id is not null and v_bless_user is not null then
    update public.studios set owner_id = v_bless_user, studio_os_status = 'legacy_active', updated_at = now() where id = v_studio_id;
    insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
    values (v_studio_id, v_bless_user, 'owner', 'active', now())
    on conflict (studio_id, profile_id) do update set role = 'owner', status = 'active';
  end if;

  if v_studio_id is not null and v_bless_player is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      v_bless_player, v_studio_id, 'Fundador', 'direction', 'Dirección',
      true, true, 'active', now(), null
    )
    on conflict (player_id, studio_id) do update
    set role = 'Fundador', area_key = 'direction', area_label = 'Dirección',
        is_primary = true, is_visible = true, status = 'active', left_at = null, updated_at = now();
  end if;

  if v_studio_id is not null and v_clouva_user is not null then
    insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
    values (v_studio_id, v_clouva_user, 'admin', 'active', now())
    on conflict (studio_id, profile_id) do update set role = 'admin', status = 'active';
  end if;

  if v_studio_id is not null and v_clouva_player is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      v_clouva_player, v_studio_id, 'Socio', 'business', 'Business',
      false, true, 'active', now(), null
    )
    on conflict (player_id, studio_id) do update
    set role = 'Socio', area_key = 'business', area_label = 'Business',
        is_primary = false, is_visible = true, status = 'active', left_at = null, updated_at = now();
  end if;
end $$;

commit;
