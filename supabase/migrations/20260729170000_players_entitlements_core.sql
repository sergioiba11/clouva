-- Players/Estudios ecosystem, stage 2: core model + security.
--
-- Architectural correction vs. the studios-only Comunidad work (PR #242):
-- profiles.is_vip is a pre-existing general customer-VIP flag (control_total.sql,
-- 2026-05-22, used for store perks / public VIP badges elsewhere) -- it is left
-- untouched. But studio creation and the new Player plan tier must NOT be gated
-- by that unrelated flag: they now live in user_entitlements, a table separate
-- from both `profiles` and `players`, so plan/subscription state never gets
-- baked into content rows. No real data depends on the old is_vip-gated studio
-- policy yet (no studio has been created for real), so this is a same-day
-- correction, not a backfill migration.
--
-- Tables are all created first (no RLS yet), then every policy/function/
-- trigger afterward, since several policies cross-reference tables created
-- later in this same file.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null default 'core',
  tier text not null check (tier in ('free', 'player', 'vip')),
  status text not null default 'active' check (status in ('active', 'pending', 'expired', 'cancelled', 'revoked')),
  source text not null check (source in ('signup', 'payment', 'admin', 'promotion', 'invitation')),
  provider text,
  external_customer_id text,
  external_subscription_id text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_entitlements_user_idx on public.user_entitlements(user_id);
create index user_entitlements_status_idx on public.user_entitlements(user_id, status) where status = 'active';

create table public.players (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id),
  slug text unique not null,
  display_name text not null,
  username text unique,
  primary_role text,
  short_bio text,
  long_bio text,
  tagline text,
  secondary_tagline text,
  origin text,
  location text,
  genres text[] not null default '{}',
  disciplines text[] not null default '{}',
  profile_image_url text,
  hero_image_url text,
  cover_url text,
  featured_media_url text,
  spotify_artist_id text,
  spotify_profile_url text,
  spotify_last_sync_at timestamptz,
  spotify_sync_status text,
  spotify_sync_error text,
  youtube_channel_id text,
  youtube_channel_url text,
  youtube_last_sync_at timestamptz,
  youtube_sync_status text,
  youtube_sync_error text,
  contact_email text,
  booking_email text,
  whatsapp_url text,
  theme_key text not null default 'minimal_dark',
  accent_color text,
  font_style text,
  claim_status text not null default 'unclaimed' check (claim_status in ('unclaimed', 'invited', 'pending', 'claimed', 'rejected')),
  claim_requested_at timestamptz,
  claimed_at timestamptz,
  approved_by uuid references auth.users(id),
  is_verified boolean not null default false,
  is_published boolean not null default false,
  publication_status text not null default 'draft' check (publication_status in ('draft', 'in_review', 'published', 'unpublished', 'suspended')),
  seo_title text,
  seo_description text,
  share_title text,
  share_description text,
  og_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index players_owner_idx on public.players(owner_user_id);
create index players_published_idx on public.players(is_published) where is_published = true;

create table public.player_members (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'editor', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'revoked')),
  invited_by uuid references auth.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, user_id)
);

create index player_members_player_idx on public.player_members(player_id);
create index player_members_user_idx on public.player_members(user_id);

create table public.player_studios (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  role text,
  secondary_role text,
  custom_title text,
  description text,
  is_primary boolean not null default false,
  is_visible boolean not null default true,
  display_order int not null default 0,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, studio_id)
);

create index player_studios_player_idx on public.player_studios(player_id);
create index player_studios_studio_idx on public.player_studios(studio_id);

create table public.player_invitations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  email text not null,
  email_normalized text not null,
  token_hash text not null,
  member_role text not null default 'owner' check (member_role in ('owner', 'manager', 'editor', 'viewer')),
  entitlement_to_grant text check (entitlement_to_grant in ('free', 'player', 'vip')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'cancelled', 'rejected')),
  created_by uuid references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index player_invitations_player_idx on public.player_invitations(player_id);
create index player_invitations_email_idx on public.player_invitations(email_normalized);
-- Only one active (pending) invitation per Player+email at a time.
create unique index player_invitations_unique_pending
  on public.player_invitations(player_id, email_normalized)
  where status = 'pending';

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  previous_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index admin_audit_log_entity_idx on public.admin_audit_log(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- "Does this user currently have an active player-or-vip entitlement".
create function public.has_active_player_entitlement(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_entitlements
    where user_id = check_user_id
      and status = 'active'
      and tier in ('player', 'vip')
      and (expires_at is null or expires_at > now())
  );
$$;

-- Protects fields that must only ever change through an admin-mediated flow
-- (claim approval, verification, publication gate) -- RLS's WITH CHECK can't
-- express "this column may only change if X", so a trigger enforces it. This
-- is what stops an owner from self-approving their own claim or verification,
-- per the spec's explicit security rules.
create function public.enforce_players_protected_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin boolean;
begin
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') into is_admin;
  if is_admin then
    return new;
  end if;

  if new.owner_user_id is distinct from old.owner_user_id
    or new.is_verified is distinct from old.is_verified
    or new.claim_status is distinct from old.claim_status
    or new.claimed_at is distinct from old.claimed_at
    or new.approved_by is distinct from old.approved_by then
    raise exception 'Solo un admin puede modificar propiedad, verificación o estado de claim de un Player';
  end if;

  return new;
end;
$$;

create trigger players_protected_fields_guard
  before update on public.players
  for each row execute function public.enforce_players_protected_fields();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.user_entitlements enable row level security;

create policy user_entitlements_select_self_or_admin
  on public.user_entitlements for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Only admin (or the service role, which bypasses RLS entirely for webhooks)
-- may write entitlements -- a user must never be able to grant themself VIP.
create policy user_entitlements_admin_write
  on public.user_entitlements for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.players enable row level security;

create policy players_select_public_or_member
  on public.players for select
  using (
    is_published = true
    or owner_user_id = auth.uid()
    or exists (
      select 1 from public.player_members m
      where m.player_id = players.id and m.user_id = auth.uid() and m.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- A user may create their own Player only once they hold an active
-- player/vip entitlement -- claimed Players are inserted by the admin-mediated
-- invitation-accept flow (service role), never through this policy.
create policy players_insert_entitled_owner_or_admin
  on public.players for insert
  with check (
    (owner_user_id = auth.uid() and public.has_active_player_entitlement(auth.uid()))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy players_update_member_or_admin
  on public.players for update
  using (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.player_members m
      where m.player_id = players.id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager', 'editor')
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.player_members m
      where m.player_id = players.id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager', 'editor')
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy players_delete_admin_only
  on public.players for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.player_members enable row level security;

create policy player_members_select_self_or_player_admin_or_admin
  on public.player_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.player_members m2
      where m2.player_id = player_members.player_id and m2.user_id = auth.uid() and m2.status = 'active' and m2.role in ('owner', 'manager')
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Membership writes are admin-only from the client -- the invitation-accept
-- and claim flows run server-side with the service role (which bypasses RLS),
-- inside a transaction, so two people can't race to claim the same Player.
create policy player_members_admin_write
  on public.player_members for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.player_studios enable row level security;

create policy player_studios_select_public
  on public.player_studios for select
  using (true);

create policy player_studios_write
  on public.player_studios for all
  using (
    exists (
      select 1 from public.player_members m
      where m.player_id = player_studios.player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = player_studios.studio_id and s.owner_id = auth.uid())
    or exists (
      select 1 from public.studio_members sm
      where sm.studio_id = player_studios.studio_id and sm.profile_id = auth.uid() and sm.role = 'admin' and sm.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (
      select 1 from public.player_members m
      where m.player_id = player_studios.player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = player_studios.studio_id and s.owner_id = auth.uid())
    or exists (
      select 1 from public.studio_members sm
      where sm.studio_id = player_studios.studio_id and sm.profile_id = auth.uid() and sm.role = 'admin' and sm.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

alter table public.player_invitations enable row level security;

-- Admin-only from the client, full stop -- token issuance/validation/acceptance
-- always goes through a server route using the service role, since it needs
-- to hash-compare the raw token and commit the accept transaction atomically.
create policy player_invitations_admin_only
  on public.player_invitations for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.admin_audit_log enable row level security;

-- Read-only from the client (admin only); all writes happen server-side with
-- the service role as part of the action they're auditing, so a compromised
-- admin session can't quietly skip writing its own audit trail.
create policy admin_audit_log_select_admin
  on public.admin_audit_log for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- Re-point studio creation at the new entitlement model instead of the
-- unrelated, pre-existing profiles.is_vip (which stays as-is for its original
-- general customer-VIP purpose elsewhere in the app).
-- ---------------------------------------------------------------------------
drop policy if exists studios_insert_vip on public.studios;

create policy studios_insert_entitled
  on public.studios for insert
  with check (
    owner_id = auth.uid()
    and public.has_active_player_entitlement(auth.uid())
  );
