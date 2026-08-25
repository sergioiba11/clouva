-- Follow-up hardening for the Spot schema after the production advisor pass.
-- Keep FK paths indexed and avoid overlapping SELECT policies or per-row
-- auth.uid() initialization in the manager policies.

begin;

create index if not exists commerce_catalog_products_avatar_asset_idx
  on public.commerce_catalog_products(avatar_asset_id) where avatar_asset_id is not null;
create index if not exists commerce_catalog_products_created_by_idx
  on public.commerce_catalog_products(created_by) where created_by is not null;
create index if not exists commerce_financial_goals_created_by_idx
  on public.commerce_financial_goals(created_by) where created_by is not null;
create index if not exists commerce_flow_ledger_account_idx
  on public.commerce_flow_ledger(account_id);
create index if not exists commerce_flow_ledger_created_by_idx
  on public.commerce_flow_ledger(created_by) where created_by is not null;
create index if not exists commerce_flow_ledger_fx_rate_idx
  on public.commerce_flow_ledger(fx_rate_id);
create index if not exists commerce_flow_ledger_listing_idx
  on public.commerce_flow_ledger(listing_id) where listing_id is not null;
create index if not exists commerce_flow_ledger_reverses_idx
  on public.commerce_flow_ledger(reverses_entry_id) where reverses_entry_id is not null;
create index if not exists commerce_inventory_movements_actor_idx
  on public.commerce_inventory_movements(actor_id) where actor_id is not null;
create index if not exists commerce_inventory_movements_variant_idx
  on public.commerce_inventory_movements(listing_variant_id) where listing_variant_id is not null;
create index if not exists commerce_inventory_movements_location_idx
  on public.commerce_inventory_movements(location_id);
create index if not exists commerce_inventory_movements_order_item_idx
  on public.commerce_inventory_movements(order_item_id) where order_item_id is not null;
create index if not exists commerce_payments_confirmed_by_idx
  on public.commerce_payments(confirmed_by) where confirmed_by is not null;
create index if not exists commerce_payments_fx_rate_idx
  on public.commerce_payments(fx_rate_id) where fx_rate_id is not null;
create index if not exists commerce_product_identifiers_created_by_idx
  on public.commerce_product_identifiers(created_by) where created_by is not null;
create index if not exists commerce_spots_created_by_idx
  on public.commerce_spots(created_by) where created_by is not null;

drop policy if exists commerce_spots_select_public_or_manager on public.commerce_spots;
drop policy if exists commerce_spots_manage on public.commerce_spots;
create policy commerce_spots_select_public_or_manager on public.commerce_spots
  for select to anon, authenticated
  using (
    (status = 'active' and public_enabled = true)
    or public.can_manage_studio(studio_id, (select auth.uid()))
  );
create policy commerce_spots_insert_manager on public.commerce_spots
  for insert to authenticated
  with check (public.can_manage_studio(studio_id, (select auth.uid())));
create policy commerce_spots_update_manager on public.commerce_spots
  for update to authenticated
  using (public.can_manage_studio(studio_id, (select auth.uid())))
  with check (public.can_manage_studio(studio_id, (select auth.uid())));
create policy commerce_spots_delete_manager on public.commerce_spots
  for delete to authenticated
  using (public.can_manage_studio(studio_id, (select auth.uid())));

drop policy if exists commerce_catalog_products_admin_write on public.commerce_catalog_products;
create policy commerce_catalog_products_admin_insert on public.commerce_catalog_products
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ));
create policy commerce_catalog_products_admin_update on public.commerce_catalog_products
  for update to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ));
create policy commerce_catalog_products_admin_delete on public.commerce_catalog_products
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ));

drop policy if exists commerce_catalog_variants_admin_write on public.commerce_catalog_variants;
create policy commerce_catalog_variants_admin_insert on public.commerce_catalog_variants
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ));
create policy commerce_catalog_variants_admin_update on public.commerce_catalog_variants
  for update to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ))
  with check (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ));
create policy commerce_catalog_variants_admin_delete on public.commerce_catalog_variants
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'
  ));

drop policy if exists commerce_product_identifiers_manager_select on public.commerce_product_identifiers;
create policy commerce_product_identifiers_manager_select on public.commerce_product_identifiers
  for select to authenticated
  using (
    spot_id is null
    or exists (
      select 1 from public.commerce_spots s
      where s.id = commerce_product_identifiers.spot_id
        and public.can_manage_studio(s.studio_id, (select auth.uid()))
    )
  );

drop policy if exists commerce_inventory_locations_manager_select on public.commerce_inventory_locations;
create policy commerce_inventory_locations_manager_select on public.commerce_inventory_locations
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_inventory_locations.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

drop policy if exists commerce_inventory_movements_manager_select on public.commerce_inventory_movements;
create policy commerce_inventory_movements_manager_select on public.commerce_inventory_movements
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_inventory_movements.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

drop policy if exists commerce_fx_rates_manager_select on public.commerce_fx_rates;
create policy commerce_fx_rates_manager_select on public.commerce_fx_rates
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_fx_rates.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

drop policy if exists commerce_payments_manager_select on public.commerce_payments;
create policy commerce_payments_manager_select on public.commerce_payments
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_payments.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

drop policy if exists commerce_flow_accounts_manager_select on public.commerce_flow_accounts;
create policy commerce_flow_accounts_manager_select on public.commerce_flow_accounts
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_flow_accounts.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

drop policy if exists commerce_flow_ledger_manager_select on public.commerce_flow_ledger;
create policy commerce_flow_ledger_manager_select on public.commerce_flow_ledger
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_flow_ledger.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

drop policy if exists commerce_financial_goals_manager_select on public.commerce_financial_goals;
create policy commerce_financial_goals_manager_select on public.commerce_financial_goals
  for select to authenticated
  using (exists (
    select 1 from public.commerce_spots s
    where s.id = commerce_financial_goals.spot_id
      and public.can_manage_studio(s.studio_id, (select auth.uid()))
  ));

commit;
