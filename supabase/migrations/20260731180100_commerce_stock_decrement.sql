-- Stock is only ever decremented on confirmed payment (webhook), never at
-- checkout time -- an abandoned/failed checkout must not lock stock away.
-- SECURITY DEFINER + service-role-only execute, same lockdown pattern as
-- every other money-adjacent function in this schema.
create or replace function public.decrement_commerce_product_stock(p_product_id uuid, p_quantity integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.commerce_products
  set
    stock = greatest(0, stock - p_quantity),
    status = case when status = 'published' and stock - p_quantity <= 0 then 'sold_out' else status end
  where id = p_product_id and stock is not null;
end;
$$;

revoke all on function public.decrement_commerce_product_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.decrement_commerce_product_stock(uuid, integer) to service_role;
