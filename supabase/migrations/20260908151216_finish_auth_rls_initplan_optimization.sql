-- Resolve the final auth_rls_initplan warnings without changing public-read behavior.

alter policy "public read active products"
on public.products
to public
using ((active = true) or ((select auth.role()) = 'authenticated'::text));

alter policy "public read active banners"
on public.banners
to public
using ((active = true) or ((select auth.role()) = 'authenticated'::text));

-- These policies only admitted authenticated users via auth.role(); express that directly as the policy role.
alter policy "authenticated manage product variants"
on public.product_variants
to authenticated
using (true)
with check (true);

alter policy "authenticated manage shipping methods"
on public.shipping_methods
to authenticated
using (true)
with check (true);

alter policy "authenticated manage payment events"
on public.payment_events
to authenticated
using (true)
with check (true);