-- Studio commerce, phase 1: service catalog + one-time service orders +
-- studio subscriber tracking. Deliberately NOT a marketplace/split-payments
-- system yet -- per explicit user direction, every payment (VIP-via-studio
-- subscription and service-cart checkout alike) still goes to CLOUVA's own
-- Mercado Pago account, same as the existing clouva_vip billing. Real
-- per-studio payouts (Mercado Pago Connect/OAuth) are deferred until the
-- avatar work is done, same gate as the merch marketplace.

create table public.studio_services (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  description text,
  category text,
  price_type text not null default 'fixed' check (price_type in ('fixed', 'consultar')),
  price numeric(10,2),
  currency text not null default 'ARS',
  duration_minutes integer,
  cta_type text not null default 'contratar' check (cta_type in ('contratar', 'reservar', 'presupuesto')),
  image_url text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_services_price_check check (
    (price_type = 'fixed' and price is not null and price >= 0)
    or (price_type = 'consultar')
  )
);

create index studio_services_studio_idx on public.studio_services(studio_id);
create index studio_services_active_idx on public.studio_services(studio_id, is_active) where is_active = true;

-- Who subscribed (via the CLOUVA VIP purchase flow, entered from a studio's
-- public page) to which Studio. This is attribution/membership tracking,
-- not a separate payment -- the money is the same clouva_vip subscription.
create table public.studio_subscribers (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'vip_subscription',
  subscription_id uuid references public.billing_subscriptions(id),
  subscribed_at timestamptz not null default now(),
  unique (studio_id, user_id)
);

create index studio_subscribers_studio_idx on public.studio_subscribers(studio_id);
create index studio_subscribers_user_idx on public.studio_subscribers(user_id);

-- A cart of selected studio_services, checked out as one Mercado Pago
-- one-time payment (not recurring) for the summed total.
create table public.service_orders (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  total_amount numeric(10,2) not null check (total_amount >= 0),
  currency text not null default 'ARS',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  external_reference text unique,
  external_payment_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index service_orders_studio_idx on public.service_orders(studio_id);
create index service_orders_user_idx on public.service_orders(user_id);
create index service_orders_payment_status_idx on public.service_orders(payment_status);

create or replace function public.touch_studio_commerce_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_studio_commerce_updated_at() from public;

create trigger studio_services_touch_updated_at
  before update on public.studio_services
  for each row execute function public.touch_studio_commerce_updated_at();

create trigger service_orders_touch_updated_at
  before update on public.service_orders
  for each row execute function public.touch_studio_commerce_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.studio_services enable row level security;

create policy studio_services_select_public_active_or_manager
  on public.studio_services for select
  using (
    is_active = true
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = studio_services.studio_id and m.profile_id = auth.uid()
        and m.status = 'active' and m.role in ('owner', 'admin', 'manager', 'editor')
    )
    or exists (select 1 from public.studios s where s.id = studio_services.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy studio_services_admin_write
  on public.studio_services for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.studio_subscribers enable row level security;

create policy studio_subscribers_select_self_or_manager
  on public.studio_subscribers for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = studio_subscribers.studio_id and m.profile_id = auth.uid()
        and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = studio_subscribers.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy studio_subscribers_admin_write
  on public.studio_subscribers for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.service_orders enable row level security;

create policy service_orders_select_self_or_manager
  on public.service_orders for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = service_orders.studio_id and m.profile_id = auth.uid()
        and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = service_orders.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy service_orders_admin_write
  on public.service_orders for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
