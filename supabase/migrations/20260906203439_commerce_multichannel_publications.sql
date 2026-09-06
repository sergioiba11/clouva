alter table public.commerce_product_publications
  add column if not exists channel text not null default 'clouva',
  add column if not exists destination_key text,
  add column if not exists destination_label text,
  add column if not exists destination_url text,
  add column if not exists publication_mode text not null default 'automatic',
  add column if not exists status text not null default 'draft',
  add column if not exists external_id text,
  add column if not exists external_url text,
  add column if not exists published_at timestamptz,
  add column if not exists last_sync_at timestamptz,
  add column if not exists channel_title text,
  add column if not exists channel_description text,
  add column if not exists price_snapshot numeric,
  add column if not exists currency_snapshot text,
  add column if not exists stock_snapshot integer,
  add column if not exists error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.commerce_product_publications
set
  channel = case when target_type = 'marketplace' then 'clouva_market' else 'clouva' end,
  publication_mode = 'automatic',
  status = case when is_visible then 'published' else 'draft' end,
  last_sync_at = coalesce(last_sync_at, updated_at)
where channel = 'clouva'
  and destination_key is null
  and external_id is null
  and external_url is null;

alter table public.commerce_product_publications
  drop constraint if exists commerce_product_publications_publication_mode_check,
  drop constraint if exists commerce_product_publications_status_check;

alter table public.commerce_product_publications
  add constraint commerce_product_publications_publication_mode_check
    check (publication_mode in ('automatic','assisted','manual')),
  add constraint commerce_product_publications_status_check
    check (status in (
      'draft','ready','publishing','published','needs_user_action','failed',
      'paused','sold','removed','unavailable','needs_removal'
    ));

drop index if exists public.commerce_product_publications_marketplace_unique;
create unique index commerce_product_publications_marketplace_unique
  on public.commerce_product_publications(
    product_id,
    channel,
    coalesce(destination_key, ''),
    placement
  )
  where target_type = 'marketplace';

create index if not exists commerce_product_publications_channel_status_idx
  on public.commerce_product_publications(channel, status, updated_at desc)
  where target_type = 'marketplace';

alter table public.commerce_orders
  drop constraint if exists commerce_orders_sales_channel_check;

alter table public.commerce_orders
  add constraint commerce_orders_sales_channel_check
  check (sales_channel in (
    'online','pos','manual','marketplace',
    'facebook_marketplace','facebook_group','facebook_page','external'
  ));

create or replace function public.complete_commerce_external_sale(
  p_spot_id uuid,
  p_listing_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_unit_price numeric,
  p_sales_channel text,
  p_publication_id uuid,
  p_payment_method text,
  p_customer_name text,
  p_customer_email text,
  p_buyer_id uuid,
  p_fx_rate_id uuid,
  p_fee_amount numeric,
  p_external_reference text,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_spot public.commerce_spots%rowtype;
  v_publication public.commerce_product_publications%rowtype;
  v_listing public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_order public.commerce_orders%rowtype;
  v_order_item public.commerce_order_items%rowtype;
  v_existing_payment public.commerce_payments%rowtype;
  v_confirmation_result jsonb;
  v_payment_result jsonb;
  v_quantity integer;
  v_price numeric;
  v_subtotal numeric;
  v_fee numeric;
  v_remaining_stock integer;
  v_seller_type text;
begin
  if p_sales_channel not in ('facebook_marketplace','facebook_group','facebook_page','external') then
    raise exception 'Canal de venta externo inválido.';
  end if;
  if p_payment_method not in ('cash','transfer','debit_card','credit_card','other') then
    raise exception 'Medio de pago no permitido.';
  end if;
  v_quantity := greatest(1, coalesce(p_quantity, 1));
  v_fee := greatest(coalesce(p_fee_amount, 0), 0);
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'La venta necesita una clave de idempotencia.';
  end if;

  select * into v_existing_payment
  from public.commerce_payments
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'order_id', v_existing_payment.order_id,
      'payment_id', v_existing_payment.id,
      'duplicate', true
    );
  end if;

  select * into v_spot
  from public.commerce_spots
  where id = p_spot_id
  for update;
  if not found or v_spot.status <> 'active' then
    raise exception 'El Spot no está activo.';
  end if;

  select * into v_publication
  from public.commerce_product_publications
  where id = p_publication_id
    and product_id = p_listing_id
    and target_type = 'marketplace'
  for update;
  if not found then
    raise exception 'La publicación externa no corresponde al producto.';
  end if;
  if v_publication.channel <> p_sales_channel then
    raise exception 'El canal de la venta no coincide con la publicación.';
  end if;

  select * into v_listing
  from public.commerce_products
  where id = p_listing_id and spot_id = p_spot_id
  for update;
  if not found then
    raise exception 'El producto no pertenece al negocio.';
  end if;
  if v_listing.product_type not in ('physical','bundle') then
    raise exception 'La venta externa manual está habilitada para productos físicos.';
  end if;

  if p_variant_id is not null then
    select * into v_variant
    from public.commerce_product_variants
    where id = p_variant_id and product_id = p_listing_id
    for update;
    if not found or not v_variant.active then
      raise exception 'Variante inválida.';
    end if;
    if v_variant.stock < v_quantity then
      raise exception 'Stock insuficiente para %.', v_listing.name;
    end if;
    v_price := coalesce(p_unit_price, v_variant.price_override, v_listing.price);
  else
    if v_listing.stock is not null and v_listing.stock < v_quantity then
      raise exception 'Stock insuficiente para %.', v_listing.name;
    end if;
    v_price := coalesce(p_unit_price, v_listing.price);
  end if;

  if v_price is null or v_price < 0 then
    raise exception 'Precio de venta inválido.';
  end if;
  v_subtotal := v_price * v_quantity;
  v_seller_type := case when v_spot.owner_type = 'studio' then 'studio' else 'user' end;

  insert into public.commerce_orders(
    buyer_id, seller_type, seller_studio_id, seller_user_id, spot_id,
    subtotal, fees, commission, total, currency,
    status, payment_status, fulfillment_status,
    external_reference, paid_at, completed_at, stock_committed_at,
    sales_channel, payment_method, customer_name, customer_email, created_by,
    metadata
  ) values (
    p_buyer_id,
    v_seller_type,
    case when v_seller_type = 'studio' then v_spot.studio_id else null end,
    case when v_seller_type = 'user' then v_spot.owner_user_id else null end,
    p_spot_id,
    v_subtotal, v_fee, 0, v_subtotal, v_spot.currency,
    'pending', 'pending', 'pending',
    coalesce(nullif(btrim(p_external_reference), ''), p_sales_channel || ':' || p_idempotency_key),
    null, null, null,
    p_sales_channel, p_payment_method,
    nullif(btrim(p_customer_name), ''),
    nullif(lower(btrim(p_customer_email)), ''),
    p_actor_id,
    jsonb_build_object(
      'source', 'external_sale',
      'sales_channel', p_sales_channel,
      'publication_id', p_publication_id,
      'external_reference', nullif(btrim(p_external_reference), '')
    )
  ) returning * into v_order;

  insert into public.commerce_order_items(
    order_id, product_id, variant_id, sku_snapshot, variant_snapshot,
    product_name, product_type, quantity, unit_price, total,
    delivery_status, metadata
  ) values (
    v_order.id, v_listing.id, v_variant.id, v_variant.sku,
    case when v_variant.id is null then '{}'::jsonb else jsonb_build_object(
      'id', v_variant.id,
      'sku', v_variant.sku,
      'title', v_variant.title,
      'size', v_variant.size,
      'color', v_variant.color
    ) end,
    v_listing.name, v_listing.product_type, v_quantity, v_price, v_subtotal,
    case when v_listing.product_type in ('physical','bundle') then 'not_applicable' else 'pending' end,
    jsonb_build_object(
      'sales_channel', p_sales_channel,
      'publication_id', p_publication_id
    )
  ) returning * into v_order_item;

  perform public.expand_commerce_bundle_order_items(
    v_order.id,
    p_idempotency_key || ':bundle'
  );

  v_confirmation_result := public.confirm_commerce_order_payment(
    v_order.id,
    'external:' || p_idempotency_key,
    now()
  );
  if coalesce((v_confirmation_result ->> 'stock_conflict')::boolean, false) then
    raise exception 'Stock insuficiente para completar la venta.';
  end if;

  perform public.record_commerce_order_stock_movements(
    v_order.id,
    p_actor_id,
    p_idempotency_key || ':inventory'
  );

  v_payment_result := public.record_commerce_spot_payment(
    v_order.id,
    p_spot_id,
    'manual',
    p_payment_method,
    null,
    v_fee,
    p_fx_rate_id,
    p_actor_id,
    p_idempotency_key,
    jsonb_build_object(
      'source', 'external_sale',
      'sales_channel', p_sales_channel,
      'publication_id', p_publication_id,
      'external_reference', nullif(btrim(p_external_reference), '')
    )
  );

  if p_variant_id is not null then
    select coalesce(sum(stock), 0)::integer
    into v_remaining_stock
    from public.commerce_product_variants
    where product_id = p_listing_id and active;
  else
    select coalesce(stock, 0)::integer
    into v_remaining_stock
    from public.commerce_products
    where id = p_listing_id;
  end if;

  update public.commerce_product_publications
  set
    stock_snapshot = v_remaining_stock,
    last_sync_at = now(),
    updated_at = now()
  where product_id = p_listing_id
    and target_type = 'marketplace';

  if v_remaining_stock <= 0 then
    update public.commerce_products
    set status = 'draft', updated_at = now()
    where id = p_listing_id;

    update public.commerce_product_publications
    set
      is_visible = false,
      status = case
        when id = p_publication_id then 'sold'
        when channel = 'clouva_market' then 'sold'
        else 'needs_removal'
      end,
      last_sync_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'sold_order_id', v_order.id,
        'sold_via_channel', p_sales_channel
      ),
      updated_at = now()
    where product_id = p_listing_id
      and target_type = 'marketplace';
  else
    update public.commerce_product_publications
    set
      status = 'published',
      last_sync_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_sale_order_id', v_order.id,
        'last_sale_channel', p_sales_channel
      ),
      updated_at = now()
    where id = p_publication_id;
  end if;

  select * into v_order from public.commerce_orders where id = v_order.id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order', to_jsonb(v_order),
    'payment', v_payment_result,
    'publication_id', p_publication_id,
    'remaining_stock', v_remaining_stock,
    'duplicate', false
  );
end;
$function$;

revoke all on function public.complete_commerce_external_sale(
  uuid,uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,uuid,numeric,text,uuid,text
) from public, anon, authenticated;
grant execute on function public.complete_commerce_external_sale(
  uuid,uuid,uuid,integer,numeric,text,uuid,text,text,text,uuid,uuid,numeric,text,uuid,text
) to service_role;
