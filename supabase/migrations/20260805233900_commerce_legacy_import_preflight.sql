-- The legacy store allowed repeated order lines and non-unique SKUs. Temporarily
-- relax the canonical line index during import and preserve duplicate SKU text
-- in metadata instead of failing the whole migration.

begin;

drop index if exists public.commerce_order_items_order_product_variant_unique;

create or replace function public.prepare_legacy_commerce_variant_sku()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sku is not null and btrim(new.sku) <> '' and exists (
    select 1
    from public.commerce_product_variants existing
    where existing.sku = new.sku
      and existing.id <> new.id
  ) then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('legacy_original_sku', new.sku);
    new.sku := null;
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_legacy_variant_sku_preflight on public.commerce_product_variants;
create trigger commerce_legacy_variant_sku_preflight
  before insert on public.commerce_product_variants
  for each row execute function public.prepare_legacy_commerce_variant_sku();

commit;
