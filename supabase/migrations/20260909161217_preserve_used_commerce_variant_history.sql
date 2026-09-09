create or replace function public.preserve_used_commerce_variant_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.commerce_order_items oi
    where oi.variant_id = old.id
  ) then
    update public.commerce_product_variants
    set active = false,
        stock = 0,
        updated_at = now()
    where id = old.id;
    return null;
  end if;

  return old;
end;
$$;

drop trigger if exists commerce_product_variants_preserve_used_history
  on public.commerce_product_variants;

create trigger commerce_product_variants_preserve_used_history
before delete on public.commerce_product_variants
for each row
execute function public.preserve_used_commerce_variant_history();
