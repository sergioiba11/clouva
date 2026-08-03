-- CLOUVA multirol + Studio OS: canonical schema.
-- Intentionally does not touch Avatar Analyzer, Blender, Unreal or any 3D table.

-- User intentions/capabilities. These are not professional identity and are
-- never used as a global authorization role.
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

-- The old name implied fans only. It now stores every public/commercial way a
-- person participates in a Studio: Artista, Productor, Socio, Partner, etc.
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

alter table public.studio_memberships drop constraint if exists studio_fan_memberships_status_check;
alter table public.studio_memberships drop constraint if exists studio_memberships_status_check;
alter table public.studio_memberships
  add constraint studio_memberships_status_check
  check (status in ('pending', 'active', 'cancelled', 'expired', 'rejected'));

create unique index if not exists studio_memberships_studio_player_unique
  on public.studio_memberships(studio_id, player_id)
  where player_id is not null;
create index if not exists studio_memberships_player_idx
  on public.studio_memberships(player_id, status);

-- A plan defines the public label/area received inside that Studio. It does not
-- grant private administration permissions.
alter table public.studio_membership_plans
  add column if not exists public_role_key text not null default 'artist',
  add column if not exists public_role_label text not null default 'Artista',
  add column if not exists area_key text not null default 'artistic',
  add column if not exists area_label text not null default 'Artística',
  add column if not exists join_policy text not null default 'automatic',
  add column if not exists requires_approval boolean not null default false,
  add column if not exists display_badge text;

alter table public.studio_membership_plans drop constraint if exists studio_membership_plans_join_policy_check;
alter table public.studio_membership_plans
  add constraint studio_membership_plans_join_policy_check
  check (join_policy in ('automatic', 'approval', 'invitation_only'));

-- Public Player ↔ Studio projection.
alter table public.player_studios
  add column if not exists area_key text,
  add column if not exists area_label text,
  add column if not exists source_membership_id uuid references public.studio_memberships(id) on delete set null,
  add column if not exists status text not null default 'active';
alter table public.player_studios drop constraint if exists player_studios_status_check;
alter table public.player_studios
  add constraint player_studios_status_check check (status in ('pending', 'active', 'inactive'));

-- A user may join a Studio before creating a Player. The intent survives the
-- onboarding and is completed when the unique Player exists.
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

-- Studio OS is a subscription of the Studio, not a personal VIP requirement
-- for every manager invited to work there.
alter table public.studios
  add column if not exists studio_os_status text not null default 'pending',
  add column if not exists studio_os_subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  add column if not exists studio_os_activated_at timestamptz,
  add column if not exists studio_os_expires_at timestamptz;
alter table public.studios drop constraint if exists studios_studio_os_status_check;
alter table public.studios
  add constraint studios_studio_os_status_check
  check (studio_os_status in ('pending', 'active', 'grace', 'suspended', 'cancelled', 'legacy_active'));

alter table public.billing_subscriptions
  add column if not exists studio_id uuid references public.studios(id) on delete set null;
create index if not exists billing_subscriptions_studio_idx
  on public.billing_subscriptions(studio_id, status, created_at desc)
  where studio_id is not null;

-- Product identity only. No price is invented by this migration.
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

-- Existing real Studios stay online while their owner migrates to Studio OS.
update public.studios
set studio_os_status = 'legacy_active',
    studio_os_activated_at = coalesce(studio_os_activated_at, created_at)
where studio_os_status = 'pending' and is_published = true;

-- Future invitations never require the invited worker to buy personal VIP.
alter table public.studio_access_claims alter column requires_vip set default false;
update public.studio_access_claims set requires_vip = false where status = 'pending';

-- Client-side direct Studio inserts are retired; creation goes through the
-- transaction RPC exposed only to service_role.
drop policy if exists studios_insert_entitled on public.studios;

-- Canonical RLS after the membership table rename.
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
