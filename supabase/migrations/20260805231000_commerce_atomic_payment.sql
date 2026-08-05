-- Atomic payment, stock, refund and digital-delivery operations for commerce_*.
-- Mercado Pago remains the external source of truth for payment facts; these
-- functions make the internal state transition transactional and idempotent.

begin;

create or replace function public.record_commerce_order_event(
  p_order_id uuid,
  p_event_type text,
  p_note text default null,
  p_dedupe_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.commerce_order_events(
    order_id,
    event_type,
    note,
    actor_type,
    dedupe_key,
    metadata
  )
  values (
    p_order_id,
    p_event_type,
    p_note,
    'system',
    p_dedupe_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing;
end;
$$;

create or replace function public.confirm_commerce_order_payment(
  p_order_id uuid,
  p_payment_id text,
  p_paid_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.commerce_orders%rowtype;
  line record;
  product_row record;
  variant_row record;
  conflicts jsonb := '[]'::jsonb;
  item_count integer := 0;
  has_physical boolean := false;
begin
  select *
    into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden de comercio inexistente %', p_order_id;
  end if;

  if order_row.payment_status = 'paid' then
    return jsonb_build_object(
      'processed', false,
      'duplicate', true,
      'stock_conflict', order_row.fulfillment_status = 'stock_conflict',
      'order_id', order_row.id
    );
  end if;

  if order_row.payment_status = 'refunded' then
    raise exception 'La orden % ya fue reembolsada', p_order_id;
  end if;

  for line in
    select oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.product_type
    from public.commerce_order_items oi
    where oi.order_id = p_order_id
    order by oi.product_id, coalesce(oi.variant_id, '00000000-0000-0000-0000-000000000000'::uuid), oi.id
  loop
    item_count := item_count + 1;
    has_physical := has_physical or line.product_type = 'physical';

    select p.id, p.product_type, p.stock
      into product_row
    from public.commerce_products p
    where p.id = line.product_id
    for update;

    if not found then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'order_item_id', line.id,
        'product_id', line.product_id,
        'reason', 'product_missing'
      ));
      continue;
    end if;

    if line.variant_id is not null then
      select v.id, v.product_id, v.stock, v.active, v.sku
        into variant_row
      from public.commerce_product_variants v
      where v.id = line.variant_id
      for update;

      if not found then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object(
          'order_item_id', line.id,
          'product_id', line.product_id,
          'variant_id', line.variant_id,
          'reason', 'variant_missing'
        ));
      elsif variant_row.product_id <> line.product_id then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object(
          'order_item_id', line.id,
          'product_id', line.product_id,
          'variant_id', line.variant_id,
          'reason', 'variant_product_mismatch'
        ));
      elsif variant_row.active is distinct from true then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object(
          'order_item_id', line.id,
          'product_id', line.product_id,
          'variant_id', line.variant_id,
          'reason', 'variant_inactive'
        ));
      elsif variant_row.stock < line.quantity then
        conflicts := conflicts || jsonb_build_array(jsonb_build_object(
          'order_item_id', line.id,
          'product_id', line.product_id,
          'variant_id', line.variant_id,
          'requested', line.quantity,
          'available', variant_row.stock,
          'reason', 'stock_insufficient'
        ));
      end if;
    elsif product_row.stock is not null and product_row.stock < line.quantity then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'order_item_id', line.id,
        'product_id', line.product_id,
        'requested', line.quantity,
        'available', product_row.stock,
        'reason', 'stock_insufficient'
      ));
    end if;
  end loop;

  if item_count = 0 then
    raise exception 'La orden % no contiene items', p_order_id;
  end if;

  update public.commerce_order_items
  set delivery_status = 'not_applicable',
      delivery_claimed_at = null,
      delivered_at = null,
      delivery_error = null
  where order_id = p_order_id
    and product_type = 'physical';

  if jsonb_array_length(conflicts) > 0 then
    update public.commerce_orders
    set payment_status = 'paid',
        status = 'confirmed',
        fulfillment_status = 'stock_conflict',
        external_payment_id = p_payment_id,
        paid_at = p_paid_at,
        stock_committed_at = null,
        stock_restored_at = null
    where id = p_order_id;

    if has_physical then
      insert into public.commerce_shipments(
        order_id,
        shipment_group,
        shipping_cost,
        status,
        metadata
      )
      values (
        p_order_id,
        'primary',
        order_row.shipping_subtotal,
        'pending',
        jsonb_build_object('created_from', 'payment_confirmation', 'stock_conflict', true)
      )
      on conflict (order_id, shipment_group) do nothing;
    end if;

    perform public.record_commerce_order_event(
      p_order_id,
      'payment_approved_stock_conflict',
      'Mercado Pago aprobó el pago, pero el fulfillment requiere resolución de stock.',
      'payment:' || p_payment_id || ':approved',
      jsonb_build_object('payment_id', p_payment_id, 'conflicts', conflicts)
    );

    return jsonb_build_object(
      'processed', true,
      'duplicate', false,
      'stock_conflict', true,
      'has_physical', has_physical,
      'conflicts', conflicts,
      'order_id', p_order_id
    );
  end if;

  for line in
    select oi.id, oi.product_id, oi.variant_id, oi.quantity
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
  set payment_status = 'paid',
      status = 'confirmed',
      fulfillment_status = 'pending',
      external_payment_id = p_payment_id,
      paid_at = p_paid_at,
      stock_committed_at = now(),
      stock_restored_at = null
  where id = p_order_id;

  if has_physical then
    insert into public.commerce_shipments(
      order_id,
      shipment_group,
      shipping_cost,
      status,
      metadata
    )
    values (
      p_order_id,
      'primary',
      order_row.shipping_subtotal,
      'pending',
      jsonb_build_object('created_from', 'payment_confirmation')
    )
    on conflict (order_id, shipment_group) do nothing;
  end if;

  perform public.record_commerce_order_event(
    p_order_id,
    'payment_approved',
    'Pago de Mercado Pago confirmado y stock comprometido.',
    'payment:' || p_payment_id || ':approved',
    jsonb_build_object('payment_id', p_payment_id, 'has_physical', has_physical)
  );

  return jsonb_build_object(
    'processed', true,
    'duplicate', false,
    'stock_conflict', false,
    'has_physical', has_physical,
    'order_id', p_order_id
  );
end;
$$;

create or replace function public.refund_commerce_order_payment(
  p_order_id uuid,
  p_payment_id text,
  p_refunded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  order_row public.commerce_orders%rowtype;
  line record;
  inventory_row record;
  restored boolean := false;
begin
  select *
    into order_row
  from public.commerce_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Orden de comercio inexistente %', p_order_id;
  end if;

  if order_row.payment_status = 'refunded' then
    return jsonb_build_object(
      'processed', false,
      'duplicate', true,
      'stock_restored', order_row.stock_restored_at is not null,
      'order_id', p_order_id
    );
  end if;

  if order_row.stock_committed_at is not null and order_row.stock_restored_at is null then
    for line in
      select oi.id, oi.product_id, oi.variant_id, oi.quantity
      from public.commerce_order_items oi
      where oi.order_id = p_order_id
      order by oi.product_id, coalesce(oi.variant_id, '00000000-0000-0000-0000-000000000000'::uuid), oi.id
    loop
      if line.variant_id is not null then
        perform 1
        from public.commerce_product_variants
        where id = line.variant_id
        for update;

        update public.commerce_product_variants
        set stock = stock + line.quantity
        where id = line.variant_id;
      else
        perform 1
        from public.commerce_products
        where id = line.product_id
        for update;

        update public.commerce_products
        set stock = stock + line.quantity
        where id = line.product_id
          and stock is not null;
      end if;
    end loop;
    restored := true;
  end if;

  for inventory_row in
    select ci.id, ci.clothing_item_id, ci.product_id
    from public.commerce_inventory ci
    join public.commerce_order_items oi on oi.id = ci.order_item_id
    where oi.order_id = p_order_id
    for update of ci
  loop
    if inventory_row.clothing_item_id is not null then
      delete from public.clothing_items clothing
      where clothing.id = inventory_row.clothing_item_id
        and clothing.user_id = order_row.buyer_id
        and clothing.metadata ->> 'purchased_from_product_id' = inventory_row.product_id::text;
    end if;
  end loop;

  delete from public.commerce_inventory inventory
  using public.commerce_order_items oi
  where inventory.order_item_id = oi.id
    and oi.order_id = p_order_id;

  update public.commerce_order_items
  set delivery_status = case when product_type = 'physical' then 'not_applicable' else 'pending' end,
      delivery_claimed_at = null,
      delivered_at = null,
      delivery_error = null
  where order_id = p_order_id;

  update public.commerce_shipments
  set status = case when status = 'delivered' then 'returned' else 'cancelled' end,
      metadata = metadata || jsonb_build_object('refunded_payment_id', p_payment_id)
  where order_id = p_order_id
    and status not in ('cancelled', 'returned');

  update public.commerce_orders
  set payment_status = 'refunded',
      status = 'cancelled',
      fulfillment_status = 'cancelled',
      external_payment_id = coalesce(external_payment_id, p_payment_id),
      refunded_at = p_refunded_at,
      stock_restored_at = case when restored then now() else stock_restored_at end
  where id = p_order_id;

  perform public.record_commerce_order_event(
    p_order_id,
    'payment_refunded',
    'Mercado Pago informó el reembolso; inventario y stock fueron reconciliados.',
    'payment:' || p_payment_id || ':refunded',
    jsonb_build_object('payment_id', p_payment_id, 'stock_restored', restored)
  );

  return jsonb_build_object(
    'processed', true,
    'duplicate', false,
    'stock_restored', restored,
    'order_id', p_order_id
  );
end;
$$;

create or replace function public.deliver_commerce_order_item(
  p_order_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_row public.commerce_order_items%rowtype;
  order_row public.commerce_orders%rowtype;
  product_row record;
  source_garment record;
  existing_inventory record;
  cloned_clothing_item_id uuid := null;
begin
  select *
    into item_row
  from public.commerce_order_items
  where id = p_order_item_id
  for update;

  if not found then
    raise exception 'Item de comercio inexistente %', p_order_item_id;
  end if;

  select *
    into order_row
  from public.commerce_orders
  where id = item_row.order_id
  for update;

  if not found or order_row.payment_status <> 'paid' then
    raise exception 'La orden del item % no está pagada', p_order_item_id;
  end if;

  if item_row.product_type = 'physical' then
    update public.commerce_order_items
    set delivery_status = 'not_applicable',
        delivery_claimed_at = null,
        delivered_at = null,
        delivery_error = null
    where id = p_order_item_id;

    return jsonb_build_object(
      'processed', false,
      'not_applicable', true,
      'order_item_id', p_order_item_id
    );
  end if;

  select ci.id, ci.clothing_item_id
    into existing_inventory
  from public.commerce_inventory ci
  where ci.order_item_id = p_order_item_id
  for update;

  if found then
    update public.commerce_order_items
    set delivery_status = 'delivered',
        delivery_claimed_at = null,
        delivered_at = coalesce(delivered_at, now()),
        delivery_error = null
    where id = p_order_item_id;

    return jsonb_build_object(
      'processed', false,
      'duplicate', true,
      'inventory_id', existing_inventory.id,
      'order_item_id', p_order_item_id
    );
  end if;

  update public.commerce_order_items
  set delivery_status = 'processing',
      delivery_claimed_at = now(),
      delivery_error = null
  where id = p_order_item_id;

  if item_row.product_type = 'avatar_item' then
    select p.avatar_asset_id
      into product_row
    from public.commerce_products p
    where p.id = item_row.product_id
    for update;

    if not found or product_row.avatar_asset_id is null then
      raise exception 'El producto de avatar % no tiene asset entregable', item_row.product_id;
    end if;

    select name, category, fit, color, model_url, thumbnail_url, metadata
      into source_garment
    from public.clothing_items
    where id = product_row.avatar_asset_id
    for share;

    if not found then
      raise exception 'El asset de avatar % no existe', product_row.avatar_asset_id;
    end if;

    insert into public.clothing_items(
      user_id,
      name,
      category,
      fit,
      color,
      model_url,
      thumbnail_url,
      status,
      metadata
    )
    values (
      order_row.buyer_id,
      source_garment.name,
      source_garment.category,
      source_garment.fit,
      source_garment.color,
      source_garment.model_url,
      source_garment.thumbnail_url,
      'ready',
      coalesce(source_garment.metadata, '{}'::jsonb) || jsonb_build_object(
        'purchased_from_product_id', item_row.product_id,
        'purchased_from_order_item_id', item_row.id
      )
    )
    returning id into cloned_clothing_item_id;
  end if;

  insert into public.commerce_inventory(
    user_id,
    order_item_id,
    product_id,
    clothing_item_id
  )
  values (
    order_row.buyer_id,
    item_row.id,
    item_row.product_id,
    cloned_clothing_item_id
  );

  update public.commerce_order_items
  set delivery_status = 'delivered',
      delivery_claimed_at = null,
      delivered_at = now(),
      delivery_error = null
  where id = p_order_item_id;

  perform public.record_commerce_order_event(
    item_row.order_id,
    'item_delivered',
    'El producto digital o de avatar fue agregado al inventario del comprador.',
    'delivery:' || item_row.id::text,
    jsonb_build_object(
      'order_item_id', item_row.id,
      'product_id', item_row.product_id,
      'product_type', item_row.product_type,
      'clothing_item_id', cloned_clothing_item_id
    )
  );

  if not exists (
    select 1
    from public.commerce_order_items oi
    where oi.order_id = item_row.order_id
      and oi.product_type = 'physical'
  ) and not exists (
    select 1
    from public.commerce_order_items oi
    where oi.order_id = item_row.order_id
      and oi.product_type <> 'physical'
      and oi.delivery_status <> 'delivered'
  ) then
    update public.commerce_orders
    set status = 'completed',
        fulfillment_status = 'completed',
        completed_at = coalesce(completed_at, now())
    where id = item_row.order_id;

    perform public.record_commerce_order_event(
      item_row.order_id,
      'order_completed',
      'Todos los productos digitales de la orden fueron entregados.',
      'order:' || item_row.order_id::text || ':completed',
      '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'processed', true,
    'duplicate', false,
    'inventory_created', true,
    'clothing_item_id', cloned_clothing_item_id,
    'order_item_id', p_order_item_id
  );
end;
$$;

revoke all on function public.record_commerce_order_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_commerce_order_payment(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.refund_commerce_order_payment(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.deliver_commerce_order_item(uuid) from public, anon, authenticated;

grant execute on function public.record_commerce_order_event(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.confirm_commerce_order_payment(uuid, text, timestamptz) to service_role;
grant execute on function public.refund_commerce_order_payment(uuid, text, timestamptz) to service_role;
grant execute on function public.deliver_commerce_order_item(uuid) to service_role;

commit;
