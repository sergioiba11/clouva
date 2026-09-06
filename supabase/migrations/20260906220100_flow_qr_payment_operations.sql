-- Recoverable FLOW QR payments.
-- This is an orchestration/provenance layer only: balances and ownership remain
-- authoritative in flows_wallets / flows_wallet_ledger / flow_assets.

create table if not exists public.flow_transfer_operations (
  id uuid primary key,
  sender_user_id uuid not null references auth.users(id),
  recipient_user_id uuid not null references auth.users(id),
  qr_registry_id uuid references public.clouva_qr_registry(id),
  spot_id uuid references public.commerce_spots(id),
  order_id uuid references public.commerce_orders(id),
  payment_id uuid references public.commerce_payments(id),
  quantity integer not null check (quantity between 1 and 50),
  subject_type text not null check (subject_type in ('USER_QR','COMMERCE_QR')),
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED')),
  rail text not null default 'FLOW' check (rail = 'FLOW'),
  fingerprint jsonb not null default '{}'::jsonb,
  result jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (sender_user_id <> recipient_user_id)
);

create index if not exists flow_transfer_operations_sender_created_idx
  on public.flow_transfer_operations(sender_user_id, created_at desc);
create index if not exists flow_transfer_operations_qr_idx
  on public.flow_transfer_operations(qr_registry_id, created_at desc)
  where qr_registry_id is not null;
create index if not exists flow_transfer_operations_order_idx
  on public.flow_transfer_operations(order_id)
  where order_id is not null;

alter table public.flow_transfer_operations enable row level security;
revoke all on table public.flow_transfer_operations from anon, authenticated;
grant all on table public.flow_transfer_operations to service_role;

comment on table public.flow_transfer_operations is
  'Idempotency, recovery and provenance for FLOW transfers. Not a wallet or ledger.';

create or replace function public.execute_flow_qr_transfer(
  p_sender_user_id uuid,
  p_public_token text,
  p_quantity integer,
  p_transfer_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_qr public.clouva_qr_registry%rowtype;
  v_op public.flow_transfer_operations%rowtype;
  v_transfer jsonb;
  v_fingerprint jsonb;
begin
  if p_sender_user_id is null or p_actor_id is null or p_transfer_id is null then
    raise exception 'La operación FLOW está incompleta.';
  end if;
  if p_actor_id <> p_sender_user_id then
    raise exception 'El actor no puede transferir FLOWS de otro Player.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then
    raise exception 'La cantidad de FLOW debe estar entre 1 y 50.';
  end if;
  if nullif(btrim(p_public_token), '') is null then
    raise exception 'QR CLOUVA inválido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('flow-qr-operation:' || p_transfer_id::text, 0));

  -- Intentionally resolve by exact token before checking state. A revoked token
  -- must never fall through to another legacy identifier path.
  select * into v_qr
  from public.clouva_qr_registry
  where public_token = btrim(p_public_token)
  for share;

  if not found
     or v_qr.entity_type <> 'USER'
     or v_qr.status <> 'ACTIVE'
     or not v_qr.is_canonical
     or v_qr.revoked_at is not null then
    raise exception 'Este QR no corresponde a un Player activo que pueda recibir FLOW.';
  end if;
  if v_qr.entity_id = p_sender_user_id then
    raise exception 'No podés pagarte FLOWS a vos mismo.';
  end if;

  v_fingerprint := jsonb_build_object(
    'publicToken', v_qr.public_token,
    'qrRegistryId', v_qr.id,
    'recipientUserId', v_qr.entity_id,
    'quantity', p_quantity,
    'rail', 'FLOW'
  );

  select * into v_op
  from public.flow_transfer_operations
  where id = p_transfer_id
  for update;

  if found then
    if v_op.sender_user_id <> p_sender_user_id
       or v_op.recipient_user_id <> v_qr.entity_id
       or v_op.quantity <> p_quantity
       or v_op.qr_registry_id is distinct from v_qr.id
       or v_op.subject_type <> 'USER_QR'
       or v_op.fingerprint <> v_fingerprint then
      raise exception 'El id de transferencia ya pertenece a otra operación.';
    end if;
    if v_op.status = 'COMPLETED' and v_op.result is not null then
      return v_op.result || jsonb_build_object('duplicate', true, 'recovered', true);
    end if;
  else
    insert into public.flow_transfer_operations(
      id, sender_user_id, recipient_user_id, qr_registry_id, quantity,
      subject_type, status, rail, fingerprint, created_by
    ) values (
      p_transfer_id, p_sender_user_id, v_qr.entity_id, v_qr.id, p_quantity,
      'USER_QR', 'PENDING', 'FLOW', v_fingerprint, p_actor_id
    ) returning * into v_op;
  end if;

  v_transfer := public.transfer_backed_flows(
    p_sender_user_id,
    v_qr.entity_id,
    p_quantity,
    p_transfer_id,
    p_actor_id
  );

  -- Add QR/operation provenance to the existing authoritative movement/ledger.
  update public.flow_asset_movements
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'operationId', p_transfer_id,
    'qrRegistryId', v_qr.id,
    'qrPublicToken', v_qr.public_token,
    'rail', 'FLOW'
  )
  where action = 'transferred'
    and metadata ->> 'transferId' = p_transfer_id::text;

  update public.flows_wallet_ledger
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'operationId', p_transfer_id,
    'qrRegistryId', v_qr.id,
    'qrPublicToken', v_qr.public_token,
    'rail', 'FLOW'
  )
  where reference_id = p_transfer_id::text
    and transaction_type in ('transfer_out','transfer_in');

  v_transfer := v_transfer || jsonb_build_object(
    'operationId', p_transfer_id,
    'qrRegistryId', v_qr.id,
    'rail', 'FLOW',
    'status', 'COMPLETED',
    'recovered', false
  );

  update public.flow_transfer_operations
  set status = 'COMPLETED', result = v_transfer, completed_at = now(), updated_at = now()
  where id = p_transfer_id;

  return v_transfer;
end;
$$;

revoke all on function public.execute_flow_qr_transfer(uuid,text,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.execute_flow_qr_transfer(uuid,text,integer,uuid,uuid) to service_role;

create or replace function public.complete_commerce_flow_qr_sale(
  p_sender_user_id uuid,
  p_public_token text,
  p_listing_id uuid,
  p_variant_id uuid,
  p_purchase_quantity integer,
  p_fx_rate_id uuid,
  p_transfer_id uuid,
  p_actor_id uuid,
  p_customer_name text default null,
  p_customer_email text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_qr public.clouva_qr_registry%rowtype;
  v_identifier public.commerce_product_identifiers%rowtype;
  v_listing public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_spot public.commerce_spots%rowtype;
  v_rate public.commerce_fx_rates%rowtype;
  v_op public.flow_transfer_operations%rowtype;
  v_unit_price numeric;
  v_total_local numeric;
  v_required_flow numeric;
  v_required_quantity integer;
  v_items jsonb;
  v_sale jsonb;
  v_transfer jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_result jsonb;
  v_fingerprint jsonb;
begin
  if p_sender_user_id is null or p_actor_id is null or p_transfer_id is null then
    raise exception 'La operación FLOW está incompleta.';
  end if;
  if p_actor_id <> p_sender_user_id then
    raise exception 'El actor no puede pagar con FLOWS de otro Player.';
  end if;
  if p_purchase_quantity is null or p_purchase_quantity < 1 then
    raise exception 'La cantidad de compra es inválida.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('flow-qr-operation:' || p_transfer_id::text, 0));

  select * into v_qr
  from public.clouva_qr_registry
  where public_token = btrim(p_public_token)
  for share;
  if not found
     or v_qr.entity_type not in ('PRODUCT','VARIANT')
     or v_qr.status <> 'ACTIVE'
     or not v_qr.is_canonical
     or v_qr.revoked_at is not null then
    raise exception 'El QR de producto no está activo.';
  end if;

  select * into v_listing
  from public.commerce_products
  where id = p_listing_id and status = 'published'
  for share;
  if not found then raise exception 'La publicación no está disponible.'; end if;

  if v_qr.entity_type = 'PRODUCT' and v_qr.entity_id <> v_listing.catalog_product_id then
    raise exception 'El QR no corresponde a la publicación elegida.';
  end if;

  if p_variant_id is not null then
    select * into v_variant
    from public.commerce_product_variants
    where id = p_variant_id and product_id = v_listing.id and active
    for share;
    if not found then raise exception 'La variante no está disponible.'; end if;
  else
    v_variant := null;
  end if;

  if v_qr.entity_type = 'VARIANT' then
    if v_variant.id is null or v_variant.catalog_variant_id is distinct from v_qr.entity_id then
      raise exception 'El QR no corresponde a la variante elegida.';
    end if;
  end if;

  if v_qr.source_identifier_id is not null then
    select * into v_identifier
    from public.commerce_product_identifiers
    where id = v_qr.source_identifier_id and status = 'active'
    for share;
    if not found then raise exception 'El identificador comercial del QR ya no está activo.'; end if;
    if v_identifier.catalog_product_id is distinct from v_listing.catalog_product_id
       or (v_identifier.spot_id is not null and v_identifier.spot_id is distinct from v_listing.spot_id) then
      raise exception 'El QR no pertenece a esta publicación o Spot.';
    end if;
    if v_qr.entity_type = 'VARIANT'
       and v_identifier.catalog_variant_id is distinct from v_variant.catalog_variant_id then
      raise exception 'El QR no pertenece a esta variante.';
    end if;
  end if;

  select * into v_spot from public.commerce_spots where id = v_listing.spot_id for update;
  if not found or v_spot.status <> 'active' then raise exception 'El Spot no está activo.'; end if;
  if v_spot.beneficiary_user_id is null then raise exception 'El Spot no tiene beneficiario FLOW configurado.'; end if;
  if v_spot.beneficiary_user_id = p_sender_user_id then raise exception 'No podés pagarte FLOW a vos mismo.'; end if;

  if v_qr.studio_id is not null and v_spot.studio_id is distinct from v_qr.studio_id then
    raise exception 'El QR no pertenece al Studio de este Spot.';
  end if;

  select * into v_rate
  from public.commerce_fx_rates
  where id = p_fx_rate_id and spot_id = v_spot.id
  for share;
  if not found then raise exception 'Cotización inválida para el Spot.'; end if;
  if v_rate.local_currency <> v_listing.currency or v_rate.quote_currency <> 'USD' or v_rate.local_per_quote <= 0 then
    raise exception 'La cotización no corresponde a la moneda de la publicación.';
  end if;

  v_unit_price := coalesce(v_variant.price_override, v_listing.price);
  v_total_local := v_unit_price * p_purchase_quantity;
  v_required_flow := round(v_total_local / v_rate.local_per_quote, 8);
  if v_required_flow <> trunc(v_required_flow) then
    raise exception 'El total no puede expresarse en FLOWS enteros con esta cotización.';
  end if;
  v_required_quantity := v_required_flow::integer;
  if v_required_quantity < 1 or v_required_quantity > 50 then
    raise exception 'El pago debe estar entre 1 y 50 FLOW por operación.';
  end if;

  v_fingerprint := jsonb_build_object(
    'publicToken', v_qr.public_token,
    'qrRegistryId', v_qr.id,
    'spotId', v_spot.id,
    'listingId', v_listing.id,
    'variantId', p_variant_id,
    'purchaseQuantity', p_purchase_quantity,
    'fxRateId', v_rate.id,
    'flowQuantity', v_required_quantity,
    'recipientUserId', v_spot.beneficiary_user_id,
    'rail', 'FLOW'
  );

  select * into v_op from public.flow_transfer_operations where id = p_transfer_id for update;
  if found then
    if v_op.sender_user_id <> p_sender_user_id
       or v_op.recipient_user_id <> v_spot.beneficiary_user_id
       or v_op.quantity <> v_required_quantity
       or v_op.qr_registry_id is distinct from v_qr.id
       or v_op.spot_id is distinct from v_spot.id
       or v_op.subject_type <> 'COMMERCE_QR'
       or v_op.fingerprint <> v_fingerprint then
      raise exception 'El id de transferencia ya pertenece a otra operación.';
    end if;
    if v_op.status = 'COMPLETED' and v_op.result is not null then
      return v_op.result || jsonb_build_object('duplicate', true, 'recovered', true);
    end if;
  else
    insert into public.flow_transfer_operations(
      id, sender_user_id, recipient_user_id, qr_registry_id, spot_id, quantity,
      subject_type, status, rail, fingerprint, created_by
    ) values (
      p_transfer_id, p_sender_user_id, v_spot.beneficiary_user_id, v_qr.id, v_spot.id,
      v_required_quantity, 'COMMERCE_QR', 'PENDING', 'FLOW', v_fingerprint, p_actor_id
    ) returning * into v_op;
  end if;

  v_items := jsonb_build_array(jsonb_build_object(
    'listing_id', v_listing.id,
    'variant_id', p_variant_id,
    'quantity', p_purchase_quantity
  ));

  -- The existing POS function creates/locks the order, confirms payment,
  -- records stock movements and delivers digital items. Because this call and
  -- transfer_backed_flows share this transaction, neither side can commit alone.
  v_sale := public.complete_commerce_pos_sale(
    v_spot.id,
    v_items,
    'other',
    p_customer_name,
    p_customer_email,
    p_sender_user_id,
    v_rate.id,
    p_actor_id,
    'flowqr:' || p_transfer_id::text
  );

  v_order_id := (v_sale ->> 'order_id')::uuid;
  select id into v_payment_id
  from public.commerce_payments
  where order_id = v_order_id and idempotency_key = 'flowqr:' || p_transfer_id::text
  limit 1;
  if v_payment_id is null then raise exception 'La venta FLOW no generó un pago reconciliable.'; end if;

  v_transfer := public.transfer_backed_flows(
    p_sender_user_id,
    v_spot.beneficiary_user_id,
    v_required_quantity,
    p_transfer_id,
    p_actor_id
  );

  update public.commerce_payments
  set provider = 'flow',
      external_payment_id = p_transfer_id::text,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'rail', 'FLOW', 'flowTransferId', p_transfer_id, 'qrRegistryId', v_qr.id,
        'flowQuantity', v_required_quantity
      )
  where id = v_payment_id;

  update public.commerce_flow_ledger
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'rail', 'FLOW', 'flowTransferId', p_transfer_id, 'qrRegistryId', v_qr.id,
    'flowQuantity', v_required_quantity
  )
  where payment_id = v_payment_id;

  update public.commerce_orders
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'paymentRail', 'FLOW', 'flowTransferId', p_transfer_id, 'qrRegistryId', v_qr.id
  )
  where id = v_order_id;

  update public.flow_asset_movements
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'operationId', p_transfer_id, 'qrRegistryId', v_qr.id, 'spotId', v_spot.id,
    'orderId', v_order_id, 'paymentId', v_payment_id, 'rail', 'FLOW'
  )
  where action = 'transferred' and metadata ->> 'transferId' = p_transfer_id::text;

  update public.flows_wallet_ledger
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'operationId', p_transfer_id, 'qrRegistryId', v_qr.id, 'spotId', v_spot.id,
    'orderId', v_order_id, 'paymentId', v_payment_id, 'rail', 'FLOW'
  )
  where reference_id = p_transfer_id::text
    and transaction_type in ('transfer_out','transfer_in');

  v_result := jsonb_build_object(
    'operationId', p_transfer_id,
    'transfer', v_transfer,
    'orderId', v_order_id,
    'paymentId', v_payment_id,
    'spotId', v_spot.id,
    'qrRegistryId', v_qr.id,
    'flowQuantity', v_required_quantity,
    'purchaseQuantity', p_purchase_quantity,
    'status', 'COMPLETED',
    'rail', 'FLOW',
    'duplicate', false,
    'recovered', false
  );

  update public.flow_transfer_operations
  set order_id = v_order_id, payment_id = v_payment_id, status = 'COMPLETED',
      result = v_result, completed_at = now(), updated_at = now()
  where id = p_transfer_id;

  return v_result;
end;
$$;

revoke all on function public.complete_commerce_flow_qr_sale(uuid,text,uuid,uuid,integer,uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.complete_commerce_flow_qr_sale(uuid,text,uuid,uuid,integer,uuid,uuid,uuid,text,text) to service_role;
