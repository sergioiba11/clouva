-- Normalize repeated legacy order lines after the one-time import, preserve all
-- source links, restore the canonical unique index and lock compatibility
-- metadata behind admin RLS.

begin;

drop trigger if exists commerce_legacy_variant_sku_preflight on public.commerce_product_variants;
drop function if exists public.prepare_legacy_commerce_variant_sku();

alter table public.commerce_legacy_links
  drop constraint if exists commerce_legacy_links_commerce_entity_type_commerce_id_key;

create temporary table commerce_legacy_item_merge on commit drop as
select
  order_id,
  product_id,
  coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid) as variant_key,
  (array_agg(id order by id))[1] as keeper_id,
  array_agg(id order by id) as item_ids,
  sum(quantity)::integer as merged_quantity,
  sum(total)::numeric(10,2) as merged_total
from public.commerce_order_items
group by order_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
having count(*) > 1;

update public.commerce_order_items item
set quantity = merged.merged_quantity,
    total = merged.merged_total,
    unit_price = case
      when merged.merged_quantity > 0 then round(merged.merged_total / merged.merged_quantity, 2)
      else item.unit_price
    end,
    metadata = item.metadata || jsonb_build_object('legacy_merged_order_item_ids', merged.item_ids)
from commerce_legacy_item_merge merged
where item.id = merged.keeper_id;

update public.commerce_legacy_links link
set commerce_id = merged.keeper_id,
    metadata = link.metadata || jsonb_build_object('merged_into_commerce_order_item_id', merged.keeper_id)
from commerce_legacy_item_merge merged
where link.commerce_entity_type = 'commerce_order_item'
  and link.commerce_id = any(merged.item_ids);

delete from public.commerce_order_items item
using commerce_legacy_item_merge merged
where item.id = any(merged.item_ids)
  and item.id <> merged.keeper_id;

create unique index if not exists commerce_order_items_order_product_variant_unique
  on public.commerce_order_items(
    order_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.commerce_legacy_links enable row level security;
alter table public.commerce_legacy_import_issues enable row level security;

drop policy if exists commerce_legacy_links_admin_select on public.commerce_legacy_links;
create policy commerce_legacy_links_admin_select
  on public.commerce_legacy_links for select
  using (exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ));

drop policy if exists commerce_legacy_issues_admin_select on public.commerce_legacy_import_issues;
create policy commerce_legacy_issues_admin_select
  on public.commerce_legacy_import_issues for select
  using (exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ));

revoke all on public.commerce_legacy_compatibility_status from anon, authenticated;
grant select on public.commerce_legacy_compatibility_status to service_role;

commit;
