-- Seller-owned delivery methods. Checkout resolves the selected method on the
-- server and snapshots it into the shipment; carrier integrations plug into
-- adapter_key without changing orders, products or the checkout contract.

begin;

create table if not exists public.commerce_shipping_methods (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('player', 'studio', 'clouva')),
  player_id uuid references public.players(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  delivery_method text not null check (delivery_method in ('shipping', 'pickup')),
  carrier text,
  pricing_type text not null default 'flat' check (pricing_type in ('flat', 'free', 'adapter')),
  flat_price numeric(10,2) check (flat_price is null or flat_price >= 0),
  currency text not null default 'ARS',
  adapter_key text,
  active boolean not null default true,
  sort_order integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_shipping_methods_owner_shape check (
    (owner_type = 'player' and player_id is not null and studio_id is null)
    or (owner_type = 'studio' and studio_id is not null and player_id is null)
    or (owner_type = 'clouva' and player_id is null and studio_id is null)
  ),
  constraint commerce_shipping_methods_pricing_shape check (
    (pricing_type = 'flat' and flat_price is not null)
    or (pricing_type = 'free' and coalesce(flat_price, 0) = 0)
    or (pricing_type = 'adapter' and adapter_key is not null)
  )
);

create unique index if not exists commerce_shipping_methods_owner_code_unique
  on public.commerce_shipping_methods(
    owner_type,
    coalesce(player_id, studio_id, '00000000-0000-0000-0000-000000000000'::uuid),
    code
  );
create index if not exists commerce_shipping_methods_active_idx
  on public.commerce_shipping_methods(owner_type, active, sort_order)
  where active = true;

alter table public.commerce_shipments
  add column if not exists shipping_method_id uuid,
  add column if not exists shipping_method_snapshot jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_shipments_shipping_method_id_fkey'
      and conrelid = 'public.commerce_shipments'::regclass
  ) then
    alter table public.commerce_shipments
      add constraint commerce_shipments_shipping_method_id_fkey
      foreign key (shipping_method_id)
      references public.commerce_shipping_methods(id)
      on delete set null;
  end if;
end
$$;

create index if not exists commerce_shipments_shipping_method_idx
  on public.commerce_shipments(shipping_method_id)
  where shipping_method_id is not null;

drop trigger if exists commerce_shipping_methods_touch_updated_at on public.commerce_shipping_methods;
create trigger commerce_shipping_methods_touch_updated_at
  before update on public.commerce_shipping_methods
  for each row execute function public.touch_commerce_updated_at();

alter table public.commerce_shipping_methods enable row level security;

drop policy if exists commerce_shipping_methods_select_active_or_owner on public.commerce_shipping_methods;
create policy commerce_shipping_methods_select_active_or_owner
  on public.commerce_shipping_methods for select
  using (
    active = true
    or created_by = auth.uid()
    or (owner_type = 'player' and exists (
      select 1 from public.players p
      where p.id = commerce_shipping_methods.player_id and p.owner_user_id = auth.uid()
    ))
    or (owner_type = 'player' and exists (
      select 1 from public.player_members pm
      where pm.player_id = commerce_shipping_methods.player_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studio_members sm
      where sm.studio_id = commerce_shipping_methods.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studios s
      where s.id = commerce_shipping_methods.studio_id and s.owner_id = auth.uid()
    ))
    or exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

drop policy if exists commerce_shipping_methods_write_owner_or_admin on public.commerce_shipping_methods;
create policy commerce_shipping_methods_write_owner_or_admin
  on public.commerce_shipping_methods for all
  using (
    (owner_type = 'player' and exists (
      select 1 from public.players p
      where p.id = commerce_shipping_methods.player_id and p.owner_user_id = auth.uid()
    ))
    or (owner_type = 'player' and exists (
      select 1 from public.player_members pm
      where pm.player_id = commerce_shipping_methods.player_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studio_members sm
      where sm.studio_id = commerce_shipping_methods.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studios s
      where s.id = commerce_shipping_methods.studio_id and s.owner_id = auth.uid()
    ))
    or exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  )
  with check (
    (owner_type = 'player' and exists (
      select 1 from public.players p
      where p.id = commerce_shipping_methods.player_id and p.owner_user_id = auth.uid()
    ))
    or (owner_type = 'player' and exists (
      select 1 from public.player_members pm
      where pm.player_id = commerce_shipping_methods.player_id
        and pm.user_id = auth.uid()
        and pm.status = 'active'
        and pm.role in ('owner', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studio_members sm
      where sm.studio_id = commerce_shipping_methods.studio_id
        and sm.profile_id = auth.uid()
        and sm.status = 'active'
        and sm.role in ('owner', 'admin', 'manager', 'editor')
    ))
    or (owner_type = 'studio' and exists (
      select 1 from public.studios s
      where s.id = commerce_shipping_methods.studio_id and s.owner_id = auth.uid()
    ))
    or exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.role = 'admin'
    )
  );

commit;
