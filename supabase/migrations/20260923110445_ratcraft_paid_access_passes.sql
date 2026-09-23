create table public.ratcraft_access_passes (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  user_id uuid references auth.users(id) on delete set null,
  minecraft_name text not null,
  edition text not null check (edition in ('java','bedrock')),
  amount numeric(12,2) not null default 30000,
  currency text not null default 'ARS' check (currency = 'ARS'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','refunded')),
  whitelist_status text not null default 'pending' check (whitelist_status in ('pending','queued','active','failed','removed')),
  external_reference uuid not null default gen_random_uuid() unique,
  external_payment_id text unique,
  payer_email text,
  paid_at timestamptz,
  whitelist_queued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ratcraft_access_passes_name_format check (minecraft_name ~ '^[A-Za-z0-9_.-]{1,32}$')
);

create index ratcraft_access_passes_name_idx on public.ratcraft_access_passes (lower(minecraft_name));
create index ratcraft_access_passes_status_idx on public.ratcraft_access_passes (status, created_at desc);
create unique index ratcraft_access_passes_active_name_uidx
  on public.ratcraft_access_passes (lower(minecraft_name))
  where status = 'approved';

alter table public.ratcraft_access_passes enable row level security;

revoke all on table public.ratcraft_access_passes from anon, authenticated;
grant select, insert, update, delete on table public.ratcraft_access_passes to service_role;
