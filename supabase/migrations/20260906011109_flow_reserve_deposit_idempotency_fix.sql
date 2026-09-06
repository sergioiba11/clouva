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
  v_expected_reference_usd numeric;
  v_existing_reference_usd numeric:=0;
  v_total_reference_usd numeric:=0;
  v_processor_net_usd numeric:=0;
  v_required_transfer_usd numeric:=0;
begin
  if p_confirmed_by is null or p_amount<=0 or p_reference_usd_amount<=0 or coalesce(trim(p_idempotency_key),'')='' or coalesce(trim(p_custody_reference),'')='' then
    raise exception 'Depósito de Reserva inválido: requiere importe, referencia real e idempotencia.';
  end if;

  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found or v_op.status<>'confirmed' or v_op.status='refunded' then raise exception 'La operación no admite respaldo.'; end if;

  select * into v_account from public.flow_reserve_accounts
    where id=p_reserve_account_id and flow_account_role='reserve' and authorized_for_flow and account_reference is not null and is_active and status='active' for update;
  if not found then raise exception 'Cuenta de Reserva CLOUVA no autorizada.'; end if;
  if upper(v_account.currency)<>upper(p_currency) then raise exception 'La moneda del depósito no coincide con la cuenta de Reserva.'; end if;

  if upper(p_currency)='USD' then
    v_expected_reference_usd:=p_amount;
  elsif upper(p_currency)=upper(v_op.currency) and v_op.fx_rate_original_per_usd is not null and v_op.fx_rate_original_per_usd>0 then
    v_expected_reference_usd:=p_amount/v_op.fx_rate_original_per_usd;
  else
    raise exception 'No existe un FX histórico de la operación para valorar esta moneda de Reserva.';
  end if;

  if abs(v_expected_reference_usd-p_reference_usd_amount)>0.02 then
    raise exception 'El equivalente USD no coincide con el FX histórico o con el importe realmente depositado.';
  end if;

  select * into v_existing from public.flow_funding_ledger where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.operation_id is distinct from v_op.id or v_existing.reserve_account_id is distinct from v_account.id
       or abs(v_existing.amount-p_amount)>0.01 or upper(v_existing.currency)<>upper(p_currency)
       or abs(coalesce(v_existing.reference_usd_amount,0)-p_reference_usd_amount)>0.02 then
      raise exception 'La clave de depósito ya pertenece a otro movimiento.';
    end if;

    if v_op.backing_status='verified' and v_op.issued_at is not null then
      v_result:=jsonb_build_object('operationId',v_op.id,'issued',v_op.quantity,'alreadyIssued',true,'backingStatus','verified');
      return jsonb_build_object('duplicate',true,'fundingEntryId',v_existing.id,'operationId',v_op.id,'issued',v_result);
    end if;

    select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
    return jsonb_build_object('duplicate',true,'fundingEntryId',v_existing.id,'operationId',v_op.id,'issued',v_result);
  end if;

  select coalesce(sum(reference_usd_amount),0) into v_existing_reference_usd
  from public.flow_funding_ledger
  where operation_id=v_op.id and entry_type='reserve_deposit' and status='confirmed'
    and custody_status='confirmed' and custody_stage in ('reserve_confirmed','allocated');

  v_total_reference_usd:=v_existing_reference_usd+p_reference_usd_amount;
  if v_total_reference_usd>v_op.required_backing_usd+0.02 then
    raise exception 'No se puede confirmar más backing que el requerido por la operación.';
  end if;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,confirmed_by,occurred_at,
    provider_fee,net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage,metadata
  )
  values(
    v_op.id,'reserve_deposit',v_account.provider,'reserve_deposit',p_amount,upper(p_currency),'confirmed',p_idempotency_key,p_confirmed_by,
    coalesce(p_occurred_at,now()),0,p_amount,v_account.id,'confirmed',trim(p_custody_reference),coalesce(p_occurred_at,now()),
    p_reference_usd_amount,'reserve_confirmed',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'operationId',v_op.id,
      'historicalFxRate',v_op.fx_rate_original_per_usd,
      'historicalFxSource',v_op.fx_source,
      'historicalFxQuotedAt',v_op.fx_quoted_at
    )
  )
  returning * into v_entry;

  if v_op.provider='mercadopago' then
    if coalesce(v_op.metadata->>'processorNetReferenceUsd','') ~ '^[0-9]+([.][0-9]+)?$' then
      v_processor_net_usd:=(v_op.metadata->>'processorNetReferenceUsd')::numeric;
    elsif v_op.net_amount is not null then
      if upper(v_op.currency)='USD' then
        v_processor_net_usd:=v_op.net_amount;
      elsif v_op.fx_rate_original_per_usd is not null and v_op.fx_rate_original_per_usd>0 then
        v_processor_net_usd:=v_op.net_amount/v_op.fx_rate_original_per_usd;
      end if;
    end if;
    v_required_transfer_usd:=least(v_op.required_backing_usd,greatest(v_processor_net_usd,0));
  else
    v_required_transfer_usd:=v_op.required_backing_usd;
  end if;

  update public.flow_funding_ledger
  set custody_stage=case when v_total_reference_usd+0.000001>=v_required_transfer_usd and v_required_transfer_usd>0 then 'reserve_confirmed' else 'transfer_pending' end,
      metadata=metadata||jsonb_build_object('reserveTransferredReferenceUsd',v_total_reference_usd,'reserveRequiredTransferUsd',v_required_transfer_usd)
  where operation_id=v_op.id and entry_type='funding' and status='confirmed' and custody_stage not in ('allocated','reversed','refunded');

  update public.flow_purchase_operations
  set backing_status='pending',
      metadata=metadata||jsonb_build_object(
        'paymentStage',case when v_total_reference_usd+0.000001>=v_required_transfer_usd and v_required_transfer_usd>0 then 'reserve_confirmed' else 'transfer_pending' end,
        'reserveTransferredReferenceUsd',v_total_reference_usd
      ),
      updated_at=now()
  where id=v_op.id and backing_status<>'verified';

  select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;

  if coalesce(v_result->>'backingStatus','')='verified' then
    update public.flow_funding_ledger
    set custody_stage='allocated'
    where operation_id=v_op.id and entry_type in ('funding','reserve_deposit') and custody_stage not in ('reversed','refunded');

    update public.flow_purchase_operations
    set metadata=metadata||jsonb_build_object('paymentStage','allocated'),updated_at=now()
    where id=v_op.id;
  end if;

  perform public.flow_project_event(
    v_op.recipient_user_id,
    'reserve_deposit_confirmed',
    'Ingreso real confirmado en la Reserva CLOUVA.',
    v_op.id,
    p_confirmed_by,
    jsonb_build_object(
      'reserveAccountId',v_account.id,
      'referenceUsdAmount',p_reference_usd_amount,
      'fundingEntryId',v_entry.id,
      'custodyReference',trim(p_custody_reference)
    )
  );

  return jsonb_build_object('duplicate',false,'fundingEntryId',v_entry.id,'operationId',v_op.id,'issued',v_result);
end $$;

revoke all on function public.confirm_flow_reserve_deposit(uuid,uuid,numeric,text,numeric,text,timestamptz,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_flow_reserve_deposit(uuid,uuid,numeric,text,numeric,text,timestamptz,text,uuid,jsonb) to service_role;
