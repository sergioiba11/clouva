-- A pending merchant QR can hold only part of one FLOW asset. The wallet's
-- spendable base-unit balance must still reconcile against every unheld unit,
-- including units remaining on qr_payment_pending assets.

create or replace function public.hold_flow_qr_payment(
  p_operation_id uuid,
  p_user_id uuid,
  p_total_flow_units bigint,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.flow_qr_payment_operations%rowtype;
  v_player_id uuid;
  v_wallet_units bigint:=0;
  v_wallet_whole integer:=0;
  v_backed_units bigint:=0;
  v_remaining bigint;
  v_take bigint;
  v_ref numeric;
  v_release numeric;
  v_new_units bigint;
  v_new_whole integer;
  v_items integer:=0;
  r_asset record;
begin
  if p_operation_id is null or p_user_id is null or p_actor_id is null or p_actor_id<>p_user_id then raise exception 'Operación QR inválida.'; end if;
  if p_total_flow_units is null or p_total_flow_units<=0 then raise exception 'Cantidad FLOW inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flow-qr-payment:'||p_operation_id::text,0));
  select * into v_op from public.flow_qr_payment_operations where id=p_operation_id for update;
  if not found or v_op.user_id<>p_user_id then raise exception 'Operación QR inexistente.'; end if;
  if v_op.total_flow_units is distinct from p_total_flow_units then raise exception 'El monto FLOW no coincide con la cotización persistida.'; end if;
  if v_op.status in('flow_held','payment_submitted','payment_pending','payment_confirmed') then
    return jsonb_build_object('operationId',v_op.id,'status',v_op.status,'duplicate',true,'totalFlowUnits',v_op.total_flow_units);
  end if;
  if v_op.status<>'quoted' then raise exception 'La operación QR no está lista para reservar FLOW.'; end if;
  if v_op.quote_expires_at is null or v_op.quote_expires_at<=now() then
    update public.flow_qr_payment_operations set status='expired',expired_at=now(),updated_at=now(),last_error_code='quote_expired',last_safe_message='La cotización venció.' where id=v_op.id;
    raise exception 'La cotización del pago QR venció.';
  end if;
  if v_op.capability<>'PAYABLE' then raise exception 'El QR no tiene un rail pagable habilitado.'; end if;

  select id into v_player_id from public.players where id=v_op.player_id and owner_user_id=p_user_id;
  if v_player_id is null then raise exception 'El Player pagador ya no es válido.'; end if;

  insert into public.flows_wallets(user_id,balance,balance_units) values(p_user_id,0,0) on conflict(user_id) do nothing;
  select balance,balance_units into v_wallet_whole,v_wallet_units from public.flows_wallets where user_id=p_user_id for update;

  -- Reconcile against every unheld, backed base unit. Pending QR assets remain
  -- part of the user's economic balance only for their unheld remainder.
  select coalesce(sum(a.available_units-a.held_units),0)::bigint into v_backed_units
  from public.flow_assets a
  join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.custody_stage in('reserve_confirmed','allocated') and f.entry_type='reserve_deposit' and coalesce(f.reference_usd_amount,0)>0
  where a.owner_user_id=p_user_id
    and a.status in('available','activated','transferred','qr_partial','qr_payment_pending')
    and a.available_units>a.held_units
    and b.reference_usd_value-b.consumed_reference_usd_value>0;

  if v_wallet_units<>v_backed_units then raise exception 'La wallet no está reconciliada con sus unidades FLOW respaldadas.'; end if;
  if v_wallet_units<p_total_flow_units then raise exception 'Saldo FLOW respaldado insuficiente para este QR.'; end if;

  v_remaining:=p_total_flow_units;
  for r_asset in
    select a.id,a.flow_number,a.status,a.total_units,a.available_units,a.held_units,
           b.id backing_allocation_id,b.reference_usd_value,b.consumed_reference_usd_value,b.reserve_account_id,b.funding_entry_id,
           r.currency reserve_currency,f.amount funding_amount,f.reference_usd_amount funding_reference_usd
    from public.flow_assets a
    join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
    join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
    join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.custody_stage in('reserve_confirmed','allocated') and f.entry_type='reserve_deposit' and f.reference_usd_amount>0 and f.amount>0
    where a.owner_user_id=p_user_id
      and a.status in('available','activated','transferred','qr_partial')
      and a.held_units=0 and a.available_units>0
    order by (a.status='qr_partial') desc,a.flow_number
    for update of a,b,r,f
  loop
    exit when v_remaining<=0;
    v_take:=least(v_remaining,r_asset.available_units);
    v_ref:=round((r_asset.reference_usd_value-r_asset.consumed_reference_usd_value)*(v_take::numeric/r_asset.available_units::numeric),8);
    v_release:=round(v_ref*r_asset.funding_amount/r_asset.funding_reference_usd,8);
    if v_ref<=0 or v_release<=0 then raise exception 'El backing proporcional del FLOW es inválido.'; end if;

    insert into public.flow_qr_payment_items(operation_id,flow_asset_id,backing_allocation_id,reserve_account_id,funding_entry_id,held_units,previous_asset_status,reference_usd_value,reserve_currency,reserve_release_amount,metadata)
    values(v_op.id,r_asset.id,r_asset.backing_allocation_id,r_asset.reserve_account_id,r_asset.funding_entry_id,v_take,r_asset.status,v_ref,upper(r_asset.reserve_currency),v_release,jsonb_build_object('flowNumber',r_asset.flow_number));

    update public.flow_assets
    set held_units=held_units+v_take,status='qr_payment_pending',metadata=metadata||jsonb_build_object('qrPaymentOperationId',v_op.id,'qrHeldAt',now(),'qrPreviousStatus',r_asset.status)
    where id=r_asset.id;

    insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,to_user_id,from_player_id,to_player_id,created_by,metadata)
    values(r_asset.id,'qr_payment_held',p_user_id,p_user_id,v_player_id,v_player_id,p_actor_id,jsonb_build_object('operationId',v_op.id,'heldUnits',v_take,'flowNumber',r_asset.flow_number));
    v_remaining:=v_remaining-v_take;
    v_items:=v_items+1;
  end loop;
  if v_remaining<>0 then raise exception 'No se pudieron bloquear suficientes unidades FLOW respaldadas.'; end if;

  v_new_units:=v_wallet_units-p_total_flow_units;
  update public.flows_wallets set balance_units=v_new_units,updated_at=now() where user_id=p_user_id returning balance into v_new_whole;
  insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,amount_units,balance_after_units,source,reference_id,metadata,created_by)
  values(p_user_id,'qr_payment_hold',v_new_whole-v_wallet_whole,v_new_whole,-p_total_flow_units,v_new_units,'flow_universal_qr',v_op.id::text,jsonb_build_object('operationId',v_op.id,'merchant',v_op.merchant_name,'merchantAmount',v_op.merchant_amount,'merchantCurrency',v_op.merchant_currency),p_actor_id);

  update public.flow_qr_payment_operations set status='flow_held',updated_at=now(),last_error_code=null,last_safe_message=null where id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'status','flow_held','duplicate',false,'totalFlowUnits',p_total_flow_units,'heldItems',v_items,'balanceUnitsAfter',v_new_units);
end $$;

revoke all on function public.hold_flow_qr_payment(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.hold_flow_qr_payment(uuid,uuid,bigint,uuid) to service_role;
