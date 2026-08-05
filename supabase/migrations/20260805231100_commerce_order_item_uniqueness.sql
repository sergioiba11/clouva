-- One product variant is represented by one order line. Quantity carries the
-- requested units, so atomic stock validation never evaluates duplicated rows
-- independently. This also blocks a crafted checkout from splitting the same
-- finite stock across repeated lines.

create unique index if not exists commerce_order_items_order_product_variant_unique
  on public.commerce_order_items(
    order_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
