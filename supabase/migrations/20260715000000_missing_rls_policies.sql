-- customers: hoy tiene RLS activado sin ninguna política, por eso el
-- checkout (que hace upsert directo desde el navegador) falla siempre.
-- Mismo patrón ya usado en orders/order_items: público puede crear,
-- autenticado puede gestionar.
drop policy if exists "public create customers" on public.customers;
create policy "public create customers"
  on public.customers for insert
  with check (true);

drop policy if exists "authenticated manage customers" on public.customers;
create policy "authenticated manage customers"
  on public.customers for all
  using (true)
  with check (true);

-- product_variants: mismo patrón que products (lectura pública, gestión autenticada)
drop policy if exists "public read product variants" on public.product_variants;
create policy "public read product variants"
  on public.product_variants for select
  using (true);

drop policy if exists "authenticated manage product variants" on public.product_variants;
create policy "authenticated manage product variants"
  on public.product_variants for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- shipping_methods: necesita lectura pública para el checkout de invitados
drop policy if exists "public read shipping methods" on public.shipping_methods;
create policy "public read shipping methods"
  on public.shipping_methods for select
  using (true);

drop policy if exists "authenticated manage shipping methods" on public.shipping_methods;
create policy "authenticated manage shipping methods"
  on public.shipping_methods for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- payment_events: no se usa todavía en el código, pero si son logs de
-- webhooks de pago, no deben ser públicos. Solo gestión autenticada.
drop policy if exists "authenticated manage payment events" on public.payment_events;
create policy "authenticated manage payment events"
  on public.payment_events for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
