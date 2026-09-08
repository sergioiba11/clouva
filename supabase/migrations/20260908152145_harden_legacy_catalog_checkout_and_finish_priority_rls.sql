-- Fix a legacy customer policy whose name said authenticated but role was PUBLIC and USING(true).
-- Preserve anonymous customer creation while restricting management to authenticated users.
alter policy "authenticated manage customers" on public.customers to authenticated;
alter policy "public create customers" on public.customers to anon;

-- Anonymous checkout creation remains supported; authenticated users already have the manage policies.
alter policy "public create order items" on public.order_items to anon;
alter policy "public create orders" on public.orders to anon;

-- Public/catalog SELECT policies already cover authenticated readers. Remove SELECT from broad manage policies.
do $$
declare
  rec record;
  check_expr text;
begin
  for rec in
    select schemaname,tablename,policyname,qual,with_check
    from pg_policies
    where schemaname='public' and cmd='ALL'
      and policyname = any(array[
        'Admin manages avatar items',
        'authenticated manage banners',
        'authenticated manage categories',
        'authenticated manage product images',
        'authenticated manage product variants',
        'authenticated manage products',
        'authenticated manage shipping methods',
        'service_orders_admin_write',
        'studio_membership_plans_admin_write',
        'studio_memberships_admin_write',
        'studio_services_admin_write',
        'studio_subscribers_admin_write'
      ])
  loop
    check_expr := coalesce(rec.with_check,rec.qual,'false');
    execute format('drop policy %I on %I.%I',rec.policyname,rec.schemaname,rec.tablename);
    execute format('create policy %I on %I.%I for insert to authenticated with check (%s)',rec.policyname||'_insert',rec.schemaname,rec.tablename,check_expr);
    execute format('create policy %I on %I.%I for update to authenticated using (%s) with check (%s)',rec.policyname||'_update',rec.schemaname,rec.tablename,coalesce(rec.qual,'false'),check_expr);
    execute format('create policy %I on %I.%I for delete to authenticated using (%s)',rec.policyname||'_delete',rec.schemaname,rec.tablename,coalesce(rec.qual,'false'));
  end loop;
end
$$;

-- Music connections: one SELECT policy per role, preserving public published rows + manager private rows.
do $$
declare
  tbl text;
  manage_name text;
  manager_name text;
  public_name text;
  manage_qual text;
  manage_check text;
  public_qual text;
begin
  foreach tbl in array array['external_music_tracks','player_music_connections'] loop
    manage_name := tbl || '_manage';
    manager_name := tbl || '_manager_read';
    public_name := tbl || '_public_read';
    select qual,with_check into manage_qual,manage_check from pg_policies where schemaname='public' and tablename=tbl and policyname=manage_name;
    select qual into public_qual from pg_policies where schemaname='public' and tablename=tbl and policyname=public_name;

    execute format('drop policy %I on public.%I',manager_name,tbl);
    execute format('alter policy %I on public.%I to anon',public_name,tbl);
    execute format('drop policy %I on public.%I',manage_name,tbl);
    execute format('create policy %I on public.%I for select to authenticated using ((%s) or (%s))',manager_name,tbl,manage_qual,public_qual);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',manage_name||'_insert',tbl,coalesce(manage_check,manage_qual,'false'));
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',manage_name||'_update',tbl,manage_qual,coalesce(manage_check,manage_qual,'false'));
    execute format('create policy %I on public.%I for delete to authenticated using (%s)',manage_name||'_delete',tbl,manage_qual);
  end loop;
end
$$;

-- Spot team: preserve the exact former SELECT union by adding team managers to the read policy, then split writes.
alter policy commerce_spot_members_select_accessible
on public.commerce_spot_members
to authenticated
using (
  user_id = (select auth.uid())
  or public.commerce_spot_can(spot_id,(select auth.uid()),'settings'::text)
  or public.commerce_spot_can(spot_id,(select auth.uid()),'team'::text)
);
drop policy if exists commerce_spot_members_manage_team on public.commerce_spot_members;
create policy commerce_spot_members_manage_team_insert on public.commerce_spot_members for insert to authenticated
with check (public.commerce_spot_can(spot_id,(select auth.uid()),'team'::text));
create policy commerce_spot_members_manage_team_update on public.commerce_spot_members for update to authenticated
using (public.commerce_spot_can(spot_id,(select auth.uid()),'team'::text))
with check (public.commerce_spot_can(spot_id,(select auth.uid()),'team'::text));
create policy commerce_spot_members_manage_team_delete on public.commerce_spot_members for delete to authenticated
using (public.commerce_spot_can(spot_id,(select auth.uid()),'team'::text));

-- Studio applications: combine the two permissive UPDATE policies as the exact OR of their prior semantics.
drop policy if exists studio_applications_manager_update on public.studio_applications;
drop policy if exists studio_applications_self_draft_update on public.studio_applications;
create policy studio_applications_manager_or_self_update
on public.studio_applications for update to authenticated
using (
  public.can_manage_studio(studio_id)
  or (user_id=(select auth.uid()) and status=any(array['draft'::text,'submitted'::text]))
)
with check (
  public.can_manage_studio(studio_id)
  or (user_id=(select auth.uid()) and status=any(array['draft'::text,'submitted'::text,'cancelled'::text]))
);
alter policy studio_applications_authenticated_insert on public.studio_applications to authenticated;
alter policy studio_applications_self_read on public.studio_applications to authenticated;

-- Bookings: preserve admin union in SELECT/UPDATE, then keep the old admin ALL policy only as INSERT/DELETE.
do $$
declare
  admin_qual text;
  admin_check text;
  select_qual text;
  update_qual text;
  update_check text;
begin
  select qual,with_check into admin_qual,admin_check from pg_policies where schemaname='public' and tablename='bookings' and policyname='bookings_admin_write';
  select qual into select_qual from pg_policies where schemaname='public' and tablename='bookings' and policyname='bookings_select_buyer_or_space_manager';
  select qual,with_check into update_qual,update_check from pg_policies where schemaname='public' and tablename='bookings' and policyname='bookings_update_space_manager';

  execute format('alter policy bookings_select_buyer_or_space_manager on public.bookings to authenticated using ((%s) or (%s))',select_qual,admin_qual);
  execute format('alter policy bookings_update_space_manager on public.bookings to authenticated using ((%s) or (%s)) with check ((%s) or (%s))',update_qual,admin_qual,coalesce(update_check,update_qual),coalesce(admin_check,admin_qual));
  drop policy bookings_admin_write on public.bookings;
  execute format('create policy bookings_admin_write_insert on public.bookings for insert to authenticated with check (%s)',coalesce(admin_check,admin_qual));
  execute format('create policy bookings_admin_write_delete on public.bookings for delete to authenticated using (%s)',admin_qual);
end
$$;