-- Store core tables for CLOUVA
alter type app_role add value if not exists 'customer';

alter table profiles add column if not exists email text unique;
alter table profiles add column if not exists full_name text;
alter table profiles alter column role set default 'customer';

alter table products add column if not exists category text default 'Drop';
alter table products add column if not exists description text;
alter table products add column if not exists image_url text;
alter table products add column if not exists created_at timestamptz default now();
alter table products add column if not exists updated_at timestamptz default now();
alter table products rename column price_cents to price;

alter table orders add column if not exists user_id uuid references profiles(id);
alter table orders add column if not exists status text default 'pending';
alter table orders add column if not exists total int default 0;
alter table orders add column if not exists created_at timestamptz default now();

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity int not null default 1,
  created_at timestamptz default now(),
  unique(user_id, product_id)
);

create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, product_id)
);

alter table cart_items enable row level security;
alter table profiles enable row level security;
alter table orders enable row level security;

create policy if not exists "users read own profile" on profiles for select using (id = auth.uid());
create policy if not exists "users update own profile" on profiles for update using (id = auth.uid());
create policy if not exists "users manage own cart" on cart_items for all using (user_id = auth.uid());
create policy if not exists "users read own orders" on orders for select using (user_id = auth.uid());
create policy if not exists "admin read all orders" on orders for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.role='admin'));
