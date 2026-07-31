-- Real bookings for studio_services -- until now cta_type = 'reservar' was
-- just a button label with no backend behind it (Fase 1 audit finding: "no
-- hay agenda ni calendario"). Self-contained payment fields (not a second
-- FK to service_orders) so a booking is either free-to-request (price_type
-- 'consultar' -> payment_status 'not_required', studio confirms manually)
-- or paid upfront through the same Checkout Pro pattern service_orders
-- already proved (price_type 'fixed' -> payment_status 'pending' until the
-- webhook confirms it).

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.studio_services(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  buyer_id uuid not null references auth.users(id),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'completed', 'cancelled')),
  price numeric(10,2),
  currency text not null default 'ARS',
  payment_status text not null default 'not_required' check (payment_status in ('not_required', 'pending', 'paid', 'failed', 'refunded')),
  external_reference text unique,
  external_payment_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bookings_service_idx on public.bookings(service_id);
create index bookings_studio_idx on public.bookings(studio_id);
create index bookings_buyer_idx on public.bookings(buyer_id);
create index bookings_scheduled_idx on public.bookings(studio_id, scheduled_at);

create or replace function public.touch_bookings_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_bookings_updated_at() from public;

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_bookings_updated_at();

alter table public.bookings enable row level security;

create policy bookings_select_buyer_or_manager_or_admin
  on public.bookings for select
  using (
    buyer_id = auth.uid()
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = bookings.studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = bookings.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Studio managers can update status (confirm/complete/cancel) directly --
-- creation and payment-linked writes happen server-side with the service
-- role, same split as commerce_orders/service_orders.
create policy bookings_update_manager_or_admin
  on public.bookings for update
  using (
    exists (
      select 1 from public.studio_members m
      where m.studio_id = bookings.studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = bookings.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (
      select 1 from public.studio_members m
      where m.studio_id = bookings.studio_id and m.profile_id = auth.uid() and m.status = 'active' and m.role in ('owner', 'admin', 'manager')
    )
    or exists (select 1 from public.studios s where s.id = bookings.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy bookings_admin_write
  on public.bookings for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
