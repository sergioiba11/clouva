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

-- Lock the order and every product before changing payment_status to pagado.
-- This closes the race where two already-open checkouts try to buy the final
-- unit at the same time. The update fires the stock trigger above in the same
-- transaction, so either the whole confirmation succeeds or nothing changes.
create or replace function public.confirm_store_order_payment(
  p_order_id uuid,
  p_payment_id text,
  p_paid_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_payment_status text;
  line record;
  available_stock integer;
begin
  select payment_status::text
    into current_payment_status
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido inexistente %', p_order_id;
  end if;

  if current_payment_status = 'pagado' then
    return false;
  end if;

  for line in
    select product_id, qty
    from public.order_items
    where order_id = p_order_id
    order by product_id
  loop
    select stock
      into available_stock
    from public.products
    where id = line.product_id
    for update;

    if available_stock is null then
      raise exception 'Producto inexistente %', line.product_id;
    end if;

    if available_stock < line.qty then
      raise exception 'Stock insuficiente para producto %', line.product_id;
    end if;
  end loop;

  update public.orders
  set payment_status = 'pagado',
      shipping_status = 'pendiente',
      status = 'confirmado',
      payment_method = 'mercadopago',
      external_payment_id = p_payment_id,
      paid_at = p_paid_at
  where id = p_order_id;

  return true;
end
$$;

-- These functions are internal database mechanisms, not public RPCs.
revoke all on function public.ensure_stock_before_order_items() from public, anon, authenticated;
revoke all on function public.apply_stock_on_order_state_change() from public, anon, authenticated;
revoke all on function public.confirm_store_order_payment(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_store_order_payment(uuid, text, timestamptz) to service_role;
