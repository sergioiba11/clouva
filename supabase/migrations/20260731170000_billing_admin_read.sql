-- billing_subscriptions/billing_payments (20260729213000_identity_revenue_v2.sql)
-- only got a self-read policy -- every other revenue-adjacent table in this
-- schema (service_orders, studio_services, vip_profile_generation_jobs,
-- player_profile_versions...) also has an "or admin" read clause. This was
-- the one left out, which meant no admin dashboard could ever show real VIP
-- revenue via the client-side RLS path this codebase's other admin pages use.

create policy billing_subscriptions_admin_read
  on public.billing_subscriptions for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy billing_payments_admin_read
  on public.billing_payments for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
