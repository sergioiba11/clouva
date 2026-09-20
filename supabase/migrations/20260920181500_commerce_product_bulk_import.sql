begin;

create table if not exists public.commerce_product_import_batches (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  created_by uuid,
  status text not null default 'uploading'
    check (status in ('uploading','analyzing','review','processing','completed','completed_with_errors','failed')),
  total_images integer not null default 0 check (total_images >= 0),
  detected_products integer not null default 0 check (detected_products >= 0),
  processed_products integer not null default 0 check (processed_products >= 0),
  failed_products integer not null default 0 check (failed_products >= 0),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_product_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.commerce_product_import_batches(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  source_index integer not null check (source_index >= 0),
  file_name text,
  source_url text not null,
  storage_path text not null,
  mime_type text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded','grouped','processing','created','error')),
  group_key text,
  listing_id uuid references public.commerce_products(id) on delete set null,
  recognition jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, source_index)
);

create index if not exists commerce_product_import_batches_spot_created_idx
  on public.commerce_product_import_batches(spot_id, created_at desc);

create index if not exists commerce_product_import_items_batch_status_idx
  on public.commerce_product_import_items(batch_id, status, source_index);

create index if not exists commerce_product_import_items_batch_group_idx
  on public.commerce_product_import_items(batch_id, group_key)
  where group_key is not null;

alter table public.commerce_product_import_batches enable row level security;
alter table public.commerce_product_import_items enable row level security;

revoke all on public.commerce_product_import_batches from anon, authenticated;
revoke all on public.commerce_product_import_items from anon, authenticated;
grant all on public.commerce_product_import_batches to service_role;
grant all on public.commerce_product_import_items to service_role;

notify pgrst, 'reload schema';

commit;
