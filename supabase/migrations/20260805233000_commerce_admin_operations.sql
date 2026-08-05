-- Explicit service-role operations for resolving paid stock conflicts and
-- progressing physical fulfillment. Payment status is deliberately absent:
-- only the Mercado Pago webhook can transition money states.

begin;

create or replace function public.resolve_commerce_stock_conflict(
  p_order_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.commerce_orders%rowtype;
  line record;
  product_stock integer;
  variant_stock integer;
begin
  select *
    into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden de comercio inexistente %', p_order_id;
  end if;
  if order_row.payment_status <> 'paid' then
    raise exception 'La orden % no está pagada', p_order_id;
  end if;
  if order_row.fulfillment_status <> 'stock_conflict' then
    return jsonb_build_object('processed', false, 'duplicate', true, 'order_id', p_order_id);
  end if;
  if order_row.stock_committed_at is not null then
    update public.commerce_orders
    set fulfillment_status = 'pending'
    where id = p_order_id;
    return jsonb_build_object('processed', false, 'duplicate', true, 'order_id', p_order_id);
  end if;

  for line in
    select oi.id, oi.product_id, oi.variant_id, oi.quantity
    from public.commerce_order_items oi
    where oi.order_id = p_order_id
    order by oi.product_id, coalesce(oi.variant_id, '00000000-0000-0000-0000-000000000000'::uuid), oi.id
  loop
    if line.variant_id is not null then
      select stock
        into variant_stock
      from public.commerce_product_variants
      where id = line.variant_id
      for update;

      if not found then
        raise exception 'La variante % ya no existe', line.variant_id;
      end if;
      if variant_stock < line.quantity then
        raise exception 'Stock insuficiente para la variante %', line.variant_id;
      end if;
    else
      select stock
        into product_stock
      from public.commerce_products
      where id = line.product_id
      for update;

      if not found then
        raise exception 'El producto % ya no existe', line.product_id;
      end if;
      if product_stock is not null and product_stock < line.quantity then
        raise exception 'Stock insuficiente para el producto %', line.product_id;
      end if;
    end if;
  end loop;

  for line in
    select oi.product_id, oi.variant_id, oi.quantity
    from public.commerce_order_items oi
    where oi.order_id = p_order_id
    order by oi.product_id, coalesce(oi.variant_id, '00000000-0000-0000-0000-000000000000'::uuid), oi.id
  loop
    if line.variant_id is not null then
      update public.commerce_product_variants
      set stock = stock - line.quantity
      where id = line.variant_id;
    else
      update public.commerce_products
      set stock = stock - line.quantity
      where id = line.product_id
        and stock is not null;
    end if;
  end loop;

  update public.commerce_orders
  set fulfillment_status = 'pending',
      stock_committed_at = now(),
      stock_restored_at = null
  where id = p_order_id;

  insert into public.commerce_order_events(
    order_id,
    event_type,
    note,
    actor_type,
    actor_id,
    metadata
  )
  values (
    p_order_id,
    'stock_conflict_resolved',
    'Un administrador validó la disponibilidad y comprometió el stock de la orden pagada.',
    'admin',
    p_admin_user_id,
    jsonb_build_object('admin_user_id', p_admin_user_id)
  );

  return jsonb_build_object('processed', true, 'duplicate', false, 'order_id', p_order_id);
end;
$$;

create or replace function public.admin_update_commerce_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_carrier text,
  p_tracking_number text,
  p_tracking_url text,
  p_label_url text,
  p_note text,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.commerce_orders%rowtype;
  shipment_row public.commerce_shipments%rowtype;
  next_order_status text;
  next_shipment_status text;
  event_note text;
begin
  if p_fulfillment_status not in ('preparing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'returned') then
    raise exception 'Estado de fulfillment no permitido: %', p_fulfillment_status;
  end if;

  select *
    into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden de comercio inexistente %', p_order_id;
  end if;
  if order_row.payment_status <> 'paid' and p_fulfillment_status not in ('cancelled', 'returned') then
    raise exception 'Solo una orden pagada puede avanzar en preparación';
  end if;
  if order_row.fulfillment_status = 'stock_conflict' then
    raise exception 'Resolvé el conflicto de stock antes de preparar la orden';
  end if;

  select *
    into shipment_row
  from public.commerce_shipments
  where order_id = p_order_id
    and shipment_group = 'primary'
  for update;

  if not found then
    raise exception 'La orden % no tiene shipment físico', p_order_id;
  end if;

  next_shipment_status := p_fulfillment_status;
  next_order_status := case
    when p_fulfillment_status = 'delivered' then 'completed'
    when p_fulfillment_status in ('cancelled', 'returned') then 'cancelled'
    else 'confirmed'
  end;

  update public.commerce_shipments
  set status = next_shipment_status,
      carrier = nullif(btrim(coalesce(p_carrier, '')), ''),
      tracking_number = nullif(btrim(coalesce(p_tracking_number, '')), ''),
      tracking_url = nullif(btrim(coalesce(p_tracking_url, '')), ''),
      label_url = nullif(btrim(coalesce(p_label_url, '')), ''),
      shipped_at = case
        when p_fulfillment_status in ('shipped', 'delivered') then coalesce(shipped_at, now())
        else shipped_at
      end,
      delivered_at = case
        when p_fulfillment_status = 'delivered' then coalesce(delivered_at, now())
        else delivered_at
      end
  where id = shipment_row.id;

  update public.commerce_orders
  set fulfillment_status = p_fulfillment_status,
      status = next_order_status,
      completed_at = case
        when p_fulfillment_status = 'delivered' then coalesce(completed_at, now())
        else completed_at
      end
  where id = p_order_id;

  event_note := coalesce(
    nullif(btrim(coalesce(p_note, '')), ''),
    case p_fulfillment_status
      when 'preparing' then 'La preparación física del pedido fue iniciada.'
      when 'ready_to_ship' then 'El pedido quedó listo para despachar.'
      when 'shipped' then 'El pedido fue despachado.'
      when 'delivered' then 'El pedido fue marcado como entregado.'
      when 'cancelled' then 'El fulfillment físico fue cancelado.'
      when 'returned' then 'El pedido fue marcado como devuelto.'
    end
  );

  insert into public.commerce_order_events(
    order_id,
    event_type,
    note,
    actor_type,
    actor_id,
    metadata
  )
  values (
    p_order_id,
    p_fulfillment_status,
    event_note,
    'admin',
    p_admin_user_id,
    jsonb_build_object(
      'carrier', nullif(btrim(coalesce(p_carrier, '')), ''),
      'tracking_number', nullif(btrim(coalesce(p_tracking_number, '')), ''),
      'tracking_url', nullif(btrim(coalesce(p_tracking_url, '')), '')
    )
  );

  return jsonb_build_object(
    'processed', true,
    'order_id', p_order_id,
    'fulfillment_status', p_fulfillment_status,
    'shipment_status', next_shipment_status
  );
end;
$$;

revoke all on function public.resolve_commerce_stock_conflict(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_update_commerce_fulfillment(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_commerce_stock_conflict(uuid, uuid) to service_role;
grant execute on function public.admin_update_commerce_fulfillment(uuid, text, text, text, text, text, text, uuid) to service_role;

commit;
