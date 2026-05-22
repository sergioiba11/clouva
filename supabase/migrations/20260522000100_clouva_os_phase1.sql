create type user_role as enum ('admin','employee','customer');
create type stock_movement_type as enum ('ingreso','venta','ajuste','devolucion');
create type product_status as enum ('activo','borrador','archivado','agotado');

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  color_primary text,
  color_secondary text,
  created_at timestamptz not null default now()
);

alter table profiles
  add column if not exists role_v2 user_role not null default 'customer',
  add column if not exists full_name text,
  add column if not exists phone text;

create table if not exists avatar_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  altura_cm numeric(5,2),
  peso_kg numeric(5,2),
  talle_arriba text,
  talle_abajo text,
  calzado text,
  estilo_preferido text,
  medidas_opcionales jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table products
  add column if not exists store_id uuid references stores(id),
  add column if not exists description text,
  add column if not exists cost_cents int,
  add column if not exists category text,
  add column if not exists status product_status not null default 'activo',
  add column if not exists garment_type text,
  add column if not exists model_3d_url text,
  add column if not exists texture_url text,
  add column if not exists garment_measurements jsonb not null default '{}'::jsonb;

create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  image_url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists store_employees (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  unique(store_id, profile_id)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid references product_variants(id) on delete set null,
  product_id uuid not null references products(id) on delete cascade,
  movement_type stock_movement_type not null,
  quantity int not null,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
