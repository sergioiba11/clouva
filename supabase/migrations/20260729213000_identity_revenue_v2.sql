-- CLOUVA Identity & Revenue Engine V2
-- Extends the existing Players/Estudios model. It does not replace or duplicate
-- players, player_members, player_studios, studios, studio_members or
-- user_entitlements.

-- ---------------------------------------------------------------------------
-- Existing public entities
-- ---------------------------------------------------------------------------

alter table public.players
  add column if not exists professional_categories text[] not null default '{}',
  add column if not exists social_links jsonb not null default '[]'::jsonb,
  add column if not exists privacy_status text not null default 'public'
    check (privacy_status in ('public', 'unlisted', 'private')),
  add column if not exists instagram_last_import_at timestamptz;

alter table public.studios
  add column if not exists tagline text,
  add column if not exists categories text[] not null default '{}',
  add column if not exists is_published boolean not null default true,
  add column if not exists publication_status text not null default 'published'
    check (publication_status in ('draft', 'published', 'unpublished', 'suspended')),
  add column if not exists contact_email text;

alter table public.user_entitlements
  add column if not exists source_provider text,
  add column if not exists source_subscription_id uuid,
  add column if not exists valid_from timestamptz,
  add column if not exists valid_until timestamptz,
  add column if not exists last_verified_at timestamptz;

create unique index if not exists players_owner_unique
  on public.players(owner_user_id)
  where owner_user_id is not null;

create index if not exists players_public_alias_lookup
  on public.players(lower(slug));

-- A free authenticated account may create its own first Player. Membership and
-- claims are still completed by server-side flows; users cannot assign ownership
-- to another account.
drop policy if exists players_insert_entitled_owner_or_admin on public.players;
create policy players_insert_self_or_admin
  on public.players for insert
  with check (
    owner_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Social connections and OAuth state (private; service-role only)
-- ---------------------------------------------------------------------------

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram', 'spotify', 'youtube', 'tiktok', 'facebook', 'twitch', 'x')),
  external_account_id text not null,
  external_username text,
  display_name text,
  account_type text,
  access_token_ciphertext text,
  token_iv text,
  token_auth_tag text,
  token_key_version text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_auth_tag text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'revoked', 'disconnected', 'error')),
  continuation_hash text,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists social_connections_active_external_unique
  on public.social_connections(provider, external_account_id)
  where status in ('pending', 'active', 'expired');
create index if not exists social_connections_user_idx
  on public.social_connections(user_id, provider);
create index if not exists social_connections_continuation_idx
  on public.social_connections(continuation_hash)
  where continuation_hash is not null;

alter table public.social_connections enable row level security;
-- Intentionally no client policies. OAuth tokens are read and written only by
-- trusted server routes using the service role.

create table if not exists public.social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  state_hash text not null unique,
  user_id uuid references auth.users(id) on delete cascade,
  continuation_hash text,
  return_path text not null default '/onboarding/instagram/select',
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired', 'failed')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists social_oauth_states_pending_idx
  on public.social_oauth_states(provider, expires_at)
  where status = 'pending';

alter table public.social_oauth_states enable row level security;

create table if not exists public.social_import_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.social_connections(id) on delete cascade,
  provider text not null,
  status text not null default 'created'
    check (status in ('created', 'loading', 'ready', 'confirmed', 'cancelled', 'expired', 'failed')),
  available_profile_data jsonb not null default '{}'::jsonb,
  selected_profile_data jsonb not null default '{}'::jsonb,
  available_media jsonb not null default '[]'::jsonb,
  selected_media jsonb not null default '[]'::jsonb,
  error_message text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_import_sessions_user_idx
  on public.social_import_sessions(user_id, status, created_at desc);

alter table public.social_import_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Public aliases and media
-- ---------------------------------------------------------------------------

create table if not exists public.public_slug_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null,
  normalized_alias text generated always as (lower(alias)) stored,
  entity_type text not null check (entity_type in ('player', 'studio')),
  entity_id uuid not null,
  is_primary boolean not null default false,
  redirect_to_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_alias)
);

create index if not exists public_slug_aliases_entity_idx
  on public.public_slug_aliases(entity_type, entity_id);

alter table public.public_slug_aliases enable row level security;
create policy public_slug_aliases_public_read
  on public.public_slug_aliases for select
  using (true);

create table if not exists public.player_media (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video', 'audio', 'embed')),
  origin text not null default 'manual'
    check (origin in ('manual', 'instagram', 'spotify', 'youtube', 'system')),
  external_id text,
  source_url text,
  storage_path text,
  public_url text,
  thumbnail_url text,
  caption text,
  alt_text text,
  display_order integer not null default 0,
  visibility text not null default 'public'
    check (visibility in ('public', 'private', 'draft')),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_media_single_owner check (
    (player_id is not null and studio_id is null)
    or (player_id is null and studio_id is not null)
  )
);

create index if not exists player_media_player_idx
  on public.player_media(player_id, visibility, display_order);
create index if not exists player_media_studio_idx
  on public.player_media(studio_id, visibility, display_order);
create unique index if not exists player_media_external_unique
  on public.player_media(origin, external_id, player_id)
  where external_id is not null and player_id is not null;

alter table public.player_media enable row level security;
create policy player_media_public_read
  on public.player_media for select
  using (
    visibility = 'public'
    or exists (
      select 1 from public.player_members pm
      where pm.player_id = player_media.player_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
    )
    or exists (
      select 1 from public.studios s
      where s.id = player_media.studio_id and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studio_members sm
      where sm.studio_id = player_media.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor')
    )
  );

create policy player_media_authorized_write
  on public.player_media for all
  using (
    exists (
      select 1 from public.player_members pm
      where pm.player_id = player_media.player_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('owner', 'manager', 'editor')
    )
    or exists (
      select 1 from public.studios s
      where s.id = player_media.studio_id and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studio_members sm
      where sm.studio_id = player_media.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor')
    )
  )
  with check (
    exists (
      select 1 from public.player_members pm
      where pm.player_id = player_media.player_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('owner', 'manager', 'editor')
    )
    or exists (
      select 1 from public.studios s
      where s.id = player_media.studio_id and s.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.studio_members sm
      where sm.studio_id = player_media.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor')
    )
  );

-- ---------------------------------------------------------------------------
-- Studio applications and secure access claims
-- ---------------------------------------------------------------------------

create table if not exists public.studio_applications (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  artist_name text not null,
  category text,
  instagram_url text,
  clouva_profile_url text,
  presentation text,
  activity text,
  reason text,
  material_links jsonb not null default '[]'::jsonb,
  availability text,
  message text,
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'in_review', 'accepted', 'rejected', 'cancelled')),
  reviewer_notes text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_applications_studio_idx
  on public.studio_applications(studio_id, status, created_at desc);
create index if not exists studio_applications_user_idx
  on public.studio_applications(user_id, created_at desc);
create unique index if not exists studio_applications_active_unique
  on public.studio_applications(studio_id, player_id)
  where player_id is not null and status in ('submitted', 'in_review');

alter table public.studio_applications enable row level security;
create policy studio_applications_self_read
  on public.studio_applications for select
  using (
    user_id = auth.uid()
    or public.can_manage_studio(studio_id)
  );
create policy studio_applications_authenticated_insert
  on public.studio_applications for insert
  with check (user_id = auth.uid());
create policy studio_applications_self_draft_update
  on public.studio_applications for update
  using (user_id = auth.uid() and status in ('draft', 'submitted'))
  with check (user_id = auth.uid() and status in ('draft', 'submitted', 'cancelled'));
create policy studio_applications_manager_update
  on public.studio_applications for update
  using (public.can_manage_studio(studio_id))
  with check (public.can_manage_studio(studio_id));

create table if not exists public.studio_access_claims (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  invited_email text,
  invited_user_id uuid references auth.users(id) on delete cascade,
  role text not null,
  token_hash text not null unique,
  requires_vip boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists studio_access_claims_pending_idx
  on public.studio_access_claims(studio_id, status, expires_at);

alter table public.studio_access_claims enable row level security;

-- ---------------------------------------------------------------------------
-- Provider-independent billing model
-- ---------------------------------------------------------------------------

create table if not exists public.billing_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  entitlement_tier text not null check (entitlement_tier in ('free', 'player', 'vip')),
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.billing_products(id) on delete cascade,
  provider text not null check (provider in ('mercadopago')),
  provider_plan_id text,
  currency text not null,
  amount numeric(14,2) not null check (amount > 0),
  billing_type text not null default 'recurring' check (billing_type in ('recurring')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  interval_count integer not null default 1 check (interval_count > 0),
  environment text not null check (environment in ('test', 'production')),
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, provider, currency, billing_interval, interval_count, environment)
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.billing_products(id),
  price_id uuid not null references public.billing_prices(id),
  provider text not null check (provider in ('mercadopago')),
  environment text not null check (environment in ('test', 'production')),
  external_subscription_id text,
  external_reference text not null unique,
  payer_reference text,
  status text not null default 'created'
    check (status in ('created', 'pending', 'authorized', 'active', 'past_due', 'paused', 'cancelled', 'expired', 'error')),
  provider_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_payment_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_subscriptions_external_unique
  on public.billing_subscriptions(provider, environment, external_subscription_id)
  where external_subscription_id is not null;
create index if not exists billing_subscriptions_user_idx
  on public.billing_subscriptions(user_id, status, created_at desc);

create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  provider text not null check (provider in ('mercadopago')),
  environment text not null check (environment in ('test', 'production')),
  external_payment_id text not null,
  external_invoice_id text,
  external_reference text,
  amount numeric(14,2) not null,
  currency text not null,
  status text not null,
  status_detail text,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, external_payment_id)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null check (environment in ('test', 'production')),
  provider_event_id text,
  request_id text,
  event_type text not null,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  signature_valid boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_webhook_events_provider_event_unique
  on public.billing_webhook_events(provider, environment, provider_event_id)
  where provider_event_id is not null;
create unique index if not exists billing_webhook_events_request_resource_unique
  on public.billing_webhook_events(provider, environment, request_id, event_type, resource_id)
  where request_id is not null;

alter table public.billing_products enable row level security;
alter table public.billing_prices enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_webhook_events enable row level security;

create policy billing_products_public_active_read
  on public.billing_products for select
  using (is_active = true);
create policy billing_prices_public_active_read
  on public.billing_prices for select
  using (is_active = true);
create policy billing_subscriptions_self_read
  on public.billing_subscriptions for select
  using (user_id = auth.uid());
create policy billing_payments_self_read
  on public.billing_payments for select
  using (user_id = auth.uid());

-- Seed only the product identity. Price and activation are deliberately manual:
-- no amount is invented and no plan is provisioned by a migration.
insert into public.billing_products (code, name, description, entitlement_tier, is_active)
values (
  'clouva_vip',
  'CLOUVA VIP',
  'Herramientas avanzadas para construir y administrar tu identidad.',
  'vip',
  false
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

create or replace function public.touch_identity_revenue_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_identity_revenue_updated_at() from public;

create trigger social_connections_touch_updated_at
  before update on public.social_connections
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger social_import_sessions_touch_updated_at
  before update on public.social_import_sessions
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger public_slug_aliases_touch_updated_at
  before update on public.public_slug_aliases
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger player_media_touch_updated_at
  before update on public.player_media
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger studio_applications_touch_updated_at
  before update on public.studio_applications
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger studio_access_claims_touch_updated_at
  before update on public.studio_access_claims
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger billing_products_touch_updated_at
  before update on public.billing_products
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger billing_prices_touch_updated_at
  before update on public.billing_prices
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger billing_subscriptions_touch_updated_at
  before update on public.billing_subscriptions
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger billing_payments_touch_updated_at
  before update on public.billing_payments
  for each row execute function public.touch_identity_revenue_updated_at();
create trigger billing_webhook_events_touch_updated_at
  before update on public.billing_webhook_events
  for each row execute function public.touch_identity_revenue_updated_at();
