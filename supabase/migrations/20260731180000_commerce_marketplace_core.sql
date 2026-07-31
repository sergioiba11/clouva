-- Marketplace core (Fase 4/5 of the monetization plan). The legacy `products`/
-- `orders`/`stores` tables from the original tienda are NOT reused -- the
-- Fase 1 audit found them already duplicated (legacy + new columns on the
-- same live table, 0 real rows) and single-tenant (no owner_type). This is a
-- clean model instead, built to plug into what's already proven: the same
-- Checkout Pro (createPreference) + webhook pattern that studio_services /
-- service_orders already uses for real money, not a parallel payment system.

create table public.commerce_products (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('player', 'studio', 'clouva')),
  player_id uuid references public.players(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  product_type text not null check (product_type in (
    'physical', 'digital', 'avatar_item', 'asset_3d', 'music', 'beat', 'ticket',
    'exclusive_content', 'bundle'
  )),
  name text not null,
  slug text not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  currency text not null default 'ARS',
  stock integer check (stock is null or stock >= 0),
  status text not null default 'draft' check (status in (
    'draft', 'pending_review', 'approved', 'published', 'paused', 'sold_out', 'archived', 'rejected'
  )),
  cover_url text,
  gallery jsonb not null default '[]'::jsonb,
  -- Never exposed by the public product select -- only the order-confirmation
  -- delivery endpoint reads this column, after checking the buyer actually
  -- has a paid commerce_order_items row for the product.
  digital_asset_url text,
  -- References the seller's own clothing_items row (an already-generated
  -- garment) when product_type = 'avatar_item'. Purchase clones it into the
  -- buyer's inventory -- it never re-runs generation or the Avatar Analyzer.
  avatar_asset_id uuid references public.clothing_items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_products_owner_shape check (
    (owner_type = 'player' and player_id is not null and studio_id is null)
    or (owner_type = 'studio' and studio_id is not null and player_id is null)
    or (owner_type = 'clouva' and player_id is null and studio_id is null)
  )
);

create index commerce_products_player_idx on public.commerce_products(player_id);
create index commerce_products_studio_idx on public.commerce_products(studio_id);
create index commerce_products_status_idx on public.commerce_products(status) where status = 'published';
-- Slug only needs to be unique within one seller's catalog, not globally.
create unique index commerce_products_owner_slug_unique
  on public.commerce_products(owner_type, coalesce(player_id, studio_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

create table public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id),
  seller_type text not null check (seller_type in ('player', 'studio', 'clouva')),
  seller_player_id uuid references public.players(id) on delete set null,
  seller_studio_id uuid references public.studios(id) on delete set null,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  fees numeric(10,2) not null default 0,
  commission numeric(10,2) not null default 0,
  total numeric(10,2) not null check (total >= 0),
  currency text not null default 'ARS',
  -- Mirrors service_orders' two-axis status exactly (fulfillment vs payment)
  -- -- same reviewed pattern, not a new vocabulary to learn.
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  external_reference text unique,
  external_payment_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  completed_at timestamptz
);

create index commerce_orders_buyer_idx on public.commerce_orders(buyer_id);
create index commerce_orders_seller_player_idx on public.commerce_orders(seller_player_id);
create index commerce_orders_seller_studio_idx on public.commerce_orders(seller_studio_id);
create index commerce_orders_payment_status_idx on public.commerce_orders(payment_status);

create table public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id),
  product_name text not null,
  product_type text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  total numeric(10,2) not null check (total >= 0),
  metadata jsonb not null default '{}'::jsonb
);

create index commerce_order_items_order_idx on public.commerce_order_items(order_id);
create index commerce_order_items_product_idx on public.commerce_order_items(product_id);

-- Purchased avatar_item clones (product_type = 'avatar_item') land here --
-- owned but not equipped, same rule as user_outfits: equipping is a
-- separate, explicit user action, never automatic on purchase.
create table public.commerce_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_item_id uuid not null references public.commerce_order_items(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id),
  clothing_item_id uuid references public.clothing_items(id) on delete set null,
  acquired_at timestamptz not null default now(),
  unique (order_item_id)
);

create index commerce_inventory_user_idx on public.commerce_inventory(user_id);

create or replace function public.touch_commerce_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_commerce_updated_at() from public;

create trigger commerce_products_touch_updated_at
  before update on public.commerce_products
  for each row execute function public.touch_commerce_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.commerce_products enable row level security;

create policy commerce_products_select_published_or_owner
  on public.commerce_products for select
  using (
    status = 'published'
    or created_by = auth.uid()
    or (owner_type = 'player' and exists (
      select 1 from public.players p where p.id = commerce_products.player_id and p.owner_user_id = auth.uid()
    ))
    or (owner_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = commerce_products.player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studio_members m
      where m.studio_id = commerce_products.studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (select 1 from public.studios s where s.id = commerce_products.studio_id and s.owner_id = auth.uid()))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy commerce_products_write_owner_or_admin
  on public.commerce_products for all
  using (
    (owner_type = 'player' and exists (
      select 1 from public.players p where p.id = commerce_products.player_id and p.owner_user_id = auth.uid()
    ))
    or (owner_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = commerce_products.player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studio_members m
      where m.studio_id = commerce_products.studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (select 1 from public.studios s where s.id = commerce_products.studio_id and s.owner_id = auth.uid()))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    (owner_type = 'player' and exists (
      select 1 from public.players p where p.id = commerce_products.player_id and p.owner_user_id = auth.uid()
    ))
    or (owner_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = commerce_products.player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studio_members m
      where m.studio_id = commerce_products.studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (select 1 from public.studios s where s.id = commerce_products.studio_id and s.owner_id = auth.uid()))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

alter table public.commerce_orders enable row level security;

create policy commerce_orders_select_buyer_seller_or_admin
  on public.commerce_orders for select
  using (
    buyer_id = auth.uid()
    or (seller_type = 'player' and exists (
      select 1 from public.players p where p.id = commerce_orders.seller_player_id and p.owner_user_id = auth.uid()
    ))
    or (seller_type = 'player' and exists (
      select 1 from public.player_members m
      where m.player_id = commerce_orders.seller_player_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'manager')
    ))
    or (seller_type = 'studio' and exists (
      select 1 from public.studio_members m
      where m.studio_id = commerce_orders.seller_studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    ))
    or (seller_type = 'studio' and exists (select 1 from public.studios s where s.id = commerce_orders.seller_studio_id and s.owner_id = auth.uid()))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- All writes (order creation, payment confirmation) happen server-side with
-- the service role -- checkout must recompute price/stock itself, never
-- trust a client-sent amount, same rule as service_orders.
create policy commerce_orders_admin_write
  on public.commerce_orders for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.commerce_order_items enable row level security;

create policy commerce_order_items_select_via_order
  on public.commerce_order_items for select
  using (
    exists (
      select 1 from public.commerce_orders o
      where o.id = commerce_order_items.order_id
        and (
          o.buyer_id = auth.uid()
          or (o.seller_type = 'player' and exists (select 1 from public.players p where p.id = o.seller_player_id and p.owner_user_id = auth.uid()))
          or (o.seller_type = 'studio' and exists (select 1 from public.studios s where s.id = o.seller_studio_id and s.owner_id = auth.uid()))
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin')
        )
    )
  );

create policy commerce_order_items_admin_write
  on public.commerce_order_items for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.commerce_inventory enable row level security;

create policy commerce_inventory_select_self_or_admin
  on public.commerce_inventory for select
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy commerce_inventory_admin_write
  on public.commerce_inventory for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
