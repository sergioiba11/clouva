create table if not exists public.flow_country_rules (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  buy_enabled boolean not null default false,
  transfer_in_enabled boolean not null default false,
  transfer_out_enabled boolean not null default false,
  redemption_enabled boolean not null default false,
  supported_currencies text[] not null default '{}'::text[],
  compliance_level text not null default 'standard',
  min_flow integer check (min_flow is null or min_flow > 0),
  max_flow integer check (max_flow is null or max_flow > 0),
  metadata jsonb not null default '{}'::jsonb,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_flow is null or min_flow is null or max_flow >= min_flow)
);

create table if not exists public.flow_payment_rails (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  direction text not null check (direction in ('payin','payout')),
  country_code text not null references public.flow_country_rules(country_code) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null,
  merchant_account_key text not null default 'default',
  enabled boolean not null default false,
  priority integer not null default 100 check (priority >= 0),
  min_reference_usd numeric check (min_reference_usd is null or min_reference_usd > 0),
  max_reference_usd numeric check (max_reference_usd is null or max_reference_usd > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,direction,country_code,currency,payment_method,merchant_account_key),
  check (max_reference_usd is null or min_reference_usd is null or max_reference_usd >= min_reference_usd)
);

create index if not exists flow_payment_rails_selection_idx on public.flow_payment_rails(direction,country_code,currency,enabled,priority);

alter table public.flow_country_rules enable row level security;
alter table public.flow_payment_rails enable row level security;
revoke all on table public.flow_country_rules from public, anon, authenticated;
revoke all on table public.flow_payment_rails from public, anon, authenticated;
grant all on table public.flow_country_rules to service_role;
grant all on table public.flow_payment_rails to service_role;

insert into public.flow_country_rules(country_code,buy_enabled,transfer_in_enabled,transfer_out_enabled,redemption_enabled,supported_currencies,compliance_level,min_flow,max_flow,metadata,enabled_at)
values
  ('AR',true,true,true,false,array['ARS'],'standard',1,50,jsonb_build_object('reason','current_mercadopago_payin_only'),now()),
  ('CL',false,true,true,false,array['CLP'],'enhanced',1,50,jsonb_build_object('reason','provider_credentials_required'),null)
on conflict(country_code) do update set supported_currencies=excluded.supported_currencies,updated_at=now();

insert into public.flow_payment_rails(provider,direction,country_code,currency,payment_method,merchant_account_key,enabled,priority,metadata)
values
  ('mercadopago','payin','AR','ARS','checkout_pro','default',true,10,jsonb_build_object('existingIntegration',true)),
  ('dlocal','payin','CL','CLP','redirect','default',false,10,jsonb_build_object('methods',jsonb_build_array('CARD','WP','IO','MY','SP'),'requiresCredentials',true)),
  ('dlocal','payout','AR','ARS','bank_transfer','default',false,10,jsonb_build_object('destinations',jsonb_build_array('CBU','CVU','ALIAS'),'requiresCredentials',true)),
  ('dlocal','payout','CL','CLP','bank_transfer','default',false,10,jsonb_build_object('requiresCredentials',true))
on conflict(provider,direction,country_code,currency,payment_method,merchant_account_key) do nothing;
