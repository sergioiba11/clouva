-- Canonical physical-commerce foundation for CLOUVA commerce_*.
-- Keeps the legacy store untouched while adding variant-level stock,
-- fulfillment, shipment and event primitives to the multi-seller engine.

begin;

create table if not exists public.commerce_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  sku text,
  title text,
  size text,
  color text,
  price_override numeric(10,2) check (price_override is null or price_override >= 0),
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  weight_grams integer check (weight_grams is null or weight_grams >= 0),
  length_cm numeric(10,2) check (length_cm is null or length_cm >= 0),
  width_cm numeric(10,2) check (width_cm is null or width_cm >= 0),
  height_cm numeric(10,2) check (height_cm is null or height_cm >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_product_variants_product_idx
  on public.commerce_product_variants(product_id);
create index if not exists commerce_product_variants_available_idx
  on public.commerce_product_variants(product_id, active)
  where active = true and stock > 0;
create unique index if not exists commerce_product_variants_sku_unique
  on public.commerce_product_variants(sku)
  where sku is not null and btrim(sku) <> '';

create table if not exists public.commerce_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  shipment_group text not null default 'primary',
  recipient_name text,
  recipient_phone text,
  recipient_email text,
  address_line_1 text,
  address_line_2 text,
  city text,
  province text,
  postal_code text,
  country text not null default 'AR',
  delivery_method text not null default 'shipping',
  carrier text,
  shipping_cost numeric(10,2) not null default 0 check (shipping_cost >= 0),
  status text not null default 'pending',
  tracking_number text,
  tracking_url text,
  label_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_shipments_delivery_method_check
    check (delivery_method in ('shipping', 'pickup')),
  constraint commerce_shipments_status_check
    check (status in ('pending', 'preparing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'returned')),
  constraint commerce_shipments_order_group_unique unique (order_id, shipment_group)
);

create index if not exists commerce_shipments_order_idx
  on public.commerce_shipments(order_id);
create index if not exists commerce_shipments_status_idx
  on public.commerce_shipments(status, created_at desc);
create index if not exists commerce_shipments_tracking_idx
  on public.commerce_shipments(tracking_number)
  where tracking_number is not null;

create table if not exists public.commerce_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  event_type text not null,
  note text,
  actor_type text not null default 'system',
  actor_id uuid references auth.users(id) on delete set null,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commerce_order_events_actor_type_check
    check (actor_type in ('system', 'buyer', 'seller', 'admin', 'provider'))
);

create index if not exists commerce_order_events_order_idx
  on public.commerce_order_events(order_id, created_at desc);
create unique index if not exists commerce_order_events_dedupe_unique
  on public.commerce_order_events(dedupe_key)
  where dedupe_key is not null;

alter table public.commerce_order_items
  add column if not exists variant_id uuid,
  add column if not exists sku_snapshot text,
  add column if not exists variant_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_claimed_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text;

alter table public.commerce_orders
  add column if not exists shipping_subtotal numeric(10,2) not null default 0,
  add column if not exists checkout_token uuid not null default gen_random_uuid(),
  add column if not exists fulfillment_status text not null default 'pending',
  add column if not exists refunded_at timestamptz,
  add column if not exists stock_committed_at timestamptz,
  add column if not exists stock_restored_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_order_items_variant_id_fkey'
      and conrelid = 'public.commerce_order_items'::regclass
  ) then
    alter table public.commerce_order_items
      add constraint commerce_order_items_variant_id_fkey
      foreign key (variant_id)
      references public.commerce_product_variants(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_order_items_delivery_status_check'
      and conrelid = 'public.commerce_order_items'::regclass
  ) then
    alter table public.commerce_order_items
      add constraint commerce_order_items_delivery_status_check
      check (delivery_status in ('pending', 'processing', 'delivered', 'failed', 'not_applicable'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_orders_shipping_subtotal_check'
      and conrelid = 'public.commerce_orders'::regclass
  ) then
    alter table public.commerce_orders
      add constraint commerce_orders_shipping_subtotal_check
      check (shipping_subtotal >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_orders_fulfillment_status_check'
      and conrelid = 'public.commerce_orders'::regclass
  ) then
    alter table public.commerce_orders
      add constraint commerce_orders_fulfillment_status_check
      check (fulfillment_status in (
        'pending', 'stock_conflict', 'preparing', 'ready_to_ship',
        'shipped', 'delivered', 'cancelled', 'returned', 'completed'
      ));
  end if;
end
$$;

create index if not exists commerce_order_items_variant_idx
  on public.commerce_order_items(variant_id)
  where variant_id is not null;
create index if not exists commerce_order_items_delivery_idx
  on public.commerce_order_items(order_id, delivery_status);
create unique index if not exists commerce_orders_external_reference_unique_v2
  on public.commerce_orders(external_reference)
  where external_reference is not null;
create unique index if not exists commerce_orders_external_payment_id_unique
  on public.commerce_orders(external_payment_id)
  where external_payment_id is not null;
create unique index if not exists commerce_orders_checkout_token_unique
  on public.commerce_orders(checkout_token);
create index if not exists commerce_orders_fulfillment_status_idx
  on public.commerce_orders(fulfillment_status, created_at desc);

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

drop trigger if exists commerce_product_variants_touch_updated_at on public.commerce_product_variants;
create trigger commerce_product_variants_touch_updated_at
  before update on public.commerce_product_variants
  for each row execute function public.touch_commerce_updated_at();

drop trigger if exists commerce_shipments_touch_updated_at on public.commerce_shipments;
create trigger commerce_shipments_touch_updated_at
  before update on public.commerce_shipments
  for each row execute function public.touch_commerce_updated_at();

create or replace function public.sync_commerce_product_stock_from_variants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_product_id uuid;
  previous_product_id uuid;
begin
  target_product_id := case when tg_op = 'DELETE' then old.product_id else new.product_id end;
  previous_product_id := case when tg_op = 'UPDATE' then old.product_id else null end;

  update public.commerce_products p
  set stock = coalesce((
    select sum(v.stock)
    from public.commerce_product_variants v
    where v.product_id = target_product_id
      and v.active = true
  ), 0)
  where p.id = target_product_id;

  if previous_product_id is not null and previous_product_id <> target_product_id then
    update public.commerce_products p
    set stock = coalesce((
      select sum(v.stock)
      from public.commerce_product_variants v
      where v.product_id = previous_product_id
        and v.active = true
    ), 0)
    where p.id = previous_product_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_commerce_product_stock_from_variants() from public, anon, authenticated;

drop trigger if exists commerce_product_variants_sync_stock on public.commerce_product_variants;
create trigger commerce_product_variants_sync_stock
  after insert or update of stock, active, product_id or delete
  on public.commerce_product_variants
  for each row execute function public.sync_commerce_product_stock_from_variants();

alter table public.commerce_product_variants enable row level security;
alter table public.commerce_shipments enable row level security;
alter table public.commerce_order_events enable row level security;

drop policy if exists commerce_product_variants_select_published_or_owner on public.commerce_product_variants;
create policy commerce_product_variants_select_published_or_owner
  on public.commerce_product_variants for select
  using (
    exists (
      select 1
      from public.commerce_products p
      where p.id = commerce_product_variants.product_id
        and (
          p.status = 'published'
          or p.created_by = auth.uid()
          or (p.owner_type = 'player' and exists (
            select 1 from public.players pl
            where pl.id = p.player_id and pl.owner_user_id = auth.uid()
          ))
          or (p.owner_type = 'player' and exists (
            select 1 from public.player_members pm
            where pm.player_id = p.player_id
              and pm.user_id = auth.uid()
              and pm.status = 'active'
              and pm.role in ('owner', 'manager', 'editor')
          ))
          or (p.owner_type = 'studio' and exists (
            select 1 from public.studio_members sm
            where sm.studio_id = p.studio_id
              and sm.profile_id = auth.uid()
              and sm.status = 'active'
              and sm.role in ('owner', 'admin', 'manager', 'editor')
          ))
          or (p.owner_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = p.studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  );

drop policy if exists commerce_product_variants_write_owner_or_admin on public.commerce_product_variants;
create policy commerce_product_variants_write_owner_or_admin
  on public.commerce_product_variants for all
  using (
    exists (
      select 1
      from public.commerce_products p
      where p.id = commerce_product_variants.product_id
        and (
          (p.owner_type = 'player' and exists (
            select 1 from public.players pl
            where pl.id = p.player_id and pl.owner_user_id = auth.uid()
          ))
          or (p.owner_type = 'player' and exists (
            select 1 from public.player_members pm
            where pm.player_id = p.player_id
              and pm.user_id = auth.uid()
              and pm.status = 'active'
              and pm.role in ('owner', 'manager', 'editor')
          ))
          or (p.owner_type = 'studio' and exists (
            select 1 from public.studio_members sm
            where sm.studio_id = p.studio_id
              and sm.profile_id = auth.uid()
              and sm.status = 'active'
              and sm.role in ('owner', 'admin', 'manager', 'editor')
          ))
          or (p.owner_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = p.studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.commerce_products p
      where p.id = commerce_product_variants.product_id
        and (
          (p.owner_type = 'player' and exists (
            select 1 from public.players pl
            where pl.id = p.player_id and pl.owner_user_id = auth.uid()
          ))
          or (p.owner_type = 'player' and exists (
            select 1 from public.player_members pm
            where pm.player_id = p.player_id
              and pm.user_id = auth.uid()
              and pm.status = 'active'
              and pm.role in ('owner', 'manager', 'editor')
          ))
          or (p.owner_type = 'studio' and exists (
            select 1 from public.studio_members sm
            where sm.studio_id = p.studio_id
              and sm.profile_id = auth.uid()
              and sm.status = 'active'
              and sm.role in ('owner', 'admin', 'manager', 'editor')
          ))
          or (p.owner_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = p.studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  );

drop policy if exists commerce_shipments_select_order_participants on public.commerce_shipments;
create policy commerce_shipments_select_order_participants
  on public.commerce_shipments for select
  using (
    exists (
      select 1
      from public.commerce_orders o
      where o.id = commerce_shipments.order_id
        and (
          o.buyer_id = auth.uid()
          or (o.seller_type = 'player' and exists (
            select 1 from public.players p
            where p.id = o.seller_player_id and p.owner_user_id = auth.uid()
          ))
          or (o.seller_type = 'player' and exists (
            select 1 from public.player_members pm
            where pm.player_id = o.seller_player_id
              and pm.user_id = auth.uid()
              and pm.status = 'active'
              and pm.role in ('owner', 'manager')
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studio_members sm
            where sm.studio_id = o.seller_studio_id
              and sm.profile_id = auth.uid()
              and sm.status = 'active'
              and sm.role in ('owner', 'admin', 'manager')
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = o.seller_studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  );

drop policy if exists commerce_shipments_write_seller_or_admin on public.commerce_shipments;
create policy commerce_shipments_write_seller_or_admin
  on public.commerce_shipments for all
  using (
    exists (
      select 1
      from public.commerce_orders o
      where o.id = commerce_shipments.order_id
        and (
          (o.seller_type = 'player' and exists (
            select 1 from public.players p
            where p.id = o.seller_player_id and p.owner_user_id = auth.uid()
          ))
          or (o.seller_type = 'player' and exists (
            select 1 from public.player_members pm
            where pm.player_id = o.seller_player_id
              and pm.user_id = auth.uid()
              and pm.status = 'active'
              and pm.role in ('owner', 'manager')
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studio_members sm
            where sm.studio_id = o.seller_studio_id
              and sm.profile_id = auth.uid()
              and sm.status = 'active'
              and sm.role in ('owner', 'admin', 'manager')
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = o.seller_studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.commerce_orders o
      where o.id = commerce_shipments.order_id
        and (
          (o.seller_type = 'player' and exists (
            select 1 from public.players p
            where p.id = o.seller_player_id and p.owner_user_id = auth.uid()
          ))
          or (o.seller_type = 'player' and exists (
            select 1 from public.player_members pm
            where pm.player_id = o.seller_player_id
              and pm.user_id = auth.uid()
              and pm.status = 'active'
              and pm.role in ('owner', 'manager')
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studio_members sm
            where sm.studio_id = o.seller_studio_id
              and sm.profile_id = auth.uid()
              and sm.status = 'active'
              and sm.role in ('owner', 'admin', 'manager')
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = o.seller_studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  );

drop policy if exists commerce_order_events_select_order_participants on public.commerce_order_events;
create policy commerce_order_events_select_order_participants
  on public.commerce_order_events for select
  using (
    exists (
      select 1
      from public.commerce_orders o
      where o.id = commerce_order_events.order_id
        and (
          o.buyer_id = auth.uid()
          or (o.seller_type = 'player' and exists (
            select 1 from public.players p
            where p.id = o.seller_player_id and p.owner_user_id = auth.uid()
          ))
          or (o.seller_type = 'studio' and exists (
            select 1 from public.studios s
            where s.id = o.seller_studio_id and s.owner_id = auth.uid()
          ))
          or exists (
            select 1 from public.profiles pr
            where pr.id = auth.uid() and pr.role = 'admin'
          )
        )
    )
  );

drop policy if exists commerce_order_events_admin_write on public.commerce_order_events;
create policy commerce_order_events_admin_write
  on public.commerce_order_events for all
  using (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role = 'admin'
  ));

commit;
