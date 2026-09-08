-- Consolidate exact self/admin reads.
drop policy if exists billing_payments_admin_read on public.billing_payments;
drop policy if exists billing_payments_self_read on public.billing_payments;
create policy billing_payments_self_or_admin_read
on public.billing_payments for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'::public.app_role)
);

drop policy if exists billing_subscriptions_admin_read on public.billing_subscriptions;
drop policy if exists billing_subscriptions_self_read on public.billing_subscriptions;
create policy billing_subscriptions_self_or_admin_read
on public.billing_subscriptions for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'::public.app_role)
);

-- Split ALL policies where an existing SELECT already covers the writer/admin path.
do $$
declare
  rec record;
  check_expr text;
begin
  for rec in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname='public'
      and cmd='ALL'
      and policyname = any(array[
        'brand_asset_links_admin_write',
        'brand_asset_versions_admin_write',
        'brand_assets_admin_write',
        'brand_generation_jobs_admin_write',
        'commerce_order_events_admin_write',
        'community_events_write',
        'community_projects_write',
        'follows_manage_own',
        'studio_follows_manage_own',
        'payment_methods_admin',
        'player_studios_write',
        'studio_members_write',
        'user_entitlements_admin_write',
        'vip_profile_generation_jobs_admin_write'
      ])
  loop
    check_expr := coalesce(rec.with_check, rec.qual, 'false');
    execute format('drop policy %I on %I.%I', rec.policyname, rec.schemaname, rec.tablename);
    execute format('create policy %I on %I.%I for insert to authenticated with check (%s)', rec.policyname || '_insert', rec.schemaname, rec.tablename, check_expr);
    execute format('create policy %I on %I.%I for update to authenticated using (%s) with check (%s)', rec.policyname || '_update', rec.schemaname, rec.tablename, coalesce(rec.qual,'false'), check_expr);
    execute format('create policy %I on %I.%I for delete to authenticated using (%s)', rec.policyname || '_delete', rec.schemaname, rec.tablename, coalesce(rec.qual,'false'));
  end loop;
end
$$;

-- For Vehicle, preserve the exact former SELECT union (view OR manage), then split writes.
do $$
declare
  rec record;
  write_check_expr text;
begin
  for rec in
    select pw.tablename,
           pr.policyname as read_policy,
           pw.policyname as write_policy,
           pr.qual as read_qual,
           pw.qual as write_qual,
           pw.with_check as write_check
    from pg_policies pr
    join pg_policies pw on pw.schemaname=pr.schemaname and pw.tablename=pr.tablename
    where pr.schemaname='public'
      and pr.tablename = any(array['vehicle_3d_bindings','vehicle_events','vehicle_inspection_items','vehicle_inspections','vehicle_media_links','vehicle_part_state','vehicle_repairs'])
      and pr.cmd='SELECT'
      and pw.cmd='ALL'
      and pr.policyname like '%_read'
      and pw.policyname like '%_write'
  loop
    write_check_expr := coalesce(rec.write_check, rec.write_qual, 'false');
    execute format('alter policy %I on public.%I to authenticated using ((%s) or (%s))', rec.read_policy, rec.tablename, rec.read_qual, rec.write_qual);
    execute format('drop policy %I on public.%I', rec.write_policy, rec.tablename);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', rec.write_policy || '_insert', rec.tablename, write_check_expr);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', rec.write_policy || '_update', rec.tablename, rec.write_qual, write_check_expr);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', rec.write_policy || '_delete', rec.tablename, rec.write_qual);
  end loop;
end
$$;