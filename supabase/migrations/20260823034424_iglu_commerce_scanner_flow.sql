-- CLOUVA commerce extension: Spot + scanner + identifiers + inventory ledger
-- + financial Flow ledger. Existing commerce_products remain the public
-- listing table; commerce_catalog_* adds the reusable global product identity
-- required to avoid cloning the same commercial product into every Spot.

begin;

create table if not exists public.commerce_spots (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  slug text not null,
  name text not null,
  country_code text not null default 'AR',
  currency text not null default 'ARS',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  fx_source text not null default 'BCRA_ESTADISTICAS_CAMBIARIAS_USD',
  public_enabled boolean not null default true,
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_spots_studio_slug_unique unique (studio_id, slug),
  constraint commerce_spots_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint commerce_spots_country_check check (country_code ~ '^[A-Z]{2}$')
);

create index if not exists commerce_spots_studio_idx on public.commerce_spots(studio_id);
create index if not exists commerce_spots_public_idx
  on public.commerce_spots(status, public_enabled)
  where status = 'active' and public_enabled = true;

create table if not exists public.commerce_catalog_products (
  id uuid primary key default gen_random_uuid(),
  product_kind text not null check (product_kind in ('physical', 'avatar_item', 'digital', 'bundle')),
  name text not null,
  description text,
  brand text,
  category text,
  design_key text,
  avatar_asset_id uuid references public.clothing_items(id) on delete set null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_catalog_products_name_idx
  on public.commerce_catalog_products(lower(name));
create index if not exists commerce_catalog_products_design_idx
  on public.commerce_catalog_products(design_key)
  where design_key is not null;

create table if not exists public.commerce_catalog_variants (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.commerce_catalog_products(id) on delete cascade,
  title text,
  size text,
  color text,
  presentation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_catalog_variants_product_idx
  on public.commerce_catalog_variants(catalog_product_id);
create unique index if not exists commerce_catalog_variants_identity_unique
  on public.commerce_catalog_variants(
    catalog_product_id,
    coalesce(lower(size), ''),
    coalesce(lower(color), ''),
    coalesce(lower(presentation), ''),
    coalesce(lower(title), '')
  );

alter table public.commerce_products
  add column if not exists spot_id uuid,
  add column if not exists catalog_product_id uuid,
  add column if not exists cost_amount numeric(14,2),
  add column if not exists listing_kind text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_products_spot_id_fkey'
      and conrelid = 'public.commerce_products'::regclass
  ) then
    alter table public.commerce_products
      add constraint commerce_products_spot_id_fkey
      foreign key (spot_id) references public.commerce_spots(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_products_catalog_product_id_fkey'
      and conrelid = 'public.commerce_products'::regclass
  ) then
    alter table public.commerce_products
      add constraint commerce_products_catalog_product_id_fkey
      foreign key (catalog_product_id) references public.commerce_catalog_products(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_products_cost_amount_check'
      and conrelid = 'public.commerce_products'::regclass
  ) then
    alter table public.commerce_products
      add constraint commerce_products_cost_amount_check
      check (cost_amount is null or cost_amount >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_products_listing_kind_check'
      and conrelid = 'public.commerce_products'::regclass
  ) then
    alter table public.commerce_products
      add constraint commerce_products_listing_kind_check
      check (listing_kind in ('standard', 'resale', 'owned_design', 'avatar', 'combo'));
  end if;
end
$$;

create index if not exists commerce_products_spot_idx on public.commerce_products(spot_id);
create index if not exists commerce_products_catalog_idx on public.commerce_products(catalog_product_id);
create unique index if not exists commerce_products_spot_catalog_unique
  on public.commerce_products(spot_id, catalog_product_id, listing_kind)
  where spot_id is not null and catalog_product_id is not null;

alter table public.commerce_product_variants
  add column if not exists catalog_variant_id uuid,
  add column if not exists cost_override numeric(14,2),
  add column if not exists low_stock_threshold integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_variants_catalog_variant_id_fkey'
      and conrelid = 'public.commerce_product_variants'::regclass
  ) then
    alter table public.commerce_product_variants
      add constraint commerce_product_variants_catalog_variant_id_fkey
      foreign key (catalog_variant_id) references public.commerce_catalog_variants(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_variants_cost_override_check'
      and conrelid = 'public.commerce_product_variants'::regclass
  ) then
    alter table public.commerce_product_variants
      add constraint commerce_product_variants_cost_override_check
      check (cost_override is null or cost_override >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_variants_low_stock_check'
      and conrelid = 'public.commerce_product_variants'::regclass
  ) then
    alter table public.commerce_product_variants
      add constraint commerce_product_variants_low_stock_check
      check (low_stock_threshold >= 0);
  end if;
end
$$;

create index if not exists commerce_product_variants_catalog_idx
  on public.commerce_product_variants(catalog_variant_id)
  where catalog_variant_id is not null;

create table if not exists public.commerce_product_identifiers (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.commerce_catalog_products(id) on delete cascade,
  catalog_variant_id uuid references public.commerce_catalog_variants(id) on delete cascade,
  spot_id uuid references public.commerce_spots(id) on delete cascade,
  identifier_type text not null check (identifier_type in (
    'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'clouva_barcode', 'clouva_qr', 'sku'
  )),
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint commerce_product_identifiers_value_check check (length(btrim(value)) between 1 and 512),
  constraint commerce_product_identifiers_variant_product_shape check (
    catalog_variant_id is null or catalog_product_id is not null
  )
);

create unique index if not exists commerce_product_identifiers_global_code_unique
  on public.commerce_product_identifiers(identifier_type, normalized_value)
  where identifier_type <> 'sku';
create unique index if not exists commerce_product_identifiers_spot_sku_unique
  on public.commerce_product_identifiers(spot_id, normalized_value)
  where identifier_type = 'sku' and spot_id is not null;
create index if not exists commerce_product_identifiers_product_idx
  on public.commerce_product_identifiers(catalog_product_id);
create index if not exists commerce_product_identifiers_variant_idx
  on public.commerce_product_identifiers(catalog_variant_id)
  where catalog_variant_id is not null;
create index if not exists commerce_product_identifiers_lookup_idx
  on public.commerce_product_identifiers(normalized_value);

create table if not exists public.commerce_listing_components (
  id uuid primary key default gen_random_uuid(),
  bundle_listing_id uuid not null references public.commerce_products(id) on delete cascade,
  component_listing_id uuid not null references public.commerce_products(id) on delete restrict,
  component_variant_id uuid references public.commerce_product_variants(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  component_role text not null check (component_role in ('physical', 'digital')),
  created_at timestamptz not null default now(),
  constraint commerce_listing_components_not_self check (bundle_listing_id <> component_listing_id),
  constraint commerce_listing_components_unique unique (bundle_listing_id, component_listing_id)
);

create index if not exists commerce_listing_components_component_idx
  on public.commerce_listing_components(component_listing_id);
create index if not exists commerce_listing_components_variant_idx
  on public.commerce_listing_components(component_variant_id)
  where component_variant_id is not null;

create table if not exists public.commerce_inventory_locations (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_inventory_locations_spot_code_unique unique (spot_id, code)
);

create index if not exists commerce_inventory_locations_spot_idx
  on public.commerce_inventory_locations(spot_id);

create table if not exists public.commerce_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete restrict,
  location_id uuid not null references public.commerce_inventory_locations(id) on delete restrict,
  listing_id uuid not null references public.commerce_products(id) on delete restrict,
  listing_variant_id uuid references public.commerce_product_variants(id) on delete restrict,
  movement_type text not null check (movement_type in (
    'opening_stock', 'purchase_receipt', 'sale', 'refund', 'adjustment_in',
    'adjustment_out', 'transfer_in', 'transfer_out', 'reservation', 'release', 'correction'
  )),
  quantity_delta integer not null check (quantity_delta <> 0),
  stock_after integer not null check (stock_after >= 0),
  unit_cost numeric(14,2) check (unit_cost is null or unit_cost >= 0),
  currency text not null default 'ARS',
  order_id uuid references public.commerce_orders(id) on delete restrict,
  order_item_id uuid references public.commerce_order_items(id) on delete restrict,
  reference text,
  idempotency_key text not null,
  note text,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commerce_inventory_movements_idempotency_unique unique (idempotency_key)
);

create index if not exists commerce_inventory_movements_spot_created_idx
  on public.commerce_inventory_movements(spot_id, created_at desc);
create index if not exists commerce_inventory_movements_listing_idx
  on public.commerce_inventory_movements(listing_id, listing_variant_id, created_at desc);
create index if not exists commerce_inventory_movements_order_idx
  on public.commerce_inventory_movements(order_id)
  where order_id is not null;

create table if not exists public.commerce_fx_rates (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete restrict,
  local_currency text not null,
  quote_currency text not null default 'USD',
  local_per_quote numeric(20,8) not null check (local_per_quote > 0),
  source text not null,
  source_reference text,
  quoted_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  raw_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  constraint commerce_fx_rates_currency_pair_check check (
    local_currency ~ '^[A-Z]{3}$' and quote_currency ~ '^[A-Z]{3}$' and local_currency <> quote_currency
  ),
  constraint commerce_fx_rates_idempotency_unique unique (idempotency_key)
);

create index if not exists commerce_fx_rates_latest_idx
  on public.commerce_fx_rates(spot_id, local_currency, quote_currency, quoted_at desc);

create table if not exists public.commerce_payments (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete restrict,
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  provider text not null,
  payment_method text not null check (payment_method in (
    'mercadopago', 'cash', 'transfer', 'debit_card', 'credit_card', 'other'
  )),
  status text not null check (status in ('pending', 'confirmed', 'failed', 'refunded', 'cancelled')),
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  fee_amount numeric(14,2) not null default 0 check (fee_amount >= 0),
  net_amount numeric(14,2) not null,
  currency text not null,
  external_payment_id text,
  idempotency_key text not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  fx_rate_id uuid references public.commerce_fx_rates(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commerce_payments_idempotency_unique unique (idempotency_key)
);

create index if not exists commerce_payments_spot_created_idx
  on public.commerce_payments(spot_id, created_at desc);
create index if not exists commerce_payments_order_idx on public.commerce_payments(order_id);
create unique index if not exists commerce_payments_external_unique
  on public.commerce_payments(provider, external_payment_id)
  where external_payment_id is not null;

create table if not exists public.commerce_flow_accounts (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null unique references public.commerce_spots(id) on delete restrict,
  local_currency text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.commerce_flow_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.commerce_flow_accounts(id) on delete restrict,
  spot_id uuid not null references public.commerce_spots(id) on delete restrict,
  entry_type text not null check (entry_type in ('sale', 'refund', 'expense', 'adjustment', 'transfer')),
  original_currency text not null,
  gross_original numeric(14,2) not null,
  cost_original numeric(14,2) not null default 0,
  commission_original numeric(14,2) not null default 0,
  net_original numeric(14,2) not null,
  gross_usd numeric(20,8) not null,
  cost_usd numeric(20,8) not null,
  commission_usd numeric(20,8) not null,
  net_usd numeric(20,8) not null,
  flows_amount numeric(20,8) not null,
  fx_rate_id uuid not null references public.commerce_fx_rates(id) on delete restrict,
  fx_local_per_usd numeric(20,8) not null check (fx_local_per_usd > 0),
  fx_source text not null,
  fx_quoted_at timestamptz not null,
  order_id uuid references public.commerce_orders(id) on delete restrict,
  payment_id uuid references public.commerce_payments(id) on delete restrict,
  listing_id uuid references public.commerce_products(id) on delete restrict,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  reverses_entry_id uuid references public.commerce_flow_ledger(id) on delete restrict,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint commerce_flow_ledger_idempotency_unique unique (idempotency_key),
  constraint commerce_flow_ledger_flow_equals_usd check (flows_amount = net_usd)
);

create index if not exists commerce_flow_ledger_spot_created_idx
  on public.commerce_flow_ledger(spot_id, created_at desc);
create index if not exists commerce_flow_ledger_order_idx
  on public.commerce_flow_ledger(order_id)
  where order_id is not null;
create index if not exists commerce_flow_ledger_payment_idx
  on public.commerce_flow_ledger(payment_id)
  where payment_id is not null;

create table if not exists public.commerce_financial_goals (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  name text not null,
  metric text not null check (metric in ('gross_revenue', 'net_profit', 'available_balance')),
  target_currency text not null default 'USD',
  target_amount numeric(20,2) not null check (target_amount > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_financial_goals_one_active_metric
  on public.commerce_financial_goals(spot_id, metric)
  where status = 'active';
create index if not exists commerce_financial_goals_spot_idx
  on public.commerce_financial_goals(spot_id, status);

alter table public.commerce_orders
  alter column buyer_id drop not null;

alter table public.commerce_orders
  add column if not exists spot_id uuid,
  add column if not exists sales_channel text not null default 'online',
  add column if not exists payment_method text,
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists created_by uuid;

alter table public.commerce_order_items
  add column if not exists bundle_parent_item_id uuid,
  add column if not exists bundle_component_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_orders_spot_id_fkey'
      and conrelid = 'public.commerce_orders'::regclass
  ) then
    alter table public.commerce_orders
      add constraint commerce_orders_spot_id_fkey
      foreign key (spot_id) references public.commerce_spots(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_orders_created_by_fkey'
      and conrelid = 'public.commerce_orders'::regclass
  ) then
    alter table public.commerce_orders
      add constraint commerce_orders_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_orders_sales_channel_check'
      and conrelid = 'public.commerce_orders'::regclass
  ) then
    alter table public.commerce_orders
      add constraint commerce_orders_sales_channel_check
      check (sales_channel in ('online', 'pos', 'manual', 'marketplace'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_order_items_bundle_parent_item_id_fkey'
      and conrelid = 'public.commerce_order_items'::regclass
  ) then
    alter table public.commerce_order_items
      add constraint commerce_order_items_bundle_parent_item_id_fkey
      foreign key (bundle_parent_item_id) references public.commerce_order_items(id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_order_items_bundle_component_id_fkey'
      and conrelid = 'public.commerce_order_items'::regclass
  ) then
    alter table public.commerce_order_items
      add constraint commerce_order_items_bundle_component_id_fkey
      foreign key (bundle_component_id) references public.commerce_listing_components(id) on delete restrict;
  end if;
end
$$;

create index if not exists commerce_orders_spot_created_idx
  on public.commerce_orders(spot_id, created_at desc)
  where spot_id is not null;
create index if not exists commerce_order_items_bundle_parent_idx
  on public.commerce_order_items(bundle_parent_item_id)
  where bundle_parent_item_id is not null;
create unique index if not exists commerce_order_items_bundle_component_unique
  on public.commerce_order_items(order_id, bundle_parent_item_id, bundle_component_id)
  where bundle_parent_item_id is not null and bundle_component_id is not null;

drop index if exists public.commerce_order_items_order_product_variant_unique;
create unique index commerce_order_items_order_product_variant_unique
  on public.commerce_order_items(
    order_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(bundle_parent_item_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(bundle_component_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.commerce_inventory
  add column if not exists entitlement_key text,
  add column if not exists entitlement_status text not null default 'active',
  add column if not exists claimed_at timestamptz,
  add column if not exists revoked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_inventory_entitlement_status_check'
      and conrelid = 'public.commerce_inventory'::regclass
  ) then
    alter table public.commerce_inventory
      add constraint commerce_inventory_entitlement_status_check
      check (entitlement_status in ('pending', 'active', 'revoked'));
  end if;
end
$$;

create unique index if not exists commerce_inventory_entitlement_key_unique
  on public.commerce_inventory(entitlement_key)
  where entitlement_key is not null;

-- Seed the real El Iglú Spot and its canonical default structures by slug,
-- never by a generated identifier and without inserting demo products.
insert into public.commerce_spots(studio_id, slug, name, country_code, currency, timezone, fx_source, status, public_enabled, created_by)
select s.id, 'el-iglu', 'El Iglú', 'AR', 'ARS', 'America/Argentina/Buenos_Aires',
       'BCRA_ESTADISTICAS_CAMBIARIAS_USD', 'active', true, s.owner_id
from public.studios s
where s.slug = 'el-iglu'
on conflict (studio_id, slug) do update
set name = excluded.name,
    country_code = excluded.country_code,
    currency = excluded.currency,
    timezone = excluded.timezone,
    fx_source = excluded.fx_source,
    updated_at = now();

insert into public.commerce_inventory_locations(spot_id, code, name)
select spot.id, 'PRINCIPAL', 'El Iglú · Stock principal'
from public.commerce_spots spot
join public.studios studio on studio.id = spot.studio_id
where studio.slug = 'el-iglu' and spot.slug = 'el-iglu'
on conflict (spot_id, code) do update set name = excluded.name, updated_at = now();

insert into public.commerce_flow_accounts(spot_id, local_currency)
select spot.id, spot.currency
from public.commerce_spots spot
join public.studios studio on studio.id = spot.studio_id
where studio.slug = 'el-iglu' and spot.slug = 'el-iglu'
on conflict (spot_id) do update set local_currency = excluded.local_currency;

insert into public.commerce_financial_goals(spot_id, name, metric, target_currency, target_amount, status, created_by)
select spot.id, 'Objetivo USD 50.000', 'net_profit', 'USD', 50000, 'active', studio.owner_id
from public.commerce_spots spot
join public.studios studio on studio.id = spot.studio_id
where studio.slug = 'el-iglu' and spot.slug = 'el-iglu'
on conflict (spot_id, metric) where status = 'active' do nothing;

create or replace function public.normalize_commerce_identifier(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]-]+', '', 'g'));
$$;

create or replace function public.reject_commerce_immutable_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Este registro es inmutable; creá un movimiento compensatorio.';
end;
$$;

drop trigger if exists commerce_inventory_movements_immutable on public.commerce_inventory_movements;
create trigger commerce_inventory_movements_immutable
  before update or delete on public.commerce_inventory_movements
  for each row execute function public.reject_commerce_immutable_change();

drop trigger if exists commerce_fx_rates_immutable on public.commerce_fx_rates;
create trigger commerce_fx_rates_immutable
  before update or delete on public.commerce_fx_rates
  for each row execute function public.reject_commerce_immutable_change();

drop trigger if exists commerce_flow_ledger_immutable on public.commerce_flow_ledger;
create trigger commerce_flow_ledger_immutable
  before update or delete on public.commerce_flow_ledger
  for each row execute function public.reject_commerce_immutable_change();

create or replace function public.resolve_commerce_identifier(
  p_spot_id uuid,
  p_value text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'identifier', to_jsonb(identifier),
      'catalog_product', to_jsonb(catalog_product),
      'catalog_variant', case when catalog_variant.id is null then null else to_jsonb(catalog_variant) end,
      'listing', case when listing.id is null then null else to_jsonb(listing) end,
      'listing_variant', case when listing_variant.id is null then null else to_jsonb(listing_variant) end,
      'exists_in_spot', listing.id is not null
    )
    from public.commerce_product_identifiers identifier
    join public.commerce_catalog_products catalog_product
      on catalog_product.id = identifier.catalog_product_id
    left join public.commerce_catalog_variants catalog_variant
      on catalog_variant.id = identifier.catalog_variant_id
    left join public.commerce_products listing
      on listing.spot_id = p_spot_id
     and listing.catalog_product_id = identifier.catalog_product_id
    left join public.commerce_product_variants listing_variant
      on listing_variant.product_id = listing.id
     and (
       identifier.catalog_variant_id is null
       or listing_variant.catalog_variant_id = identifier.catalog_variant_id
     )
    where identifier.normalized_value = public.normalize_commerce_identifier(p_value)
      and (identifier.spot_id is null or identifier.spot_id = p_spot_id)
    order by (identifier.spot_id = p_spot_id) desc, identifier.is_primary desc, identifier.created_at
    limit 1
  ), jsonb_build_object('exists', false));
$$;

create or replace function public.adjust_commerce_spot_inventory(
  p_spot_id uuid,
  p_listing_id uuid,
  p_variant_id uuid,
  p_location_id uuid,
  p_quantity_delta integer,
  p_movement_type text,
  p_unit_cost numeric,
  p_currency text,
  p_reference text,
  p_note text,
  p_actor_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_stock integer;
  v_existing public.commerce_inventory_movements%rowtype;
begin
  if p_quantity_delta = 0 then raise exception 'La cantidad no puede ser cero.'; end if;
  if p_movement_type not in (
    'opening_stock', 'purchase_receipt', 'sale', 'refund', 'adjustment_in',
    'adjustment_out', 'transfer_in', 'transfer_out', 'reservation', 'release', 'correction'
  ) then raise exception 'Tipo de movimiento inválido.'; end if;

  select * into v_existing
  from public.commerce_inventory_movements
  where idempotency_key = p_idempotency_key;
  if found then return to_jsonb(v_existing); end if;

  perform 1 from public.commerce_inventory_locations
  where id = p_location_id and spot_id = p_spot_id and status = 'active';
  if not found then raise exception 'La ubicación no pertenece al Spot.'; end if;

  select * into v_listing from public.commerce_products
  where id = p_listing_id and spot_id = p_spot_id
  for update;
  if not found then raise exception 'La publicación no pertenece al Spot.'; end if;

  if p_variant_id is not null then
    select * into v_variant from public.commerce_product_variants
    where id = p_variant_id and product_id = p_listing_id
    for update;
    if not found then raise exception 'La variante no pertenece a la publicación.'; end if;
    v_stock := v_variant.stock + p_quantity_delta;
    if v_stock < 0 then raise exception 'Stock insuficiente.'; end if;
    update public.commerce_product_variants set stock = v_stock where id = p_variant_id;
  else
    v_stock := coalesce(v_listing.stock, 0) + p_quantity_delta;
    if v_stock < 0 then raise exception 'Stock insuficiente.'; end if;
    update public.commerce_products set stock = v_stock where id = p_listing_id;
  end if;

  insert into public.commerce_inventory_movements(
    spot_id, location_id, listing_id, listing_variant_id, movement_type,
    quantity_delta, stock_after, unit_cost, currency, reference, note,
    actor_id, idempotency_key, metadata
  ) values (
    p_spot_id, p_location_id, p_listing_id, p_variant_id, p_movement_type,
    p_quantity_delta, v_stock, p_unit_cost, upper(p_currency), p_reference, p_note,
    p_actor_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_existing;

  return to_jsonb(v_existing);
end;
$$;

create or replace function public.record_commerce_fx_rate(
  p_spot_id uuid,
  p_local_currency text,
  p_local_per_usd numeric,
  p_source text,
  p_source_reference text,
  p_quoted_at timestamptz,
  p_raw_snapshot jsonb,
  p_idempotency_key text
)
returns public.commerce_fx_rates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate public.commerce_fx_rates%rowtype;
begin
  insert into public.commerce_fx_rates(
    spot_id, local_currency, quote_currency, local_per_quote, source,
    source_reference, quoted_at, raw_snapshot, idempotency_key
  ) values (
    p_spot_id, upper(p_local_currency), 'USD', p_local_per_usd, p_source,
    p_source_reference, p_quoted_at, coalesce(p_raw_snapshot, '{}'::jsonb), p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning * into v_rate;

  if v_rate.id is null then
    select * into v_rate from public.commerce_fx_rates where idempotency_key = p_idempotency_key;
  end if;
  return v_rate;
end;
$$;

create or replace function public.commerce_spot_financial_summary(p_spot_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with totals as (
    select
      coalesce(sum(gross_original), 0) as gross_local,
      coalesce(sum(cost_original), 0) as costs_local,
      coalesce(sum(commission_original), 0) as commissions_local,
      coalesce(sum(net_original), 0) as net_local,
      coalesce(sum(gross_usd), 0) as gross_usd,
      coalesce(sum(cost_usd), 0) as costs_usd,
      coalesce(sum(commission_usd), 0) as commissions_usd,
      coalesce(sum(net_usd), 0) as net_usd,
      coalesce(sum(flows_amount), 0) as flows
    from public.commerce_flow_ledger
    where spot_id = p_spot_id and status = 'confirmed'
  ), goal as (
    select * from public.commerce_financial_goals
    where spot_id = p_spot_id and status = 'active'
    order by created_at desc limit 1
  ), latest_fx as (
    select * from public.commerce_fx_rates
    where spot_id = p_spot_id
    order by quoted_at desc limit 1
  )
  select jsonb_build_object(
    'gross_local', totals.gross_local,
    'costs_local', totals.costs_local,
    'commissions_local', totals.commissions_local,
    'net_local', totals.net_local,
    'available_local', totals.net_local,
    'gross_usd', totals.gross_usd,
    'costs_usd', totals.costs_usd,
    'commissions_usd', totals.commissions_usd,
    'net_usd', totals.net_usd,
    'flows', totals.flows,
    'goal', case when goal.id is null then null else jsonb_build_object(
      'id', goal.id,
      'name', goal.name,
      'metric', goal.metric,
      'target_currency', goal.target_currency,
      'target_amount', goal.target_amount,
      'progress_amount', case goal.metric
        when 'gross_revenue' then totals.gross_usd
        when 'available_balance' then totals.net_usd
        else totals.net_usd
      end
    ) end,
    'fx_rate', case when latest_fx.id is null then null else to_jsonb(latest_fx) end
  )
  from totals left join goal on true left join latest_fx on true;
$$;

create or replace function public.upsert_commerce_scanned_product(
  p_spot_id uuid,
  p_identifier_type text,
  p_identifier_value text,
  p_product jsonb,
  p_listing jsonb,
  p_variant jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_location public.commerce_inventory_locations%rowtype;
  v_catalog public.commerce_catalog_products%rowtype;
  v_catalog_variant public.commerce_catalog_variants%rowtype;
  v_listing public.commerce_products%rowtype;
  v_listing_variant public.commerce_product_variants%rowtype;
  v_identifier public.commerce_product_identifiers%rowtype;
  v_normalized text;
  v_kind text;
  v_name text;
  v_slug text;
  v_price numeric;
  v_cost numeric;
  v_stock integer;
  v_sku text;
  v_status text;
  v_listing_created boolean := false;
begin
  v_normalized := public.normalize_commerce_identifier(p_identifier_value);
  if v_normalized = '' then raise exception 'El código es obligatorio.'; end if;
  if p_identifier_type not in ('ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'clouva_barcode', 'clouva_qr', 'sku') then
    raise exception 'Tipo de identificador inválido.';
  end if;

  select * into v_spot from public.commerce_spots where id = p_spot_id for update;
  if not found or v_spot.status <> 'active' then raise exception 'El Spot no está activo.'; end if;

  select * into v_location from public.commerce_inventory_locations
  where spot_id = p_spot_id and status = 'active'
  order by (code = 'PRINCIPAL') desc, created_at
  limit 1;
  if not found then raise exception 'El Spot no tiene una ubicación de inventario activa.'; end if;

  select * into v_identifier from public.commerce_product_identifiers
  where identifier_type = p_identifier_type and normalized_value = v_normalized
    and (spot_id is null or spot_id = p_spot_id)
  order by (spot_id = p_spot_id) desc, created_at
  limit 1;

  if found then
    select * into v_catalog from public.commerce_catalog_products where id = v_identifier.catalog_product_id;
    if v_identifier.catalog_variant_id is not null then
      select * into v_catalog_variant from public.commerce_catalog_variants where id = v_identifier.catalog_variant_id;
    end if;
  else
    v_kind := coalesce(nullif(p_product ->> 'product_kind', ''), 'physical');
    v_name := btrim(coalesce(p_product ->> 'name', ''));
    if v_kind not in ('physical', 'avatar_item', 'digital', 'bundle') then raise exception 'Tipo de producto inválido.'; end if;
    if v_name = '' then raise exception 'El nombre del producto es obligatorio.'; end if;

    insert into public.commerce_catalog_products(
      product_kind, name, description, brand, category, design_key,
      avatar_asset_id, status, metadata, created_by
    ) values (
      v_kind, v_name, nullif(btrim(p_product ->> 'description'), ''),
      nullif(btrim(p_product ->> 'brand'), ''), nullif(btrim(p_product ->> 'category'), ''),
      nullif(btrim(p_product ->> 'design_key'), ''),
      nullif(p_product ->> 'avatar_asset_id', '')::uuid, 'active',
      coalesce(p_product -> 'metadata', '{}'::jsonb), p_actor_id
    ) returning * into v_catalog;

    if v_kind = 'physical' and p_variant is not null and p_variant <> '{}'::jsonb then
      insert into public.commerce_catalog_variants(
        catalog_product_id, title, size, color, presentation, metadata
      ) values (
        v_catalog.id, nullif(btrim(p_variant ->> 'title'), ''),
        nullif(btrim(p_variant ->> 'size'), ''), nullif(btrim(p_variant ->> 'color'), ''),
        nullif(btrim(p_variant ->> 'presentation'), ''),
        coalesce(p_variant -> 'metadata', '{}'::jsonb)
      ) returning * into v_catalog_variant;
    end if;

    insert into public.commerce_product_identifiers(
      catalog_product_id, catalog_variant_id, spot_id, identifier_type,
      value, normalized_value, is_primary, created_by
    ) values (
      v_catalog.id, v_catalog_variant.id,
      case when p_identifier_type in ('sku', 'clouva_barcode', 'clouva_qr') then p_spot_id else null end,
      p_identifier_type, btrim(p_identifier_value), v_normalized, true, p_actor_id
    ) returning * into v_identifier;
  end if;

  select * into v_listing from public.commerce_products
  where spot_id = p_spot_id and catalog_product_id = v_catalog.id
  order by created_at limit 1 for update;

  if not found then
    v_price := coalesce(nullif(p_listing ->> 'price', '')::numeric, 0);
    v_cost := nullif(p_listing ->> 'cost', '')::numeric;
    v_status := coalesce(nullif(p_listing ->> 'status', ''), 'draft');
    if v_price < 0 or v_cost < 0 then raise exception 'Precio o costo inválido.'; end if;
    if v_status not in ('draft', 'published', 'paused') then v_status := 'draft'; end if;
    v_slug := lower(regexp_replace(normalize(v_catalog.name, NFD), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then v_slug := 'producto'; end if;
    v_slug := left(v_slug, 64) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

    insert into public.commerce_products(
      owner_type, studio_id, spot_id, catalog_product_id, product_type,
      name, slug, description, price, cost_amount, currency, stock, status,
      cover_url, gallery, avatar_asset_id, listing_kind, metadata, created_by
    ) values (
      'studio', v_spot.studio_id, p_spot_id, v_catalog.id, v_catalog.product_kind,
      v_catalog.name, v_slug, v_catalog.description, v_price, v_cost, v_spot.currency,
      case when v_catalog.product_kind = 'physical' and v_catalog_variant.id is null then 0 else null end, v_status,
      nullif(btrim(p_listing ->> 'cover_url'), ''), coalesce(p_listing -> 'gallery', '[]'::jsonb),
      v_catalog.avatar_asset_id,
      coalesce(nullif(p_listing ->> 'listing_kind', ''), case when p_identifier_type like 'ean%' or p_identifier_type like 'upc%' then 'resale' else 'standard' end),
      coalesce(p_listing -> 'metadata', '{}'::jsonb), p_actor_id
    ) returning * into v_listing;
    v_listing_created := true;
  end if;

  if v_catalog.product_kind = 'physical' and v_catalog_variant.id is not null then
    select * into v_listing_variant from public.commerce_product_variants
    where product_id = v_listing.id and catalog_variant_id = v_catalog_variant.id
    limit 1 for update;
    if not found then
      v_sku := nullif(btrim(p_variant ->> 'sku'), '');
      insert into public.commerce_product_variants(
        product_id, catalog_variant_id, sku, title, size, color,
        price_override, cost_override, stock, active, metadata
      ) values (
        v_listing.id, v_catalog_variant.id, v_sku, v_catalog_variant.title,
        v_catalog_variant.size, v_catalog_variant.color,
        nullif(p_variant ->> 'price', '')::numeric,
        nullif(p_variant ->> 'cost', '')::numeric,
        0, true, coalesce(p_variant -> 'metadata', '{}'::jsonb)
      ) returning * into v_listing_variant;
      if v_sku is not null then
        insert into public.commerce_product_identifiers(
          catalog_product_id, catalog_variant_id, spot_id, identifier_type,
          value, normalized_value, is_primary, created_by
        ) values (
          v_catalog.id, v_catalog_variant.id, p_spot_id, 'sku',
          v_sku, public.normalize_commerce_identifier(v_sku), false, p_actor_id
        ) on conflict do nothing;
      end if;
    end if;
  end if;

  v_stock := greatest(0, coalesce(nullif(p_listing ->> 'initial_stock', '')::integer, 0));
  if v_listing_created and v_catalog.product_kind = 'physical' and v_stock > 0 then
    perform public.adjust_commerce_spot_inventory(
      p_spot_id, v_listing.id, v_listing_variant.id, v_location.id,
      v_stock, 'opening_stock', coalesce(v_listing_variant.cost_override, v_listing.cost_amount),
      v_spot.currency, 'scanner:first-load', 'Carga inicial desde escáner',
      p_actor_id, p_idempotency_key || ':opening-stock',
      jsonb_build_object('identifier_id', v_identifier.id)
    );
  end if;

  return jsonb_build_object(
    'identifier', to_jsonb(v_identifier),
    'catalog_product', to_jsonb(v_catalog),
    'catalog_variant', case when v_catalog_variant.id is null then null else to_jsonb(v_catalog_variant) end,
    'listing', to_jsonb(v_listing),
    'listing_variant', case when v_listing_variant.id is null then null else to_jsonb(v_listing_variant) end,
    'created', v_listing_created
  );
end;
$$;

create or replace function public.expand_commerce_bundle_order_items(
  p_order_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_parent record;
  v_component record;
  v_component_count integer;
  v_expanded_count integer;
begin
  select * into v_order
  from public.commerce_orders
  where id = p_order_id
  for update;
  if not found then raise exception 'Pedido inexistente.'; end if;
  if v_order.spot_id is null then
    return jsonb_build_object('expanded_items', 0, 'bundle_items', 0);
  end if;
  if v_order.payment_status not in ('pending', 'paid') then
    raise exception 'El pedido no admite expansión de combos.';
  end if;

  for v_parent in
    select item.id, item.product_id, item.quantity, item.product_name
    from public.commerce_order_items item
    where item.order_id = p_order_id
      and item.product_type = 'bundle'
      and item.bundle_parent_item_id is null
    order by item.id
    for update
  loop
    v_component_count := 0;
    for v_component in
      select component.id as component_id,
             component.component_listing_id,
             component.component_variant_id,
             component.quantity as component_quantity,
             component.component_role,
             product.name,
             product.product_type,
             product.spot_id,
             variant.product_id as variant_product_id,
             variant.sku,
             variant.title as variant_title,
             variant.size,
             variant.color
      from public.commerce_listing_components component
      join public.commerce_products product on product.id = component.component_listing_id
      left join public.commerce_product_variants variant on variant.id = component.component_variant_id
      where component.bundle_listing_id = v_parent.product_id
      order by component.component_listing_id, component.component_variant_id nulls first
    loop
      v_component_count := v_component_count + 1;
      if v_component.spot_id is distinct from v_order.spot_id then
        raise exception 'Un componente del combo no pertenece al Spot.';
      end if;
      if v_component.product_type = 'bundle' then
        raise exception 'Los combos anidados no están permitidos.';
      end if;
      if (v_component.product_type = 'physical') is distinct from (v_component.component_role = 'physical') then
        raise exception 'El rol físico/digital del componente no coincide con el producto.';
      end if;
      if v_component.component_variant_id is not null
         and v_component.variant_product_id is distinct from v_component.component_listing_id then
        raise exception 'La variante del componente no pertenece al producto.';
      end if;
      if v_component.product_type <> 'physical' and v_order.buyer_id is null then
        raise exception 'El componente digital del combo necesita un comprador CLOUVA.';
      end if;

      insert into public.commerce_order_items(
        order_id, product_id, variant_id, sku_snapshot, variant_snapshot,
        product_name, product_type, quantity, unit_price, total,
        delivery_status, bundle_parent_item_id, bundle_component_id, metadata
      ) values (
        p_order_id, v_component.component_listing_id, v_component.component_variant_id,
        v_component.sku,
        case when v_component.component_variant_id is null then '{}'::jsonb else jsonb_build_object(
          'id', v_component.component_variant_id, 'sku', v_component.sku,
          'title', v_component.variant_title, 'size', v_component.size, 'color', v_component.color
        ) end,
        v_component.name, v_component.product_type,
        v_parent.quantity * v_component.component_quantity, 0, 0,
        case when v_component.product_type = 'physical' then 'not_applicable' else 'pending' end,
        v_parent.id, v_component.component_id,
        jsonb_build_object(
          'bundle_parent_product_id', v_parent.product_id,
          'bundle_parent_name', v_parent.product_name,
          'bundle_expansion_key', p_idempotency_key
        )
      ) on conflict do nothing;
    end loop;
    if v_component_count = 0 then
      raise exception 'El combo % no tiene componentes configurados.', v_parent.product_name;
    end if;
    update public.commerce_order_items
    set delivery_status = 'not_applicable', delivery_error = null
    where id = v_parent.id;
  end loop;

  select count(*) into v_expanded_count
  from public.commerce_order_items
  where order_id = p_order_id and bundle_parent_item_id is not null;

  return jsonb_build_object(
    'expanded_items', v_expanded_count,
    'bundle_items', (
      select count(*) from public.commerce_order_items
      where order_id = p_order_id and product_type = 'bundle' and bundle_parent_item_id is null
    )
  );
end;
$$;

create or replace function public.configure_commerce_listing_bundle(
  p_spot_id uuid,
  p_bundle_listing_id uuid,
  p_components jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bundle public.commerce_products%rowtype;
  v_item jsonb;
  v_component public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_physical_count integer := 0;
  v_digital_count integer := 0;
  v_count integer := 0;
begin
  if jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) < 2 then
    raise exception 'El combo necesita un componente físico y uno digital.';
  end if;
  select * into v_bundle from public.commerce_products
  where id = p_bundle_listing_id and spot_id = p_spot_id for update;
  if not found or v_bundle.product_type <> 'bundle' then
    raise exception 'La publicación no es un combo de este Spot.';
  end if;

  for v_item in select value from jsonb_array_elements(p_components)
  loop
    select * into v_component from public.commerce_products
    where id = (v_item ->> 'listing_id')::uuid and spot_id = p_spot_id;
    if not found or v_component.id = v_bundle.id or v_component.product_type = 'bundle' then
      raise exception 'Componente de combo inválido.';
    end if;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_variant from public.commerce_product_variants
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_component.id and active = true;
      if not found then raise exception 'Variante de combo inválida.'; end if;
      if v_component.product_type <> 'physical' then
        raise exception 'Los componentes digitales se entregan por producto, sin variante de stock.';
      end if;
    end if;
    if v_component.product_type = 'physical' then
      v_physical_count := v_physical_count + 1;
    else
      v_digital_count := v_digital_count + 1;
    end if;
  end loop;
  if v_physical_count = 0 or v_digital_count = 0 then
    raise exception 'El combo necesita al menos un producto físico y uno digital.';
  end if;

  delete from public.commerce_listing_components where bundle_listing_id = p_bundle_listing_id;
  for v_item in select value from jsonb_array_elements(p_components)
  loop
    select * into v_component from public.commerce_products where id = (v_item ->> 'listing_id')::uuid;
    insert into public.commerce_listing_components(
      bundle_listing_id, component_listing_id, component_variant_id, quantity, component_role
    ) values (
      p_bundle_listing_id, v_component.id, nullif(v_item ->> 'variant_id', '')::uuid,
      greatest(1, coalesce((v_item ->> 'quantity')::integer, 1)),
      case when v_component.product_type = 'physical' then 'physical' else 'digital' end
    );
    v_count := v_count + 1;
  end loop;

  update public.commerce_products
  set listing_kind = 'combo', updated_at = now()
  where id = p_bundle_listing_id;

  return jsonb_build_object('bundle_listing_id', p_bundle_listing_id, 'components', v_count);
end;
$$;

create or replace function public.record_commerce_order_stock_movements(
  p_order_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_location public.commerce_inventory_locations%rowtype;
  v_line record;
  v_recorded integer := 0;
begin
  select * into v_order from public.commerce_orders where id = p_order_id for update;
  if not found or v_order.spot_id is null then raise exception 'Pedido de Spot inexistente.'; end if;
  if v_order.payment_status <> 'paid' or v_order.fulfillment_status = 'stock_conflict' then
    return jsonb_build_object('recorded', 0, 'skipped', true);
  end if;
  select * into v_location from public.commerce_inventory_locations
  where spot_id = v_order.spot_id and status = 'active'
  order by (code = 'PRINCIPAL') desc, created_at limit 1;
  if not found then raise exception 'No existe una ubicación de stock activa.'; end if;

  for v_line in
    select item.product_id, item.variant_id, sum(item.quantity)::integer as quantity,
           product.stock as product_stock, product.cost_amount,
           variant.stock as variant_stock, variant.cost_override
    from public.commerce_order_items item
    join public.commerce_products product on product.id = item.product_id
    left join public.commerce_product_variants variant on variant.id = item.variant_id
    where item.order_id = p_order_id and item.product_type = 'physical'
    group by item.product_id, item.variant_id, product.stock, product.cost_amount,
             variant.stock, variant.cost_override
    order by item.product_id, item.variant_id nulls first
  loop
    insert into public.commerce_inventory_movements(
      spot_id, location_id, listing_id, listing_variant_id, movement_type,
      quantity_delta, stock_after, unit_cost, currency, order_id,
      reference, idempotency_key, actor_id, metadata
    ) values (
      v_order.spot_id, v_location.id, v_line.product_id, v_line.variant_id, 'sale',
      -v_line.quantity, coalesce(v_line.variant_stock, v_line.product_stock, 0),
      coalesce(v_line.cost_override, v_line.cost_amount), v_order.currency, p_order_id,
      'order-paid', p_idempotency_key || ':' || v_line.product_id::text || ':' || coalesce(v_line.variant_id::text, 'base'),
      p_actor_id, jsonb_build_object('sales_channel', v_order.sales_channel)
    ) on conflict (idempotency_key) do nothing;
    if found then v_recorded := v_recorded + 1; end if;
  end loop;

  return jsonb_build_object('recorded', v_recorded, 'skipped', false);
end;
$$;

create or replace function public.record_commerce_spot_payment(
  p_order_id uuid,
  p_spot_id uuid,
  p_provider text,
  p_payment_method text,
  p_external_payment_id text,
  p_fee_amount numeric,
  p_fx_rate_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_rate public.commerce_fx_rates%rowtype;
  v_account public.commerce_flow_accounts%rowtype;
  v_payment public.commerce_payments%rowtype;
  v_ledger public.commerce_flow_ledger%rowtype;
  v_cost numeric := 0;
  v_commission numeric := 0;
  v_net numeric := 0;
begin
  select * into v_payment from public.commerce_payments where idempotency_key = p_idempotency_key;
  if found then
    select * into v_ledger from public.commerce_flow_ledger where payment_id = v_payment.id limit 1;
    return jsonb_build_object('payment', to_jsonb(v_payment), 'ledger', to_jsonb(v_ledger), 'duplicate', true);
  end if;

  select * into v_order from public.commerce_orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente.'; end if;
  if v_order.payment_status <> 'paid' then raise exception 'El pedido no está confirmado como pagado.'; end if;
  if v_order.spot_id is distinct from p_spot_id then raise exception 'El pedido no pertenece al Spot.'; end if;

  select * into v_rate from public.commerce_fx_rates
  where id = p_fx_rate_id and spot_id = p_spot_id for share;
  if not found then raise exception 'Cotización inválida para el Spot.'; end if;
  if v_rate.local_currency <> v_order.currency or v_rate.quote_currency <> 'USD' then
    raise exception 'La cotización no corresponde a la moneda del pedido.';
  end if;

  select coalesce(sum(
    item.quantity * coalesce(variant.cost_override, product.cost_amount, 0)
  ), 0)
  into v_cost
  from public.commerce_order_items item
  join public.commerce_products product on product.id = item.product_id
  left join public.commerce_product_variants variant on variant.id = item.variant_id
  where item.order_id = p_order_id
    and item.product_type <> 'bundle';

  v_commission := coalesce(v_order.commission, 0) + greatest(coalesce(p_fee_amount, 0), 0);
  v_net := v_order.total - v_cost - v_commission;

  select * into v_account from public.commerce_flow_accounts where spot_id = p_spot_id for update;
  if not found then raise exception 'El Spot no tiene cuenta Flow.'; end if;

  insert into public.commerce_payments(
    spot_id, order_id, provider, payment_method, status, gross_amount,
    fee_amount, net_amount, currency, external_payment_id, idempotency_key,
    confirmed_by, confirmed_at, fx_rate_id, metadata
  ) values (
    p_spot_id, p_order_id, p_provider, p_payment_method, 'confirmed', v_order.total,
    greatest(coalesce(p_fee_amount, 0), 0), v_net, v_order.currency,
    nullif(p_external_payment_id, ''), p_idempotency_key,
    p_actor_id, coalesce(v_order.paid_at, now()), v_rate.id, coalesce(p_metadata, '{}'::jsonb)
  ) returning * into v_payment;

  insert into public.commerce_flow_ledger(
    account_id, spot_id, entry_type, original_currency,
    gross_original, cost_original, commission_original, net_original,
    gross_usd, cost_usd, commission_usd, net_usd, flows_amount,
    fx_rate_id, fx_local_per_usd, fx_source, fx_quoted_at,
    order_id, payment_id, status, idempotency_key, metadata, created_by
  ) values (
    v_account.id, p_spot_id, 'sale', v_order.currency,
    v_order.total, v_cost, v_commission, v_net,
    round(v_order.total / v_rate.local_per_quote, 8),
    round(v_cost / v_rate.local_per_quote, 8),
    round(v_commission / v_rate.local_per_quote, 8),
    round(v_net / v_rate.local_per_quote, 8),
    round(v_net / v_rate.local_per_quote, 8),
    v_rate.id, v_rate.local_per_quote, v_rate.source, v_rate.quoted_at,
    p_order_id, v_payment.id, 'confirmed', p_idempotency_key || ':flow',
    coalesce(p_metadata, '{}'::jsonb), p_actor_id
  ) returning * into v_ledger;

  return jsonb_build_object('payment', to_jsonb(v_payment), 'ledger', to_jsonb(v_ledger), 'duplicate', false);
end;
$$;

create or replace function public.complete_commerce_pos_sale(
  p_spot_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_customer_name text,
  p_customer_email text,
  p_buyer_id uuid,
  p_fx_rate_id uuid,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_location public.commerce_inventory_locations%rowtype;
  v_existing_payment public.commerce_payments%rowtype;
  v_order public.commerce_orders%rowtype;
  v_item jsonb;
  v_listing public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_order_item public.commerce_order_items%rowtype;
  v_delivery record;
  v_quantity integer;
  v_price numeric;
  v_total numeric := 0;
  v_line_total numeric;
  v_confirmation_result jsonb;
  v_payment_result jsonb;
begin
  if p_payment_method not in ('cash', 'transfer', 'debit_card', 'credit_card', 'other') then
    raise exception 'Medio de pago no permitido en caja.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta necesita al menos un producto.';
  end if;

  select * into v_existing_payment from public.commerce_payments where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing_payment.order_id, 'duplicate', true);
  end if;

  select * into v_spot from public.commerce_spots where id = p_spot_id for update;
  if not found or v_spot.status <> 'active' then raise exception 'El Spot no está activo.'; end if;
  select * into v_location from public.commerce_inventory_locations
  where spot_id = p_spot_id and status = 'active'
  order by (code = 'PRINCIPAL') desc, created_at limit 1;
  if not found then raise exception 'No existe una ubicación de stock activa.'; end if;

  -- Lock and price every requested row in a stable identifier order.
  for v_item in
    select value from jsonb_array_elements(p_items) order by value ->> 'listing_id', value ->> 'variant_id'
  loop
    v_quantity := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));
    select * into v_listing from public.commerce_products
    where id = (v_item ->> 'listing_id')::uuid and spot_id = p_spot_id
    for update;
    if not found then raise exception 'Una publicación no pertenece al Spot.'; end if;

    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_variant from public.commerce_product_variants
      where id = (v_item ->> 'variant_id')::uuid and product_id = v_listing.id
      for update;
      if not found or not v_variant.active then raise exception 'Variante inválida.'; end if;
      if v_variant.stock < v_quantity then raise exception 'Stock insuficiente para %.', v_listing.name; end if;
      v_price := coalesce(v_variant.price_override, v_listing.price);
    else
      v_variant := null;
      if v_listing.stock is not null and v_listing.stock < v_quantity then raise exception 'Stock insuficiente para %.', v_listing.name; end if;
      v_price := v_listing.price;
    end if;
    if v_listing.product_type <> 'physical'
       and v_listing.product_type <> 'bundle'
       and p_buyer_id is null then
      raise exception 'Un producto digital necesita un comprador CLOUVA.';
    end if;
    v_total := v_total + (v_price * v_quantity);
  end loop;

  insert into public.commerce_orders(
    buyer_id, seller_type, seller_studio_id, spot_id, subtotal, fees,
    commission, total, currency, status, payment_status, fulfillment_status,
    external_reference, paid_at, completed_at, stock_committed_at,
    sales_channel, payment_method, customer_name, customer_email, created_by,
    metadata
  ) values (
    p_buyer_id, 'studio', v_spot.studio_id, p_spot_id, v_total, 0,
    0, v_total, v_spot.currency, 'pending', 'pending', 'pending',
    'pos:' || p_idempotency_key, null, null, null,
    'pos', p_payment_method, nullif(btrim(p_customer_name), ''),
    nullif(lower(btrim(p_customer_email)), ''), p_actor_id,
    jsonb_build_object('pos_idempotency_key', p_idempotency_key)
  ) returning * into v_order;

  for v_item in
    select value from jsonb_array_elements(p_items) order by value ->> 'listing_id', value ->> 'variant_id'
  loop
    v_quantity := greatest(1, coalesce((v_item ->> 'quantity')::integer, 1));
    select * into v_listing from public.commerce_products where id = (v_item ->> 'listing_id')::uuid;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_variant from public.commerce_product_variants where id = (v_item ->> 'variant_id')::uuid;
      v_price := coalesce(v_variant.price_override, v_listing.price);
    else
      v_variant := null;
      v_price := v_listing.price;
    end if;
    v_line_total := v_price * v_quantity;

    insert into public.commerce_order_items(
      order_id, product_id, variant_id, sku_snapshot, variant_snapshot,
      product_name, product_type, quantity, unit_price, total,
      delivery_status, metadata
    ) values (
      v_order.id, v_listing.id, v_variant.id, v_variant.sku,
      case when v_variant.id is null then '{}'::jsonb else jsonb_build_object(
        'id', v_variant.id, 'sku', v_variant.sku, 'title', v_variant.title,
        'size', v_variant.size, 'color', v_variant.color
      ) end,
      v_listing.name, v_listing.product_type, v_quantity, v_price, v_line_total,
      case when v_listing.product_type in ('physical', 'bundle') then 'not_applicable' else 'pending' end,
      jsonb_build_object('sales_channel', 'pos')
    ) returning * into v_order_item;
  end loop;

  perform public.expand_commerce_bundle_order_items(
    v_order.id, p_idempotency_key || ':bundle'
  );

  v_confirmation_result := public.confirm_commerce_order_payment(
    v_order.id, 'pos:' || p_idempotency_key, now()
  );
  if coalesce((v_confirmation_result ->> 'stock_conflict')::boolean, false) then
    raise exception 'Stock insuficiente para completar la venta.';
  end if;

  perform public.record_commerce_order_stock_movements(
    v_order.id, p_actor_id, p_idempotency_key || ':inventory'
  );

  for v_delivery in
    select id from public.commerce_order_items
    where order_id = v_order.id
      and product_type not in ('physical', 'bundle')
    order by id
  loop
    perform public.deliver_commerce_order_item(v_delivery.id);
  end loop;

  v_payment_result := public.record_commerce_spot_payment(
    v_order.id, p_spot_id, 'manual', p_payment_method, null,
    0, p_fx_rate_id, p_actor_id, p_idempotency_key,
    jsonb_build_object('sales_channel', 'pos')
  );

  select * into v_order from public.commerce_orders where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order', to_jsonb(v_order),
    'payment', v_payment_result,
    'duplicate', false
  );
end;
$$;

create or replace function public.record_commerce_spot_refund(
  p_order_id uuid,
  p_external_payment_id text,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_original_payment public.commerce_payments%rowtype;
  v_refund_payment public.commerce_payments%rowtype;
  v_original_ledger public.commerce_flow_ledger%rowtype;
  v_refund_ledger public.commerce_flow_ledger%rowtype;
  v_location public.commerce_inventory_locations%rowtype;
  v_line record;
  v_stock integer;
  v_index integer := 0;
begin
  select * into v_refund_payment from public.commerce_payments where idempotency_key = p_idempotency_key;
  if found then
    select * into v_refund_ledger from public.commerce_flow_ledger where payment_id = v_refund_payment.id limit 1;
    return jsonb_build_object('payment', to_jsonb(v_refund_payment), 'ledger', to_jsonb(v_refund_ledger), 'duplicate', true);
  end if;

  select * into v_order from public.commerce_orders where id = p_order_id for update;
  if not found or v_order.payment_status <> 'refunded' or v_order.spot_id is null then
    raise exception 'El pedido no está registrado como reembolsado en un Spot.';
  end if;
  select * into v_original_payment from public.commerce_payments
  where order_id = p_order_id and status = 'confirmed'
  order by created_at limit 1 for update;
  if not found then raise exception 'No existe un pago Flow original para revertir.'; end if;
  select * into v_original_ledger from public.commerce_flow_ledger
  where payment_id = v_original_payment.id and entry_type = 'sale'
  limit 1;
  if not found then raise exception 'No existe un movimiento Flow original para revertir.'; end if;

  insert into public.commerce_payments(
    spot_id, order_id, provider, payment_method, status, gross_amount,
    fee_amount, net_amount, currency, external_payment_id, idempotency_key,
    confirmed_by, confirmed_at, fx_rate_id, metadata
  ) values (
    v_order.spot_id, p_order_id, v_original_payment.provider || '_refund',
    v_original_payment.payment_method, 'refunded', v_original_payment.gross_amount,
    0, -v_original_payment.net_amount, v_original_payment.currency,
    nullif(p_external_payment_id, '') || ':refund', p_idempotency_key,
    p_actor_id, coalesce(v_order.refunded_at, now()), v_original_payment.fx_rate_id,
    jsonb_build_object('reverses_payment_id', v_original_payment.id)
  ) returning * into v_refund_payment;

  insert into public.commerce_flow_ledger(
    account_id, spot_id, entry_type, original_currency,
    gross_original, cost_original, commission_original, net_original,
    gross_usd, cost_usd, commission_usd, net_usd, flows_amount,
    fx_rate_id, fx_local_per_usd, fx_source, fx_quoted_at,
    order_id, payment_id, status, reverses_entry_id, idempotency_key, metadata, created_by
  ) values (
    v_original_ledger.account_id, v_original_ledger.spot_id, 'refund', v_original_ledger.original_currency,
    -v_original_ledger.gross_original, -v_original_ledger.cost_original,
    -v_original_ledger.commission_original, -v_original_ledger.net_original,
    -v_original_ledger.gross_usd, -v_original_ledger.cost_usd,
    -v_original_ledger.commission_usd, -v_original_ledger.net_usd,
    -v_original_ledger.flows_amount,
    v_original_ledger.fx_rate_id, v_original_ledger.fx_local_per_usd,
    v_original_ledger.fx_source, v_original_ledger.fx_quoted_at,
    p_order_id, v_refund_payment.id, 'confirmed', v_original_ledger.id,
    p_idempotency_key || ':flow', jsonb_build_object('reason', 'payment_refunded'), p_actor_id
  ) returning * into v_refund_ledger;

  select * into v_location from public.commerce_inventory_locations
  where spot_id = v_order.spot_id and status = 'active'
  order by (code = 'PRINCIPAL') desc, created_at limit 1;

  for v_line in
    select item.id as order_item_id, item.product_id, item.variant_id, item.quantity,
           product.cost_amount, variant.cost_override, product.stock as product_stock,
           variant.stock as variant_stock
    from public.commerce_order_items item
    join public.commerce_products product on product.id = item.product_id
    left join public.commerce_product_variants variant on variant.id = item.variant_id
    where item.order_id = p_order_id and item.product_type = 'physical'
    order by item.product_id, item.variant_id nulls first
  loop
    v_index := v_index + 1;
    v_stock := coalesce(v_line.variant_stock, v_line.product_stock, 0);
    insert into public.commerce_inventory_movements(
      spot_id, location_id, listing_id, listing_variant_id, movement_type,
      quantity_delta, stock_after, unit_cost, currency, order_id, order_item_id,
      reference, idempotency_key, actor_id, metadata
    ) values (
      v_order.spot_id, v_location.id, v_line.product_id, v_line.variant_id, 'refund',
      v_line.quantity, v_stock, coalesce(v_line.cost_override, v_line.cost_amount),
      v_order.currency, p_order_id, v_line.order_item_id,
      'payment-refund', p_idempotency_key || ':stock:' || v_index, p_actor_id,
      jsonb_build_object('external_payment_id', p_external_payment_id)
    ) on conflict (idempotency_key) do nothing;
  end loop;

  return jsonb_build_object('payment', to_jsonb(v_refund_payment), 'ledger', to_jsonb(v_refund_ledger), 'duplicate', false);
end;
$$;

-- RLS: exposed tables are always protected. Public storefront only needs the
-- active Spot/catalog identity; operational and financial rows stay manager-only.
alter table public.commerce_spots enable row level security;
alter table public.commerce_catalog_products enable row level security;
alter table public.commerce_catalog_variants enable row level security;
alter table public.commerce_product_identifiers enable row level security;
alter table public.commerce_listing_components enable row level security;
alter table public.commerce_inventory_locations enable row level security;
alter table public.commerce_inventory_movements enable row level security;
alter table public.commerce_fx_rates enable row level security;
alter table public.commerce_payments enable row level security;
alter table public.commerce_flow_accounts enable row level security;
alter table public.commerce_flow_ledger enable row level security;
alter table public.commerce_financial_goals enable row level security;

create policy commerce_spots_select_public_or_manager on public.commerce_spots
  for select to anon, authenticated
  using (
    (status = 'active' and public_enabled = true)
    or (select public.can_manage_studio(studio_id, auth.uid()))
  );
create policy commerce_spots_manage on public.commerce_spots
  for all to authenticated
  using ((select public.can_manage_studio(studio_id, auth.uid())))
  with check ((select public.can_manage_studio(studio_id, auth.uid())));

create policy commerce_catalog_products_select_active on public.commerce_catalog_products
  for select to anon, authenticated using (status = 'active' or created_by = (select auth.uid()));
create policy commerce_catalog_products_admin_write on public.commerce_catalog_products
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create policy commerce_catalog_variants_select_active on public.commerce_catalog_variants
  for select to anon, authenticated
  using (exists (
    select 1 from public.commerce_catalog_products p
    where p.id = commerce_catalog_variants.catalog_product_id and p.status = 'active'
  ));
create policy commerce_catalog_variants_admin_write on public.commerce_catalog_variants
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create policy commerce_product_identifiers_manager_select on public.commerce_product_identifiers
  for select to authenticated
  using (
    spot_id is null
    or exists (
      select 1 from public.commerce_spots s
      where s.id = commerce_product_identifiers.spot_id
        and (select public.can_manage_studio(s.studio_id, auth.uid()))
    )
  );

create policy commerce_listing_components_public_select on public.commerce_listing_components
  for select to anon, authenticated
  using (exists (
    select 1 from public.commerce_products p
    where p.id = commerce_listing_components.bundle_listing_id and p.status = 'published'
  ));

create policy commerce_inventory_locations_manager_select on public.commerce_inventory_locations
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_inventory_locations.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

create policy commerce_inventory_movements_manager_select on public.commerce_inventory_movements
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_inventory_movements.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

create policy commerce_fx_rates_manager_select on public.commerce_fx_rates
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_fx_rates.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

create policy commerce_payments_manager_select on public.commerce_payments
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_payments.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

create policy commerce_flow_accounts_manager_select on public.commerce_flow_accounts
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_flow_accounts.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

create policy commerce_flow_ledger_manager_select on public.commerce_flow_ledger
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_flow_ledger.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

create policy commerce_financial_goals_manager_select on public.commerce_financial_goals
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_financial_goals.spot_id
      and (select public.can_manage_studio(s.studio_id, auth.uid()))
  ));

-- No client-side mutation is granted on operational/financial ledgers.
revoke all on public.commerce_product_identifiers from anon, authenticated;
grant select on public.commerce_product_identifiers to authenticated;
revoke all on public.commerce_inventory_locations from anon, authenticated;
grant select on public.commerce_inventory_locations to authenticated;
revoke all on public.commerce_inventory_movements from anon, authenticated;
grant select on public.commerce_inventory_movements to authenticated;
revoke all on public.commerce_fx_rates from anon, authenticated;
grant select on public.commerce_fx_rates to authenticated;
revoke all on public.commerce_payments from anon, authenticated;
grant select on public.commerce_payments to authenticated;
revoke all on public.commerce_flow_accounts from anon, authenticated;
grant select on public.commerce_flow_accounts to authenticated;
revoke all on public.commerce_flow_ledger from anon, authenticated;
grant select on public.commerce_flow_ledger to authenticated;
revoke all on public.commerce_financial_goals from anon, authenticated;
grant select on public.commerce_financial_goals to authenticated;

revoke all on function public.normalize_commerce_identifier(text) from public;
grant execute on function public.normalize_commerce_identifier(text) to anon, authenticated, service_role;
revoke all on function public.reject_commerce_immutable_change() from public;
revoke all on function public.resolve_commerce_identifier(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_commerce_identifier(uuid, text) to service_role;
revoke all on function public.adjust_commerce_spot_inventory(uuid, uuid, uuid, uuid, integer, text, numeric, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.adjust_commerce_spot_inventory(uuid, uuid, uuid, uuid, integer, text, numeric, text, text, text, uuid, text, jsonb) to service_role;
revoke all on function public.record_commerce_fx_rate(uuid, text, numeric, text, text, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_commerce_fx_rate(uuid, text, numeric, text, text, timestamptz, jsonb, text) to service_role;
revoke all on function public.commerce_spot_financial_summary(uuid) from public, anon, authenticated;
grant execute on function public.commerce_spot_financial_summary(uuid) to service_role;
revoke all on function public.upsert_commerce_scanned_product(uuid, text, text, jsonb, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.upsert_commerce_scanned_product(uuid, text, text, jsonb, jsonb, jsonb, uuid, text) to service_role;
revoke all on function public.expand_commerce_bundle_order_items(uuid, text) from public, anon, authenticated;
grant execute on function public.expand_commerce_bundle_order_items(uuid, text) to service_role;
revoke all on function public.configure_commerce_listing_bundle(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.configure_commerce_listing_bundle(uuid, uuid, jsonb) to service_role;
revoke all on function public.record_commerce_order_stock_movements(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_commerce_order_stock_movements(uuid, uuid, text) to service_role;
revoke all on function public.record_commerce_spot_payment(uuid, uuid, text, text, text, numeric, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_commerce_spot_payment(uuid, uuid, text, text, text, numeric, uuid, uuid, text, jsonb) to service_role;
revoke all on function public.complete_commerce_pos_sale(uuid, jsonb, text, text, text, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_commerce_pos_sale(uuid, jsonb, text, text, text, uuid, uuid, uuid, text) to service_role;
revoke all on function public.record_commerce_spot_refund(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_commerce_spot_refund(uuid, text, uuid, text) to service_role;

grant select on public.commerce_spots to anon, authenticated;
grant select on public.commerce_catalog_products to anon, authenticated;
grant select on public.commerce_catalog_variants to anon, authenticated;
grant select on public.commerce_listing_components to anon, authenticated;

commit;
