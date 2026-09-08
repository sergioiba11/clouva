-- Split priority ALL write policies into command-specific policies.
-- Their existing SELECT policies already cover every authorized writer, so this removes redundant SELECT evaluation.
-- Restrict client writes to authenticated; service_role continues to bypass RLS.

do $$
declare
  r record;
  insert_check text;
  update_check text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
      and policyname = any(array[
        'player_media_authorized_write',
        'player_members_admin_write',
        'player_profile_versions_admin_write',
        'commerce_inventory_admin_write',
        'commerce_order_items_admin_write',
        'commerce_orders_admin_write',
        'commerce_products_write_owner_or_admin',
        'commerce_product_variants_write_owner_or_admin',
        'commerce_shipments_write_seller_or_admin',
        'commerce_shipping_methods_write_owner_or_admin'
      ])
  loop
    insert_check := coalesce(r.with_check, r.qual, 'false');
    update_check := coalesce(r.with_check, r.qual, 'false');

    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    execute format(
      'create policy %I on %I.%I for insert to authenticated with check (%s)',
      r.policyname || '_insert', r.schemaname, r.tablename, insert_check
    );

    execute format(
      'create policy %I on %I.%I for update to authenticated using (%s) with check (%s)',
      r.policyname || '_update', r.schemaname, r.tablename, coalesce(r.qual, 'false'), update_check
    );

    execute format(
      'create policy %I on %I.%I for delete to authenticated using (%s)',
      r.policyname || '_delete', r.schemaname, r.tablename, coalesce(r.qual, 'false')
    );
  end loop;
end
$$;