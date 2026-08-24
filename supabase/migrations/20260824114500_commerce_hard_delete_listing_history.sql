-- MI SPOT: a listing can be deleted from the live catalog without deleting
-- historical orders, inventory movements or Flow ledger snapshots.
-- Historical rows keep their denormalized sale data and simply release the
-- foreign key to the deleted live listing/variant.

begin;

alter table public.commerce_order_items
  alter column product_id drop not null;

alter table public.commerce_order_items
  drop constraint if exists commerce_order_items_product_id_fkey;

alter table public.commerce_order_items
  add constraint commerce_order_items_product_id_fkey
  foreign key (product_id) references public.commerce_products(id) on delete set null;

alter table public.commerce_inventory
  alter column product_id drop not null;

alter table public.commerce_inventory
  drop constraint if exists commerce_inventory_product_id_fkey;

alter table public.commerce_inventory
  add constraint commerce_inventory_product_id_fkey
  foreign key (product_id) references public.commerce_products(id) on delete set null;

alter table public.commerce_inventory_movements
  alter column listing_id drop not null;

alter table public.commerce_inventory_movements
  drop constraint if exists commerce_inventory_movements_listing_id_fkey;

alter table public.commerce_inventory_movements
  add constraint commerce_inventory_movements_listing_id_fkey
  foreign key (listing_id) references public.commerce_products(id) on delete set null;

alter table public.commerce_inventory_movements
  drop constraint if exists commerce_inventory_movements_listing_variant_id_fkey;

alter table public.commerce_inventory_movements
  add constraint commerce_inventory_movements_listing_variant_id_fkey
  foreign key (listing_variant_id) references public.commerce_product_variants(id) on delete set null;

alter table public.commerce_flow_ledger
  drop constraint if exists commerce_flow_ledger_listing_id_fkey;

alter table public.commerce_flow_ledger
  add constraint commerce_flow_ledger_listing_id_fkey
  foreign key (listing_id) references public.commerce_products(id) on delete set null;

create or replace function public.hard_delete_commerce_listing(
  p_spot_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog_product_id uuid;
  v_deleted_id uuid;
begin
  select catalog_product_id
    into v_catalog_product_id
  from public.commerce_products
  where id = p_listing_id
    and spot_id = p_spot_id
  for update;

  if not found then
    raise exception 'El producto no pertenece a este MI SPOT.' using errcode = 'P0002';
  end if;

  -- Bundle relationships are live catalog structure, not sale history.
  delete from public.commerce_listing_components
  where bundle_listing_id = p_listing_id
     or component_listing_id = p_listing_id;

  delete from public.commerce_products
  where id = p_listing_id
    and spot_id = p_spot_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'No se pudo eliminar el producto.';
  end if;

  return jsonb_build_object(
    'listing_id', v_deleted_id,
    'catalog_product_id', v_catalog_product_id
  );
end;
$$;

revoke all on function public.hard_delete_commerce_listing(uuid, uuid) from public;
revoke all on function public.hard_delete_commerce_listing(uuid, uuid) from anon;
revoke all on function public.hard_delete_commerce_listing(uuid, uuid) from authenticated;
grant execute on function public.hard_delete_commerce_listing(uuid, uuid) to service_role;

commit;
