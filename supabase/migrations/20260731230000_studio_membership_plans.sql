-- Membresías propias por estudio, fase 1. Reusa el motor de billing genérico
-- (billing_products/prices/subscriptions/payments) en vez de duplicarlo:
-- billing_products gana un studio_id opcional, y cada plan pago de un estudio
-- tiene un billing_product/price propio detrás. Todo el dinero sigue yendo a
-- la misma cuenta de Mercado Pago de CLOUVA (sin split-payments todavía).
--
-- Nombrada studio_fan_memberships (no studio_members) a propósito:
-- studio_members ya existe y es el roster de staff interno (owner/admin/
-- manager/editor) -- esta es la membresía de socios/fans, un concepto
-- distinto que no debe pisar esa tabla ni su lógica de permisos.

create table public.studio_membership_plans (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  price numeric(10,2),
  currency text not null default 'ARS',
  billing_interval text check (billing_interval in ('month', 'year')),
  is_free boolean not null default false,
  is_active boolean not null default true,
  is_public boolean not null default true,
  benefits jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  billing_product_id uuid references public.billing_products(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, slug),
  constraint studio_membership_plans_price_check check (
    (is_free = true and price is null and billing_interval is null)
    or (is_free = false and price is not null and price >= 0 and billing_interval is not null)
  )
);

create index studio_membership_plans_studio_idx on public.studio_membership_plans(studio_id);
create index studio_membership_plans_public_idx on public.studio_membership_plans(studio_id, is_active, is_public) where is_active = true and is_public = true;

-- Estado actual de membresía de un usuario en un estudio -- una fila por
-- (studio_id, user_id), se actualiza in place al pasar de gratis a paga o al
-- renovar, nunca se duplica.
create table public.studio_fan_memberships (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.studio_membership_plans(id),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  source text not null default 'direct',
  referral_code text,
  subscription_id uuid references public.billing_subscriptions(id),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, user_id)
);

create index studio_fan_memberships_studio_idx on public.studio_fan_memberships(studio_id);
create index studio_fan_memberships_user_idx on public.studio_fan_memberships(user_id);
create index studio_fan_memberships_subscription_idx on public.studio_fan_memberships(subscription_id) where subscription_id is not null;

-- billing_products deja de ser exclusivamente de CLOUVA: un producto con
-- studio_id no nulo pertenece a un estudio. entitlement_tier no tiene un
-- significado real para estos (no otorgan tier global ni Flows -- ver el
-- branch en core/billing/service.ts), 'studio_member' es solo un valor
-- válido para satisfacer el check existente.
alter table public.billing_products
  add column if not exists studio_id uuid references public.studios(id) on delete cascade;

create index if not exists billing_products_studio_idx on public.billing_products(studio_id) where studio_id is not null;

alter table public.billing_products drop constraint billing_products_entitlement_tier_check;
alter table public.billing_products add constraint billing_products_entitlement_tier_check
  check (entitlement_tier in ('free', 'player', 'vip', 'studio_member'));

create trigger studio_membership_plans_touch_updated_at
  before update on public.studio_membership_plans
  for each row execute function public.touch_studio_commerce_updated_at();

create trigger studio_fan_memberships_touch_updated_at
  before update on public.studio_fan_memberships
  for each row execute function public.touch_studio_commerce_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.studio_membership_plans enable row level security;

create policy studio_membership_plans_select_public_or_manager
  on public.studio_membership_plans for select
  using (
    (is_active = true and is_public = true)
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = studio_membership_plans.studio_id and m.profile_id = auth.uid()
        and m.status = 'active' and m.role in ('owner', 'admin', 'manager', 'editor')
    )
    or exists (select 1 from public.studios s where s.id = studio_membership_plans.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Real writes (create/edit a plan as a studio manager) go through the
-- server-side API route with requireStudioManager + the service role, same
-- split as studio_services. This client-facing policy is the admin-only
-- safety net -- it also doubles as the mechanism for CLOUVA's own admin to
-- override any studio's price directly from /admin/estudios/membresias.
create policy studio_membership_plans_admin_write
  on public.studio_membership_plans for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.studio_fan_memberships enable row level security;

create policy studio_fan_memberships_select_self_or_manager
  on public.studio_fan_memberships for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = studio_fan_memberships.studio_id and m.profile_id = auth.uid()
        and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = studio_fan_memberships.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Writes (free join, paid activation via webhook) always go through
-- server-side routes using the service role -- same split as
-- studio_subscribers/service_orders.
create policy studio_fan_memberships_admin_write
  on public.studio_fan_memberships for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
