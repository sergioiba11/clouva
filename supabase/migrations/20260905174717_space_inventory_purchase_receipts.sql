create table public.space_inventory_purchases (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  merchant_name text not null check (btrim(merchant_name) <> ''),
  merchant_location text,
  external_reference text,
  payment_method text not null check (payment_method = any (array['qr'::text,'cash'::text,'transfer'::text,'debit_card'::text,'credit_card'::text,'other'::text])),
  payment_provider text,
  provider_payment_id text,
  amount numeric not null check (amount > 0),
  currency text not null default 'ARS'::text check (char_length(currency) = 3),
  status text not null default 'confirmed'::text check (status = any (array['pending'::text,'confirmed'::text,'cancelled'::text,'refunded'::text])),
  paid_at timestamptz not null default now(),
  receipt_number text not null unique,
  source_receipt_url text,
  fiscal_document boolean not null default false,
  recipient_email text,
  email_status text not null default 'pending'::text check (email_status = any (array['pending'::text,'sent'::text,'failed'::text,'skipped'::text])),
  email_provider_id text,
  email_sent_at timestamptz,
  email_last_error text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_by_player_id uuid references public.players(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index space_inventory_purchases_provider_payment_uidx
  on public.space_inventory_purchases(payment_provider, provider_payment_id)
  where payment_provider is not null and provider_payment_id is not null;

create index space_inventory_purchases_space_paid_idx
  on public.space_inventory_purchases(space_id, paid_at desc);

alter table public.space_inventory_purchase_requests
  add column purchase_id uuid references public.space_inventory_purchases(id) on delete set null;

create index space_inventory_purchase_requests_purchase_idx
  on public.space_inventory_purchase_requests(purchase_id)
  where purchase_id is not null;

alter table public.space_inventory_purchases enable row level security;

create policy space_inventory_purchases_member_select
  on public.space_inventory_purchases
  for select
  to authenticated
  using (public.space_role_for_current_user(space_id) is not null);

comment on table public.space_inventory_purchases is 'Canonical Space-level record for one real inventory/business purchase and its internal CLOUVA receipt. This is not a financial ledger or a fiscal invoice.';
comment on column public.space_inventory_purchases.fiscal_document is 'False for CLOUVA internal purchase receipts; supplier fiscal documents are stored separately via source_receipt_url/metadata.';
