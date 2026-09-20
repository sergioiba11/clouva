begin;

create table if not exists public.commerce_product_import_invoices (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null unique references public.commerce_product_import_batches(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  file_name text,
  source_url text not null,
  storage_path text not null,
  mime_type text not null,
  status text not null default 'analyzed'
    check (status in ('uploaded','analyzing','analyzed','review','failed')),
  supplier_name text,
  supplier_tax_id text,
  document_type text,
  document_number text,
  issued_at timestamptz,
  currency text,
  subtotal numeric(18,2),
  tax_amount numeric(18,2),
  total_amount numeric(18,2),
  metadata jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_product_import_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.commerce_product_import_invoices(id) on delete cascade,
  batch_id uuid not null references public.commerce_product_import_batches(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  description text not null,
  brand text,
  model text,
  supplier_sku text,
  barcode_value text,
  barcode_type text,
  quantity numeric(18,3) not null default 1 check (quantity > 0),
  unit_price numeric(18,2),
  tax_amount numeric(18,2),
  line_total numeric(18,2),
  matched_group_keys jsonb not null default '[]'::jsonb,
  matched_listing_ids jsonb not null default '[]'::jsonb,
  matched_quantity numeric(18,3) not null default 0 check (matched_quantity >= 0),
  match_status text not null default 'unmatched'
    check (match_status in ('matched','partial','unmatched','ambiguous')),
  checked boolean not null default false,
  checked_by uuid,
  checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invoice_id, line_number)
);

create index if not exists commerce_product_import_invoices_spot_created_idx
  on public.commerce_product_import_invoices(spot_id, created_at desc);
create index if not exists commerce_product_import_invoice_items_batch_idx
  on public.commerce_product_import_invoice_items(batch_id, line_number);
create index if not exists commerce_product_import_invoice_items_status_idx
  on public.commerce_product_import_invoice_items(batch_id, match_status, checked);

alter table public.commerce_product_import_invoices enable row level security;
alter table public.commerce_product_import_invoice_items enable row level security;

revoke all on public.commerce_product_import_invoices from anon, authenticated;
revoke all on public.commerce_product_import_invoice_items from anon, authenticated;
grant all on public.commerce_product_import_invoices to service_role;
grant all on public.commerce_product_import_invoice_items to service_role;

notify pgrst, 'reload schema';

commit;