create or replace function public.adjust_flows_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_source text default null,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns public.flows_wallet_ledger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_balance integer;
  v_new integer;
  v_row public.flows_wallet_ledger%rowtype;
  v_op public.flow_purchase_operations%rowtype;
  v_backed_count integer;
begin
  if p_amount>0 then
    if p_transaction_type<>'purchase' or p_reference_id is null then
      raise exception 'Los créditos positivos de FLOWS requieren una operación económica confirmada.';
    end if;

    begin
      select * into v_op
      from public.flow_purchase_operations
      where id=p_reference_id::uuid;
    exception when invalid_text_representation then
      raise exception 'Referencia económica de FLOW inválida.';
    end;

    if not found
       or v_op.recipient_user_id<>p_user_id
       or v_op.status<>'confirmed'
       or v_op.backing_status<>'verified'
       or v_op.issued_at is null
       or v_op.quantity<>p_amount then
      raise exception 'La emisión no tiene respaldo económico y de custodia confirmado.';
    end if;

    select count(*)::integer into v_backed_count
    from public.flow_assets a
    join public.flow_backing_allocations b
      on b.flow_asset_id=a.id and b.status='active'
    join public.flow_reserve_accounts r
      on r.id=b.reserve_account_id and r.is_active and r.status='active'
    where a.backing_operation_id=v_op.id
      and a.owner_user_id=p_user_id
      and a.status in ('available','activated','transferred');

    if v_backed_count<>p_amount then
      raise exception 'La wallet no puede acreditarse sin un respaldo 1:1 por FLOW.';
    end if;

    if exists (
      select 1
      from public.flow_reserve_accounts r
      where r.is_active
        and r.status='active'
        and public.flow_reserve_account_free_usd(r.id)<-0.000001
    ) then
      raise exception 'La reserva quedaría sobreasignada.';
    end if;
  end if;

  insert into public.flows_wallets(user_id,balance)
  values(p_user_id,0)
  on conflict(user_id) do nothing;

  select balance into v_balance
  from public.flows_wallets
  where user_id=p_user_id
  for update;

  v_new:=v_balance+p_amount;
  if v_new<0 then
    raise exception 'Saldo de Flows insuficiente.';
  end if;

  update public.flows_wallets
  set balance=v_new,updated_at=now()
  where user_id=p_user_id;

  insert into public.flows_wallet_ledger(
    user_id,transaction_type,amount,balance_after,source,reference_id,metadata,created_by
  )
  values(
    p_user_id,p_transaction_type,p_amount,v_new,p_source,p_reference_id,coalesce(p_metadata,'{}'::jsonb),p_created_by
  )
  returning * into v_row;

  return v_row;
end $$;

create or replace function public.issue_flows_for_operation(
  p_operation_id uuid,
  p_confirmed_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_price numeric;
  v_usd numeric;
  v_needed integer;
  v_allocatable integer:=0;
  v_free numeric;
  v_shortfall numeric:=0;
  v_account_id uuid;
  v_funding_entry_id uuid;
  v_asset public.flow_assets%rowtype;
  v_existing_count integer:=0;
  v_active_count integer:=0;
  v_unit integer:=0;
  r_account record;
  r_asset record;
begin
  select * into v_op
  from public.flow_purchase_operations
  where id=p_operation_id
  for update;

  if not found then
    raise exception 'Operación de FLOW inexistente.';
  end if;
  if v_op.status<>'confirmed' or v_op.confirmed_at is null then
    raise exception 'El pago real todavía no está confirmado.';
  end if;
  if v_op.status='refunded' or v_op.refund_status='reversed' then
    raise exception 'La operación fue revertida.';
  end if;

  select flow_usd_value into v_price
  from public.flow_issuance_settings
  where id='canonical';
  if v_price is null or v_price<=0 then
    raise exception 'Configuración canónica de FLOW inválida.';
  end if;

  if upper(v_op.currency)='USD' then
    if abs(v_op.unit_usd-v_price)>0.000001
       or abs(v_op.amount-(v_op.quantity*v_price))>0.01 then
      raise exception 'El importe USD no coincide con la regla canónica.';
    end if;
  else
    if v_op.fx_rate_original_per_usd is null
       or v_op.fx_rate_original_per_usd<=0
       or v_op.fx_source is null
       or v_op.fx_quoted_at is null then
      raise exception 'La moneda requiere cotización canónica.';
    end if;
    v_usd:=v_op.amount/v_op.fx_rate_original_per_usd;
    if abs(v_usd-(v_op.quantity*v_price))>0.01 then
      raise exception 'La conversión no coincide con el valor canónico de FLOW.';
    end if;
  end if;

  if not exists (
    select 1
    from public.flow_funding_ledger f
    where f.operation_id=v_op.id
      and f.entry_type='funding'
      and f.status='confirmed'
  ) then
    raise exception 'Falta el registro confirmado del pago.';
  end if;

  if not exists (
    select 1
    from public.flow_payment_documents d
    where d.operation_id=v_op.id
      and d.kind='internal_receipt'
      and d.status='issued'
  ) then
    raise exception 'Falta el comprobante interno.';
  end if;

  if v_op.operation_type='back_existing' then
    v_needed:=1;
  elsif v_op.issued_at is not null then
    select count(*)::integer into v_existing_count
    from public.flow_assets
    where operation_id=v_op.id
      and status='legacy_unverified';

    if v_existing_count=0 then
      select count(*)::integer into v_active_count
      from public.flow_assets a
      join public.flow_backing_allocations b
        on b.flow_asset_id=a.id and b.status='active'
      where a.backing_operation_id=v_op.id
        and a.status in ('available','activated','transferred');

      return jsonb_build_object(
        'operationId',v_op.id,
        'issued',v_active_count,
        'alreadyIssued',true,
        'backingStatus',v_op.backing_status
      );
    end if;
    v_needed:=v_existing_count;
  else
    v_needed:=v_op.quantity;
  end if;

  for r_account in
    select id
    from public.flow_reserve_accounts
    where is_active and status='active'
    order by id
    for update
  loop
    v_free:=greatest(public.flow_reserve_account_free_usd(r_account.id),0);
    v_allocatable:=v_allocatable+floor(v_free/v_price)::integer;
  end loop;

  if v_allocatable<v_needed then
    v_shortfall:=(v_needed-v_allocatable)*v_price;
    update public.flow_purchase_operations
    set backing_status='pending',
        metadata=(metadata - 'backingShortfallUsd') || jsonb_build_object(
          'backingShortfallUsd',v_shortfall,
          'reserveCheckedAt',now()
        ),
        updated_at=now()
    where id=v_op.id;

    return jsonb_build_object(
      'operationId',v_op.id,
      'issued',0,
      'alreadyIssued',false,
      'backingStatus','pending',
      'backingShortfallUsd',v_shortfall
    );
  end if;

  update public.flow_purchase_operations
  set backing_status='verified',
      metadata=(metadata - 'backingShortfallUsd') || jsonb_build_object('reserveVerifiedAt',now()),
      updated_at=now()
  where id=v_op.id;

  if v_op.operation_type='back_existing' then
    if v_op.target_asset_id is null or v_op.quantity<>1 then
      raise exception 'Operación de respaldo legacy inválida.';
    end if;

    select * into v_asset
    from public.flow_assets
    where id=v_op.target_asset_id
    for update;

    if not found or v_asset.owner_user_id<>v_op.recipient_user_id then
      raise exception 'FLOW legacy inválido.';
    end if;
    if v_asset.status<>'legacy_unverified' then
      raise exception 'El FLOW ya está respaldado o no admite respaldo.';
    end if;

    v_account_id:=null;
    for r_account in
      select id
      from public.flow_reserve_accounts
      where is_active and status='active'
      order by id
    loop
      if public.flow_reserve_account_free_usd(r_account.id)>=v_price then
        v_account_id:=r_account.id;
        exit;
      end if;
    end loop;
    if v_account_id is null then
      raise exception 'La reserva cambió durante la emisión.';
    end if;

    select id into v_funding_entry_id
    from public.flow_funding_ledger
    where reserve_account_id=v_account_id
      and status='confirmed'
      and custody_status='confirmed'
      and entry_type in ('funding','reserve_deposit')
    order by occurred_at desc
    limit 1;

    insert into public.flow_backing_allocations(
      flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata
    )
    values(
      v_asset.id,v_account_id,v_funding_entry_id,v_price,'active',
      jsonb_build_object('operationId',v_op.id,'reason','back_existing')
    );

    update public.flow_assets
    set status='available',
        backing_operation_id=v_op.id,
        backed_at=now(),
        metadata=metadata || jsonb_build_object(
          'backedByOperationId',v_op.id,
          'reserveAccountId',v_account_id
        )
    where id=v_asset.id;

    insert into public.flow_asset_movements(
      flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata
    )
    values(
      v_asset.id,'backed',v_asset.owner_user_id,v_asset.owner_player_id,v_op.id,p_confirmed_by,
      jsonb_build_object('reserveAccountId',v_account_id)
    );

    update public.flow_purchase_operations
    set issued_at=coalesce(issued_at,now()),updated_at=now()
    where id=v_op.id;

    perform public.adjust_flows_balance(
      v_op.recipient_user_id,
      1,
      'purchase',
      'flow_backing',
      v_op.id::text,
      jsonb_build_object(
        'operationId',v_op.id,
        'targetAssetId',v_asset.id,
        'reserveAccountId',v_account_id
      ),
      p_confirmed_by
    );

    return jsonb_build_object(
      'operationId',v_op.id,
      'issued',1,
      'alreadyIssued',false,
      'backingStatus','verified',
      'targetAssetId',v_asset.id
    );
  end if;

  if v_op.issued_at is not null and v_existing_count>0 then
    for r_asset in
      select *
      from public.flow_assets
      where operation_id=v_op.id and status='legacy_unverified'
      order by flow_number
      for update
    loop
      v_account_id:=null;
      for r_account in
        select id
        from public.flow_reserve_accounts
        where is_active and status='active'
        order by id
      loop
        if public.flow_reserve_account_free_usd(r_account.id)>=v_price then
          v_account_id:=r_account.id;
          exit;
        end if;
      end loop;
      if v_account_id is null then
        raise exception 'La reserva cambió durante la reconciliación.';
      end if;

      select id into v_funding_entry_id
      from public.flow_funding_ledger
      where reserve_account_id=v_account_id
        and status='confirmed'
        and custody_status='confirmed'
        and entry_type in ('funding','reserve_deposit')
      order by occurred_at desc
      limit 1;

      insert into public.flow_backing_allocations(
        flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata
      )
      values(
        r_asset.id,v_account_id,v_funding_entry_id,v_price,'active',
        jsonb_build_object('operationId',v_op.id,'reason','historical_reconciliation')
      );

      update public.flow_assets
      set status='available',
          backing_operation_id=v_op.id,
          backed_at=now(),
          metadata=metadata || jsonb_build_object(
            'reserveAccountId',v_account_id,
            'reconciledCustodyAt',now()
          )
      where id=r_asset.id;

      insert into public.flow_asset_movements(
        flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata
      )
      values(
        r_asset.id,'backed',r_asset.owner_user_id,r_asset.owner_player_id,v_op.id,p_confirmed_by,
        jsonb_build_object('reserveAccountId',v_account_id,'historical',true)
      );
    end loop;

    perform public.adjust_flows_balance(
      v_op.recipient_user_id,
      v_existing_count,
      'purchase',
      'reserve_reconciliation',
      v_op.id::text,
      jsonb_build_object('operationId',v_op.id,'quantity',v_existing_count),
      p_confirmed_by
    );

    perform public.flow_project_event(
      v_op.recipient_user_id,
      'flow_backed',
      'FLOW histórico reactivado después de confirmar custodia en reserva.',
      v_op.id,
      p_confirmed_by,
      jsonb_build_object('quantity',v_existing_count)
    );

    return jsonb_build_object(
      'operationId',v_op.id,
      'issued',v_existing_count,
      'alreadyIssued',false,
      'backingStatus','verified',
      'reconciled',true
    );
  end if;

  for v_unit in 1..v_op.quantity loop
    v_account_id:=null;
    for r_account in
      select id
      from public.flow_reserve_accounts
      where is_active and status='active'
      order by id
    loop
      if public.flow_reserve_account_free_usd(r_account.id)>=v_price then
        v_account_id:=r_account.id;
        exit;
      end if;
    end loop;
    if v_account_id is null then
      raise exception 'La reserva cambió durante la emisión.';
    end if;

    select id into v_funding_entry_id
    from public.flow_funding_ledger
    where reserve_account_id=v_account_id
      and status='confirmed'
      and custody_status='confirmed'
      and entry_type in ('funding','reserve_deposit')
    order by occurred_at desc
    limit 1;

    insert into public.flow_assets(
      operation_id,operation_unit,owner_user_id,owner_player_id,
      original_buyer_user_id,original_buyer_player_id,status,
      backing_operation_id,backed_at,metadata
    )
    values(
      v_op.id,v_unit,v_op.recipient_user_id,v_op.recipient_player_id,
      v_op.buyer_user_id,v_op.buyer_player_id,'available',
      v_op.id,now(),
      jsonb_build_object(
        'provider',v_op.provider,
        'paymentMethod',v_op.payment_method,
        'reserveAccountId',v_account_id
      )
    )
    returning * into v_asset;

    insert into public.flow_backing_allocations(
      flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata
    )
    values(
      v_asset.id,v_account_id,v_funding_entry_id,v_price,'active',
      jsonb_build_object('operationId',v_op.id,'operationUnit',v_unit)
    );

    insert into public.flow_asset_movements(
      flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata
    )
    values(
      v_asset.id,'issued',v_asset.owner_user_id,v_asset.owner_player_id,v_op.id,p_confirmed_by,
      jsonb_build_object('reserveAccountId',v_account_id)
    );
  end loop;

  update public.flow_purchase_operations
  set issued_at=now(),updated_at=now()
  where id=v_op.id;

  perform public.adjust_flows_balance(
    v_op.recipient_user_id,
    v_op.quantity,
    'purchase',
    case when v_op.provider='cash' then 'cash_backed' else 'flow_purchase' end,
    v_op.id::text,
    jsonb_build_object(
      'operationId',v_op.id,
      'provider',v_op.provider,
      'quantity',v_op.quantity
    ),
    p_confirmed_by
  );

  perform public.flow_project_event(
    v_op.recipient_user_id,
    'flow_issued',
    'FLOWS emitidos contra reserva real custodiada y asignada 1:1.',
    v_op.id,
    p_confirmed_by,
    jsonb_build_object('quantity',v_op.quantity,'provider',v_op.provider)
  );

  return jsonb_build_object(
    'operationId',v_op.id,
    'issued',v_op.quantity,
    'alreadyIssued',false,
    'backingStatus','verified'
  );
end $$;

create or replace function public.register_flow_cash_payment(
  p_payer_player_id uuid,
  p_recipient_player_id uuid,
  p_quantity integer,
  p_reference text,
  p_note text,
  p_idempotency_key text,
  p_confirmed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_payer public.players%rowtype;
  v_recipient public.players%rowtype;
  v_price numeric;
  v_amount numeric;
  v_op public.flow_purchase_operations%rowtype;
  v_receipt text;
begin
  if p_confirmed_by is null
     or p_quantity<1
     or p_quantity>1000
     or coalesce(trim(p_idempotency_key),'')='' then
    raise exception 'Datos de pago en efectivo inválidos.';
  end if;

  select * into v_payer from public.players where id=p_payer_player_id;
  if not found or v_payer.owner_user_id is null then
    raise exception 'Pagador sin cuenta CLOUVA.';
  end if;

  select * into v_recipient from public.players where id=p_recipient_player_id;
  if not found or v_recipient.owner_user_id is null then
    raise exception 'Receptor sin cuenta CLOUVA.';
  end if;

  select flow_usd_value into v_price
  from public.flow_issuance_settings
  where id='canonical';
  v_amount:=p_quantity*v_price;

  select * into v_op
  from public.flow_purchase_operations
  where provider_reference='cash:'||p_idempotency_key
  for update;

  if found then
    return jsonb_build_object(
      'operationId',v_op.id,
      'duplicate',true,
      'amount',v_op.amount,
      'currency',v_op.currency,
      'paymentReceived',true,
      'backingStatus',v_op.backing_status,
      'issued',v_op.issued_at is not null,
      'receiptNumber','FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12))
    );
  end if;

  insert into public.flow_purchase_operations(
    buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,
    provider,provider_reference,payment_method,quantity,unit_usd,amount,currency,
    status,backing_status,confirmed_at,created_by,operation_type,provider_fee,net_amount,metadata
  )
  values(
    v_payer.owner_user_id,v_payer.id,v_recipient.owner_user_id,v_recipient.id,
    'cash','cash:'||p_idempotency_key,'cash',p_quantity,v_price,v_amount,'USD',
    'confirmed','pending',now(),p_confirmed_by,'cash_purchase',0,v_amount,
    jsonb_build_object(
      'reference',nullif(trim(coalesce(p_reference,'')),''),
      'note',nullif(trim(coalesce(p_note,'')),''),
      'cashReceived',true,
      'reserveRequired',true
    )
  )
  returning * into v_op;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,
    idempotency_key,confirmed_by,provider_fee,net_amount,custody_status,
    reference_usd_amount,metadata
  )
  values(
    v_op.id,'funding','cash','cash',v_amount,'USD','confirmed',
    'cash-funding:'||p_idempotency_key,p_confirmed_by,0,v_amount,'not_in_reserve',
    0,jsonb_build_object(
      'cashReceived',true,
      'reference',p_reference,
      'note',p_note,
      'reserveRequired',true
    )
  );

  v_receipt:='FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12));
  insert into public.flow_payment_documents(
    operation_id,kind,provider,document_type,status,issuer,recipient,
    amount,currency,document_number,issued_at,metadata
  )
  values(
    v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',
    jsonb_build_object('name','CLOUVA'),
    jsonb_build_object(
      'userId',v_recipient.owner_user_id,
      'playerId',v_recipient.id,
      'payerPlayerId',v_payer.id
    ),
    v_amount,'USD',v_receipt,now(),
    jsonb_build_object(
      'internalOnly',true,
      'fiscalDocument',false,
      'cashReceived',true,
      'reservePending',true
    )
  );

  perform public.flow_project_event(
    v_recipient.owner_user_id,
    'cash_payment_registered',
    'Efectivo recibido. El FLOW queda pendiente hasta custodiar el respaldo en una cuenta de reserva.',
    v_op.id,
    p_confirmed_by,
    jsonb_build_object('amount',v_amount,'currency','USD')
  );

  return jsonb_build_object(
    'operationId',v_op.id,
    'duplicate',false,
    'amount',v_amount,
    'currency','USD',
    'paymentReceived',true,
    'backingStatus','pending',
    'issued',false,
    'receiptNumber',v_receipt
  );
end $$;

create or replace function public.confirm_flow_external_payment(
  p_operation_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_confirmed_at timestamptz,
  p_amount numeric,
  p_currency text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_result jsonb;
  v_fee numeric:=0;
  v_net numeric;
  v_reference_usd numeric;
  v_account public.flow_reserve_accounts%rowtype;
  v_collector text:=nullif(trim(coalesce(p_metadata->>'collectorId','')),'');
begin
  select * into v_op
  from public.flow_purchase_operations
  where id=p_operation_id
  for update;

  if not found or v_op.provider<>p_provider or v_op.status not in ('pending','confirmed') then
    raise exception 'Operación externa inválida.';
  end if;
  if abs(v_op.amount-p_amount)>0.01 or upper(v_op.currency)<>upper(p_currency) then
    raise exception 'El dinero confirmado no coincide con la operación.';
  end if;
  if exists(
    select 1
    from public.flow_purchase_operations o
    where o.provider=p_provider
      and o.provider_payment_id=p_provider_payment_id
      and o.id<>v_op.id
  ) then
    raise exception 'El payment_id ya pertenece a otra operación de FLOW.';
  end if;

  if coalesce(p_metadata->>'providerFee','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_fee:=(p_metadata->>'providerFee')::numeric;
  end if;
  v_net:=greatest(p_amount-v_fee,0);
  if coalesce(p_metadata->>'netAmount','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_net:=(p_metadata->>'netAmount')::numeric;
  end if;

  select * into v_account
  from public.flow_reserve_accounts
  where provider=p_provider
    and upper(currency)=upper(p_currency)
    and is_active
    and status='active'
    and (v_collector is null or account_reference=v_collector or account_reference is null)
  order by (account_reference=v_collector) desc nulls last, created_at
  limit 1
  for update;

  if not found then
    insert into public.flow_reserve_accounts(
      name,provider,account_type,currency,account_reference,status,is_active,metadata
    )
    values(
      case when p_provider='mercadopago'
        then 'Mercado Pago CLOUVA'
        else 'Reserva CLOUVA · '||p_provider
      end,
      p_provider,
      'digital_wallet',
      upper(p_currency),
      v_collector,
      'active',
      true,
      jsonb_build_object('createdFromVerifiedPayment',true)
    )
    returning * into v_account;
  elsif v_collector is not null and v_account.account_reference is null then
    update public.flow_reserve_accounts
    set account_reference=v_collector,updated_at=now()
    where id=v_account.id
    returning * into v_account;
  end if;

  if upper(p_currency)='USD' then
    v_reference_usd:=v_net;
  else
    if v_op.fx_rate_original_per_usd is null or v_op.fx_rate_original_per_usd<=0 then
      raise exception 'No existe FX canónico para calcular la reserva neta.';
    end if;
    v_reference_usd:=v_net/v_op.fx_rate_original_per_usd;
  end if;

  update public.flow_purchase_operations
  set status='confirmed',
      backing_status='pending',
      provider_payment_id=p_provider_payment_id,
      confirmed_at=coalesce(p_confirmed_at,now()),
      provider_fee=v_fee,
      net_amount=v_net,
      metadata=metadata || jsonb_build_object(
        'reserveAccountId',v_account.id,
        'custodyConfirmed',true
      ),
      updated_at=now()
  where id=v_op.id;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,
    external_payment_id,idempotency_key,occurred_at,provider_fee,net_amount,
    reserve_account_id,custody_status,custody_reference,custody_confirmed_at,
    reference_usd_amount,metadata
  )
  values(
    v_op.id,'funding',v_op.provider,v_op.payment_method,v_op.amount,upper(v_op.currency),'confirmed',
    p_provider_payment_id,p_idempotency_key,coalesce(p_confirmed_at,now()),v_fee,v_net,
    v_account.id,'confirmed',p_provider_payment_id,coalesce(p_confirmed_at,now()),
    v_reference_usd,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(idempotency_key) do nothing;

  insert into public.flow_payment_documents(
    operation_id,kind,provider,document_type,status,issuer,recipient,
    amount,currency,document_number,issued_at,metadata
  )
  values(
    v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',
    jsonb_build_object('name','CLOUVA'),
    jsonb_build_object('userId',v_op.recipient_user_id,'playerId',v_op.recipient_player_id),
    v_op.amount,upper(v_op.currency),
    'FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12)),
    coalesce(p_confirmed_at,now()),
    jsonb_build_object(
      'internalOnly',true,
      'fiscalDocument',false,
      'providerPaymentId',p_provider_payment_id,
      'providerFee',v_fee,
      'netAmount',v_net,
      'reserveAccountId',v_account.id
    )
  )
  on conflict(operation_id,kind,provider) do nothing;

  perform public.flow_project_event(
    v_op.recipient_user_id,
    'payment_confirmed',
    'Pago confirmado y custodiado en una cuenta de reserva FLOW.',
    v_op.id,
    null,
    jsonb_build_object(
      'provider',v_op.provider,
      'amount',v_op.amount,
      'currency',v_op.currency,
      'providerFee',v_fee,
      'netAmount',v_net,
      'referenceUsdAmount',v_reference_usd,
      'reserveAccountId',v_account.id
    )
  );

  select public.issue_flows_for_operation(v_op.id,null) into v_result;
  return v_result;
end $$;

create or replace function public.confirm_flow_reserve_deposit(
  p_operation_id uuid,
  p_reserve_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference_usd_amount numeric,
  p_custody_reference text,
  p_occurred_at timestamptz,
  p_idempotency_key text,
  p_confirmed_by uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_account public.flow_reserve_accounts%rowtype;
  v_existing public.flow_funding_ledger%rowtype;
  v_entry public.flow_funding_ledger%rowtype;
  v_result jsonb;
begin
  if p_confirmed_by is null
     or p_amount<=0
     or p_reference_usd_amount<=0
     or coalesce(trim(p_idempotency_key),'')='' then
    raise exception 'Depósito de reserva inválido.';
  end if;

  select * into v_op
  from public.flow_purchase_operations
  where id=p_operation_id
  for update;
  if not found or v_op.status<>'confirmed' or v_op.status='refunded' then
    raise exception 'La operación no admite respaldo.';
  end if;

  select * into v_account
  from public.flow_reserve_accounts
  where id=p_reserve_account_id
    and is_active
    and status='active'
  for update;
  if not found then
    raise exception 'Cuenta de reserva inválida.';
  end if;
  if upper(v_account.currency)<>upper(p_currency) then
    raise exception 'La moneda del depósito no coincide con la cuenta de reserva.';
  end if;

  select * into v_existing
  from public.flow_funding_ledger
  where idempotency_key=p_idempotency_key;
  if found then
    select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
    return jsonb_build_object(
      'duplicate',true,
      'fundingEntryId',v_existing.id,
      'operationId',v_op.id,
      'issued',v_result
    );
  end if;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,
    idempotency_key,confirmed_by,occurred_at,provider_fee,net_amount,
    reserve_account_id,custody_status,custody_reference,custody_confirmed_at,
    reference_usd_amount,metadata
  )
  values(
    v_op.id,'reserve_deposit',v_account.provider,'reserve_deposit',p_amount,upper(p_currency),'confirmed',
    p_idempotency_key,p_confirmed_by,coalesce(p_occurred_at,now()),0,p_amount,
    v_account.id,'confirmed',nullif(trim(coalesce(p_custody_reference,'')),''),
    coalesce(p_occurred_at,now()),p_reference_usd_amount,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('operationId',v_op.id)
  )
  returning * into v_entry;

  update public.flow_purchase_operations
  set backing_status='pending',updated_at=now()
  where id=v_op.id and backing_status<>'verified';

  select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;

  perform public.flow_project_event(
    v_op.recipient_user_id,
    'reserve_deposit_confirmed',
    'Depósito confirmado en una cuenta de reserva FLOW.',
    v_op.id,
    p_confirmed_by,
    jsonb_build_object(
      'reserveAccountId',v_account.id,
      'referenceUsdAmount',p_reference_usd_amount,
      'fundingEntryId',v_entry.id
    )
  );

  return jsonb_build_object(
    'duplicate',false,
    'fundingEntryId',v_entry.id,
    'operationId',v_op.id,
    'issued',v_result
  );
end $$;

create or replace function public.record_flow_reserve_release(
  p_reserve_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference_usd_amount numeric,
  p_custody_reference text,
  p_idempotency_key text,
  p_confirmed_by uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_account public.flow_reserve_accounts%rowtype;
  v_free numeric;
  v_entry public.flow_funding_ledger%rowtype;
begin
  if p_confirmed_by is null or p_amount<=0 or p_reference_usd_amount<=0 then
    raise exception 'Salida de reserva inválida.';
  end if;

  select * into v_account
  from public.flow_reserve_accounts
  where id=p_reserve_account_id
    and is_active
    and status='active'
  for update;
  if not found then
    raise exception 'Cuenta de reserva inválida.';
  end if;
  if upper(v_account.currency)<>upper(p_currency) then
    raise exception 'Moneda de reserva inválida.';
  end if;

  v_free:=public.flow_reserve_account_free_usd(v_account.id);
  if p_reference_usd_amount>v_free+0.000001 then
    raise exception 'La salida supera la reserva libre. No se puede tocar el respaldo asignado a FLOWS.';
  end if;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,
    idempotency_key,confirmed_by,provider_fee,net_amount,reserve_account_id,
    custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,metadata
  )
  values(
    null,'reserve_release',v_account.provider,'reserve_release',p_amount,upper(p_currency),'confirmed',
    p_idempotency_key,p_confirmed_by,0,p_amount,v_account.id,
    'released',nullif(trim(coalesce(p_custody_reference,'')),''),now(),
    p_reference_usd_amount,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(idempotency_key)
  do update set idempotency_key=excluded.idempotency_key
  returning * into v_entry;

  return jsonb_build_object(
    'fundingEntryId',v_entry.id,
    'reserveAccountId',v_account.id,
    'releasedUsd',p_reference_usd_amount,
    'freeUsdAfter',public.flow_reserve_account_free_usd(v_account.id)
  );
end $$;

create or replace function public.record_flow_refund(
  p_operation_id uuid,
  p_provider_payment_id text,
  p_amount numeric,
  p_currency text,
  p_reason text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_funding public.flow_funding_ledger%rowtype;
  v_refund public.flow_funding_ledger%rowtype;
  v_case public.flow_refund_cases%rowtype;
  v_assets jsonb;
  v_asset_count integer:=0;
  v_recoverable integer:=0;
  v_owner uuid;
  v_wallet integer:=0;
  v_auto_reversed boolean:=false;
  v_ref_usd numeric:=0;
begin
  select * into v_op
  from public.flow_purchase_operations
  where id=p_operation_id
  for update;

  if not found
     or abs(v_op.amount-p_amount)>0.01
     or upper(v_op.currency)<>upper(p_currency) then
    raise exception 'Reembolso inválido.';
  end if;

  if v_op.status='refunded' then
    select * into v_case
    from public.flow_refund_cases
    where operation_id=v_op.id;

    return jsonb_build_object(
      'operationId',v_op.id,
      'refundCaseId',v_case.id,
      'status',coalesce(v_case.status,'pending_review'),
      'alreadyRecorded',true
    );
  end if;

  select * into v_funding
  from public.flow_funding_ledger
  where operation_id=v_op.id
    and entry_type='funding'
    and status='confirmed'
  order by created_at
  limit 1
  for update;

  if not found then
    raise exception 'No existe pago confirmado para revertir.';
  end if;

  v_ref_usd:=coalesce(v_funding.reference_usd_amount,0);

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,
    external_payment_id,idempotency_key,reverses_entry_id,provider_fee,net_amount,
    reserve_account_id,custody_status,custody_reference,custody_confirmed_at,
    reference_usd_amount,metadata
  )
  values(
    v_op.id,'refund',v_op.provider,v_op.payment_method,p_amount,upper(p_currency),'confirmed',
    p_provider_payment_id,p_idempotency_key,v_funding.id,0,p_amount,
    v_funding.reserve_account_id,
    case when v_funding.reserve_account_id is null then 'not_in_reserve' else 'released' end,
    p_provider_payment_id,now(),v_ref_usd,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('reason',p_reason)
  )
  on conflict(idempotency_key)
  do update set idempotency_key=excluded.idempotency_key
  returning * into v_refund;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'flowAssetId',id,
      'flowNumber',flow_number,
      'status',status,
      'ownerUserId',owner_user_id,
      'ownerPlayerId',owner_player_id
    )),'[]'::jsonb),
    count(*)::integer,
    count(*) filter(where status in ('available','activated','transferred'))::integer,
    min(owner_user_id::text)::uuid
  into v_assets,v_asset_count,v_recoverable,v_owner
  from public.flow_assets
  where backing_operation_id=v_op.id
    and status<>'reversed';

  if v_asset_count>0
     and v_recoverable=v_asset_count
     and not exists(
       select 1
       from public.flow_assets
       where backing_operation_id=v_op.id
         and status<>'reversed'
         and owner_user_id<>v_owner
     ) then
    select balance into v_wallet
    from public.flows_wallets
    where user_id=v_owner
    for update;
    v_wallet:=coalesce(v_wallet,0);

    if v_wallet>=v_asset_count then
      perform public.adjust_flows_balance(
        v_owner,
        -v_asset_count,
        'refund',
        'flow_refund',
        v_op.id::text,
        jsonb_build_object(
          'operationId',v_op.id,
          'reason',p_reason,
          'quantity',v_asset_count
        ),
        null
      );
      v_auto_reversed:=true;
    end if;
  end if;

  update public.flow_backing_allocations b
  set status='reversed',
      released_at=now(),
      metadata=metadata || jsonb_build_object(
        'refundOperationId',v_op.id,
        'reason',p_reason
      )
  where b.status='active'
    and exists(
      select 1
      from public.flow_assets a
      where a.id=b.flow_asset_id
        and a.backing_operation_id=v_op.id
    );

  update public.flow_assets
  set status='reversed',
      metadata=metadata || jsonb_build_object(
        'reversedByOperationId',v_op.id,
        'refundReason',p_reason
      )
  where backing_operation_id=v_op.id
    and status<>'reversed';

  insert into public.flow_asset_movements(
    flow_asset_id,action,from_user_id,from_player_id,operation_id,metadata
  )
  select
    id,'reversal',owner_user_id,owner_player_id,v_op.id,
    jsonb_build_object('reason',p_reason,'autoWalletDebit',v_auto_reversed)
  from public.flow_assets
  where backing_operation_id=v_op.id;

  update public.flow_purchase_operations
  set status='refunded',
      backing_status='reversed',
      refund_status=case
        when v_auto_reversed or v_asset_count=0 then 'reversed'
        else 'pending_review'
      end,
      updated_at=now()
  where id=v_op.id;

  insert into public.flow_refund_cases(
    operation_id,funding_entry_id,provider_refund_id,amount,currency,status,
    reason,affected_assets,metadata,resolved_at
  )
  values(
    v_op.id,v_refund.id,p_provider_payment_id,p_amount,upper(p_currency),
    case when v_auto_reversed or v_asset_count=0 then 'reversed' else 'pending_review' end,
    p_reason,v_assets,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('autoWalletDebit',v_auto_reversed),
    case when v_auto_reversed or v_asset_count=0 then now() else null end
  )
  on conflict(operation_id)
  do update set
    funding_entry_id=excluded.funding_entry_id,
    provider_refund_id=excluded.provider_refund_id,
    status=excluded.status,
    reason=excluded.reason,
    affected_assets=excluded.affected_assets,
    metadata=public.flow_refund_cases.metadata || excluded.metadata,
    resolved_at=excluded.resolved_at
  returning * into v_case;

  perform public.flow_project_event(
    v_op.recipient_user_id,
    'payment_refunded',
    'Reembolso registrado; respaldo y FLOWS asociados fueron revertidos de forma auditable.',
    v_op.id,
    null,
    jsonb_build_object(
      'refundCaseId',v_case.id,
      'affectedAssets',v_assets,
      'autoWalletDebit',v_auto_reversed
    )
  );

  return jsonb_build_object(
    'operationId',v_op.id,
    'refundCaseId',v_case.id,
    'status',v_case.status,
    'autoWalletDebit',v_auto_reversed,
    'requiresAssetReview',not (v_auto_reversed or v_asset_count=0)
  );
end $$;

create or replace function public.flow_treasury_snapshot()
returns jsonb
language sql
security definer
set search_path='public'
as $$
with settings as (
  select flow_usd_value
  from public.flow_issuance_settings
  where id='canonical'
), reserve as (
  select
    coalesce(sum(reference_usd_amount) filter(
      where status='confirmed'
        and custody_status='confirmed'
        and entry_type in ('funding','reserve_deposit')
    ),0)
    - coalesce(sum(reference_usd_amount) filter(
      where status='confirmed'
        and entry_type in ('refund','reversal','reserve_release')
        and custody_status in ('confirmed','released','reversed')
    ),0) total_reserve
  from public.flow_funding_ledger
), allocated as (
  select coalesce(sum(reference_usd_value),0) allocated_reserve
  from public.flow_backing_allocations
  where status='active'
), counts as (
  select
    (
      select count(*)
      from public.flow_assets a
      where a.status in('available','activated','transferred')
        and exists(
          select 1
          from public.flow_backing_allocations b
          where b.flow_asset_id=a.id and b.status='active'
        )
    )::integer backed_assets,
    (
      select count(*)
      from public.flow_assets a
      where a.status='legacy_unverified'
         or (
           a.status in('available','activated','transferred')
           and not exists(
             select 1
             from public.flow_backing_allocations b
             where b.flow_asset_id=a.id and b.status='active'
           )
         )
    )::integer unbacked_assets,
    (select coalesce(sum(balance),0) from public.flows_wallets)::integer circulation,
    (select count(*) from public.flow_purchase_operations where status='pending')::integer pending_purchases,
    (select count(*) from public.flow_purchase_operations where status='confirmed')::integer confirmed_purchases,
    (select count(*) from public.flow_purchase_operations where status='failed')::integer failed_purchases,
    (select count(*) from public.flow_purchase_operations where issued_at is not null)::integer emissions,
    (select count(*) from public.flow_refund_cases)::integer refund_cases,
    (select count(*) from public.flow_refund_cases where status='pending_review')::integer refund_reviews,
    (
      (select count(*) from public.flow_assets where status='legacy_unverified')
      + (select coalesce(sum(quantity),0) from public.flow_purchase_operations where status='confirmed' and backing_status='pending' and issued_at is null)
    )::integer pending_backing_flows
), money as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'currency',currency,
      'grossConfirmed',gross_confirmed,
      'providerFees',provider_fees,
      'netConfirmed',net_confirmed,
      'refunds',refunds
    ) order by currency
  ),'[]'::jsonb) rows
  from (
    select
      currency,
      coalesce(sum(amount) filter(where entry_type='funding' and status='confirmed'),0) gross_confirmed,
      coalesce(sum(provider_fee) filter(where entry_type='funding' and status='confirmed'),0) provider_fees,
      coalesce(sum(coalesce(net_amount,amount)) filter(where entry_type='funding' and status='confirmed'),0) net_confirmed,
      coalesce(sum(amount) filter(where entry_type='refund' and status='confirmed'),0) refunds
    from public.flow_funding_ledger
    group by currency
  ) q
)
select jsonb_build_object(
  'flowUsdValue',(select flow_usd_value from settings),
  'backedAssets',counts.backed_assets,
  'circulation',counts.circulation,
  'unbackedAssets',counts.unbacked_assets,
  'backingDifferenceFlows',counts.backed_assets-counts.circulation,
  'pendingBackingFlows',counts.pending_backing_flows,
  'totalReserveUsd',reserve.total_reserve,
  'allocatedReserveUsd',allocated.allocated_reserve,
  'freeReserveUsd',reserve.total_reserve-allocated.allocated_reserve,
  'pendingPurchases',counts.pending_purchases,
  'confirmedPurchases',counts.confirmed_purchases,
  'failedPurchases',counts.failed_purchases,
  'emissions',counts.emissions,
  'refundCases',counts.refund_cases,
  'refundReviews',counts.refund_reviews,
  'fundingByCurrency',money.rows
)
from counts,money,reserve,allocated;
$$;

create or replace function public.flow_reconciliation_report()
returns jsonb
language sql
security definer
set search_path='public'
as $$
with issues as (
  select
    'spendable_without_backing_allocation'::text issue_type,
    'critical'::text severity,
    a.id::text entity_id,
    jsonb_build_object('flowNumber',a.flow_number,'status',a.status) details
  from public.flow_assets a
  where a.status in('available','activated','transferred')
    and not exists(
      select 1
      from public.flow_backing_allocations b
      where b.flow_asset_id=a.id and b.status='active'
    )

  union all

  select
    'spendable_with_invalid_reserve',
    'critical',
    a.id::text,
    jsonb_build_object('flowNumber',a.flow_number,'reserveAccountId',b.reserve_account_id)
  from public.flow_assets a
  join public.flow_backing_allocations b
    on b.flow_asset_id=a.id and b.status='active'
  left join public.flow_reserve_accounts r
    on r.id=b.reserve_account_id
  where a.status in('available','activated','transferred')
    and (r.id is null or not r.is_active or r.status<>'active')

  union all

  select
    'reserve_overallocated',
    'critical',
    r.id::text,
    jsonb_build_object('name',r.name,'freeUsd',public.flow_reserve_account_free_usd(r.id))
  from public.flow_reserve_accounts r
  where public.flow_reserve_account_free_usd(r.id)<-0.000001

  union all

  select
    'custody_confirmed_without_account',
    'critical',
    f.id::text,
    jsonb_build_object('operationId',f.operation_id,'entryType',f.entry_type)
  from public.flow_funding_ledger f
  where f.status='confirmed'
    and f.custody_status='confirmed'
    and f.reserve_account_id is null

  union all

  select
    'active_allocation_on_nonspendable_asset',
    'critical',
    b.id::text,
    jsonb_build_object(
      'flowAssetId',a.id,
      'flowNumber',a.flow_number,
      'assetStatus',a.status
    )
  from public.flow_backing_allocations b
  join public.flow_assets a on a.id=b.flow_asset_id
  where b.status='active'
    and a.status not in('available','activated','transferred')

  union all

  select
    'wallet_backing_mismatch',
    'critical',
    w.user_id::text,
    jsonb_build_object('walletBalance',w.balance,'backedAssets',coalesce(x.backed,0))
  from public.flows_wallets w
  left join lateral(
    select count(*)::integer backed
    from public.flow_assets a
    where a.owner_user_id=w.user_id
      and a.status in('available','activated','transferred')
      and exists(
        select 1
        from public.flow_backing_allocations b
        where b.flow_asset_id=a.id and b.status='active'
      )
  ) x on true
  where w.balance<>coalesce(x.backed,0)

  union all

  select
    'wallet_ledger_mismatch',
    'critical',
    w.user_id::text,
    jsonb_build_object('walletBalance',w.balance,'ledgerSum',coalesce(x.total,0))
  from public.flows_wallets w
  left join lateral(
    select sum(l.amount)::integer total
    from public.flows_wallet_ledger l
    where l.user_id=w.user_id
  ) x on true
  where w.balance<>coalesce(x.total,0)

  union all

  select
    'legacy_unverified',
    'warning',
    a.id::text,
    jsonb_build_object('flowNumber',a.flow_number,'ownerUserId',a.owner_user_id)
  from public.flow_assets a
  where a.status='legacy_unverified'

  union all

  select
    'confirmed_pending_backing',
    'warning',
    o.id::text,
    jsonb_build_object(
      'provider',o.provider,
      'quantity',o.quantity,
      'issuedAt',o.issued_at,
      'shortfallUsd',o.metadata->'backingShortfallUsd'
    )
  from public.flow_purchase_operations o
  where o.status='confirmed'
    and o.backing_status in('pending','legacy_unverified')

  union all

  select
    'stale_pending_purchase',
    'warning',
    o.id::text,
    jsonb_build_object(
      'createdAt',o.created_at,
      'provider',o.provider,
      'operationType',o.operation_type
    )
  from public.flow_purchase_operations o
  where o.status='pending'
    and o.created_at<now()-interval '24 hours'

  union all

  select
    'duplicate_provider_payment',
    'critical',
    min(o.id::text),
    jsonb_build_object(
      'provider',o.provider,
      'providerPaymentId',o.provider_payment_id,
      'count',count(*)
    )
  from public.flow_purchase_operations o
  where o.provider_payment_id is not null
  group by o.provider,o.provider_payment_id
  having count(*)>1

  union all

  select
    'duplicate_funding_payment',
    'critical',
    min(f.id::text),
    jsonb_build_object(
      'provider',f.provider,
      'externalPaymentId',f.external_payment_id,
      'count',count(*)
    )
  from public.flow_funding_ledger f
  where f.entry_type='funding'
    and f.external_payment_id is not null
  group by f.provider,f.external_payment_id
  having count(*)>1
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'type',issue_type,
      'severity',severity,
      'entityId',entity_id,
      'details',details
    ) order by severity,issue_type
  ),
  '[]'::jsonb
)
from issues;
$$;

revoke all on function public.confirm_flow_reserve_deposit(
  uuid,uuid,numeric,text,numeric,text,timestamptz,text,uuid,jsonb
) from public, anon, authenticated;

revoke all on function public.record_flow_reserve_release(
  uuid,numeric,text,numeric,text,text,uuid,jsonb
) from public, anon, authenticated;
