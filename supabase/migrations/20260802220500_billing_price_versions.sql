-- Recurring provider plans are immutable once provisioned. Keep historical
-- prices for existing subscriptions while allowing a new active price for new
-- signups. The old uniqueness rule omitted amount/version and blocked this.
alter table public.billing_prices
  add column if not exists version_number integer not null default 1;

alter table public.billing_prices
  drop constraint if exists billing_prices_product_id_provider_currency_billing_interva_key;

create unique index if not exists billing_prices_version_unique
  on public.billing_prices (
    product_id,
    provider,
    currency,
    billing_interval,
    interval_count,
    environment,
    version_number
  );

create index if not exists billing_prices_active_product_environment_idx
  on public.billing_prices(product_id, provider, environment, created_at desc)
  where is_active = true;
