-- Connect the existing CLOUVA physical store to Mercado Pago Checkout Pro.
-- The current public storefront and admin keep using products/orders; this
-- migration only adds provider identifiers and makes products.stock the
-- canonical stock checked and updated by paid orders.

alter table public.orders
  add column if not exists currency text not null default 'ARS',
  add column if not exists external_reference text,
  add column if not exists external_payment_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists checkout_token uuid not null default gen_random_uuid();

create unique index if not exists orders_external_reference_unique
  on public.orders (external_reference)
  where external_reference is not null;

create unique index if not exists orders_checkout_token_unique
  on public.orders (checkout_token);

-- The public storefront and the current product admin use products.stock.
-- The older guard only checked product_variants, which made a valid product
-- created from the current admin impossible to buy unless a legacy variant
-- happened to exist as well.
create or replace function public.ensure_stock_before_order_items()
returns trigger
language plpgsql
as $$
declare
  available_stock integer;
begin
  select p.stock
    into available_stock
  from public.products p
  where p.id = new.product_id
  for update;

  if available_stock is null then
    raise exception 'Producto inexistente %', new.product_id;
  end if;

  if available_stock < new.qty then
    raise exception 'Stock insuficiente para producto %', new.product_id;
  end if;

  return new;
end
$$;

-- Stock moves only when Mercado Pago confirms the payment. A checkout that is
-- abandoned, pending or rejected never reserves stock. Refund/cancellation of
-- an already-paid order restores it once.
create or replace function public.apply_stock_on_order_state_change()
returns trigger
language plpgsql
as $$
declare
  line record;
begin
  if coalesce(old.payment_status::text, '') <> 'pagado'
     and new.payment_status::text = 'pagado' then
    for line in
      select product_id, qty
      from public.order_items
      where order_id = new.id
    loop
      update public.products
      set stock = greatest(0, stock - line.qty)
      where id = line.product_id;

      -- Keep the first legacy variant synchronized when one exists. The
      -- canonical stock remains products.stock.
      update public.product_variants
      set stock = greatest(0, stock - line.qty)
      where id = (
        select id
        from public.product_variants
        where product_id = line.product_id
        order by id
        limit 1
      );

      insert into public.stock_movements(product_id, movement_type, quantity, note)
      values (line.product_id, 'venta', line.qty, 'Descuento por pago Mercado Pago del pedido ' || new.id);
    end loop;
  end if;

  if old.payment_status::text = 'pagado'
     and new.payment_status::text in ('cancelado', 'reembolsado') then
    for line in
      select product_id, qty
      from public.order_items
      where order_id = new.id
    loop
      update public.products
      set stock = stock + line.qty
      where id = line.product_id;

      update public.product_variants
      set stock = stock + line.qty
      where id = (
        select id
        from public.product_variants
        where product_id = line.product_id
        order by id
        limit 1
      );

      insert into public.stock_movements(product_id, movement_type, quantity, note)
      values (line.product_id, 'devolucion', line.qty, 'Restitución por cancelación/reembolso del pedido ' || new.id);
    end loop;
  end if;

  return new;
end
$$;

-- These trigger functions are internal database mechanisms, not public RPCs.
revoke all on function public.ensure_stock_before_order_items() from public, anon, authenticated;
revoke all on function public.apply_stock_on_order_state_change() from public, anon, authenticated;
grant execute on function public.ensure_stock_before_order_items() to service_role;
grant execute on function public.apply_stock_on_order_state_change() to service_role;
