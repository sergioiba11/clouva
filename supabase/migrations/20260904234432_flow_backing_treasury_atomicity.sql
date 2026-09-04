begin;

alter table public.flow_purchase_operations
  add column if not exists operation_type text not null default 'purchase_new',
  add column if not exists target_asset_id uuid references public.flow_assets(id) on delete restrict,
  add column if not exists fx_pair text,
  add column if not exists provider_fee numeric(14,2) not null default 0,
  add column if not exists net_amount numeric(14,2);

update public.flow_purchase_operations
set operation_type = case when provider='cash' then 'cash_purchase' else 'purchase_new' end
where operation_type is null or operation_type='purchase_new';

update public.flow_purchase_operations
set net_amount = greatest(amount - coalesce(provider_fee,0),0)
where net_amount is null;

alter table public.flow_purchase_operations drop constraint if exists flow_purchase_operations_type_check;
alter table public.flow_purchase_operations add constraint flow_purchase_operations_type_check
  check(operation_type in ('purchase_new','back_existing','cash_purchase'));
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_operations_provider_fee_check;
alter table public.flow_purchase_operations add constraint flow_purchase_operations_provider_fee_check check(provider_fee>=0);
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_operations_net_amount_check;
alter table public.flow_purchase_operations add constraint flow_purchase_operations_net_amount_check check(net_amount is null or net_amount>=0);
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_operations_target_check;
alter table public.flow_purchase_operations add constraint flow_purchase_operations_target_check
  check((operation_type='back_existing' and target_asset_id is not null and quantity=1) or (operation_type<>'back_existing' and target_asset_id is null));

create unique index if not exists flow_purchase_active_backing_target_uidx
  on public.flow_purchase_operations(target_asset_id)
  where operation_type='back_existing' and target_asset_id is not null and status in ('pending','confirmed');

alter table public.flow_assets
  add column if not exists backing_operation_id uuid references public.flow_purchase_operations(id) on delete restrict,
  add column if not exists backed_at timestamptz;

update public.flow_assets a
set backing_operation_id=a.operation_id,
    backed_at=coalesce(a.backed_at,a.issued_at)
from public.flow_purchase_operations o
where o.id=a.operation_id
  and a.backing_operation_id is null
  and o.status='confirmed'
  and o.backing_status='verified'
  and exists(
    select 1 from public.flow_funding_ledger f
    where f.operation_id=o.id and f.entry_type='funding' and f.status='confirmed'
      and f.amount=o.amount and upper(f.currency)=upper(o.currency)
  );

alter table public.flow_funding_ledger
  add column if not exists provider_fee numeric(14,2) not null default 0,
  add column if not exists net_amount numeric(14,2);
update public.flow_funding_ledger
set net_amount=case when entry_type='funding' then greatest(amount-coalesce(provider_fee,0),0) else amount end
where net_amount is null;
alter table public.flow_funding_ledger drop constraint if exists flow_funding_provider_fee_check;
alter table public.flow_funding_ledger add constraint flow_funding_provider_fee_check check(provider_fee>=0);
alter table public.flow_funding_ledger drop constraint if exists flow_funding_net_amount_check;
alter table public.flow_funding_ledger add constraint flow_funding_net_amount_check check(net_amount is null or net_amount>=0);

create unique index if not exists flow_funding_provider_payment_uidx
  on public.flow_funding_ledger(provider,external_payment_id)
  where entry_type='funding' and external_payment_id is not null;

create unique index if not exists flows_wallet_refund_reference_uidx
  on public.flows_wallet_ledger(reference_id)
  where transaction_type='refund' and source='flow_refund' and reference_id is not null;

alter table public.flow_asset_movements drop constraint if exists flow_asset_movements_action_check;
alter table public.flow_asset_movements add constraint flow_asset_movements_action_check
  check(action in('issued','backed','activated','transferred','refund','reversal'));

revoke insert,update,delete on public.flows_wallets from anon,authenticated;
revoke insert,update,delete on public.flows_wallet_ledger from anon,authenticated;
revoke insert,update,delete on public.flow_assets from anon,authenticated;
revoke insert,update,delete on public.flow_asset_movements from anon,authenticated;
revoke insert,update,delete on public.flow_purchase_operations from anon,authenticated;

create or replace function public.guard_flow_asset_backing()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_op public.flow_purchase_operations%rowtype;
begin
  if new.status in('available','activated','transferred') then
    if new.backing_operation_id is null then raise exception 'Un FLOW disponible requiere una operación de respaldo.'; end if;
    select * into v_op from public.flow_purchase_operations where id=new.backing_operation_id;
    if not found or v_op.status<>'confirmed' or v_op.backing_status<>'verified' or v_op.confirmed_at is null then
      raise exception 'El FLOW no tiene respaldo económico confirmado.';
    end if;
    if not exists(
      select 1 from public.flow_funding_ledger f
      where f.operation_id=v_op.id and f.entry_type='funding' and f.status='confirmed'
        and f.amount=v_op.amount and upper(f.currency)=upper(v_op.currency)
    ) then raise exception 'El FLOW no tiene un ingreso económico confirmado.'; end if;
  end if;
  return new;
end $$;

drop trigger if exists flow_assets_backing_guard on public.flow_assets;
create trigger flow_assets_backing_guard
before insert or update of status,backing_operation_id,operation_id on public.flow_assets
for each row execute function public.guard_flow_asset_backing();
revoke all on function public.guard_flow_asset_backing() from public,anon,authenticated;

create or replace function public.issue_flows_for_operation(p_operation_id uuid,p_confirmed_by uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_count integer;
  v_price numeric;
  v_usd numeric;
  v_asset public.flow_assets%rowtype;
begin
  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found then raise exception 'Operación de FLOW inexistente.'; end if;
  if v_op.status<>'confirmed' or v_op.confirmed_at is null or v_op.backing_status<>'verified' then raise exception 'El dinero real todavía no está confirmado.'; end if;

  select flow_usd_value into v_price from public.flow_issuance_settings where id='canonical';
  if upper(v_op.currency)='USD' then
    if abs(v_op.unit_usd-v_price)>0.000001 or abs(v_op.amount-(v_op.quantity*v_price))>0.01 then raise exception 'El importe USD no coincide con la regla canónica.'; end if;
  else
    if v_op.fx_rate_original_per_usd is null or v_op.fx_rate_original_per_usd<=0 or v_op.fx_source is null or v_op.fx_quoted_at is null then raise exception 'La moneda requiere cotización canónica.'; end if;
    v_usd:=v_op.amount/v_op.fx_rate_original_per_usd;
    if abs(v_usd-(v_op.quantity*v_price))>0.01 then raise exception 'La conversión no respalda los FLOWS.'; end if;
  end if;

  if not exists(select 1 from public.flow_funding_ledger f where f.operation_id=v_op.id and f.entry_type='funding' and f.status='confirmed' and f.amount=v_op.amount and upper(f.currency)=upper(v_op.currency)) then raise exception 'Falta el registro confirmado del dinero recibido.'; end if;
  if not exists(select 1 from public.flow_payment_documents d where d.operation_id=v_op.id and d.kind='internal_receipt' and d.status='issued') then raise exception 'Falta el comprobante interno.'; end if;

  if v_op.issued_at is not null then
    if v_op.operation_type='back_existing' then return jsonb_build_object('operationId',v_op.id,'issued',1,'alreadyIssued',true,'targetAssetId',v_op.target_asset_id); end if;
    select count(*)::integer into v_count from public.flow_assets where backing_operation_id=v_op.id;
    return jsonb_build_object('operationId',v_op.id,'issued',v_count,'alreadyIssued',true);
  end if;

  if v_op.operation_type='back_existing' then
    if v_op.target_asset_id is null or v_op.quantity<>1 then raise exception 'Operación de respaldo legacy inválida.'; end if;
    select * into v_asset from public.flow_assets where id=v_op.target_asset_id for update;
    if not found then raise exception 'FLOW legacy inexistente.'; end if;
    if v_asset.owner_user_id<>v_op.recipient_user_id then raise exception 'El FLOW legacy pertenece a otro Player.'; end if;
    if v_asset.status<>'legacy_unverified' or v_asset.backing_operation_id is not null then raise exception 'El FLOW ya está respaldado o no admite respaldo.'; end if;

    update public.flow_assets
    set status='available',backing_operation_id=v_op.id,backed_at=now(),metadata=metadata||jsonb_build_object('backedByOperationId',v_op.id,'backingProvider',v_op.provider)
    where id=v_asset.id;
    insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
    values(v_asset.id,'backed',v_asset.owner_user_id,v_asset.owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('provider',v_op.provider,'paymentMethod',v_op.payment_method));
    perform public.adjust_flows_balance(v_op.recipient_user_id,1,'purchase','flow_backing',v_op.id::text,jsonb_build_object('operationId',v_op.id,'targetAssetId',v_asset.id,'provider',v_op.provider,'quantity',1),p_confirmed_by);
    update public.flow_purchase_operations set issued_at=now(),updated_at=now() where id=v_op.id;
    perform public.flow_project_event(v_op.recipient_user_id,'flow_backed','FLOW existente respaldado con dinero real confirmado.',v_op.id,p_confirmed_by,jsonb_build_object('flowAssetId',v_asset.id,'provider',v_op.provider));
    return jsonb_build_object('operationId',v_op.id,'issued',1,'alreadyIssued',false,'targetAssetId',v_asset.id);
  end if;

  insert into public.flow_assets(operation_id,operation_unit,owner_user_id,owner_player_id,original_buyer_user_id,original_buyer_player_id,status,backing_operation_id,backed_at,metadata)
  select v_op.id,n,v_op.recipient_user_id,v_op.recipient_player_id,v_op.buyer_user_id,v_op.buyer_player_id,'available',v_op.id,now(),jsonb_build_object('provider',v_op.provider,'paymentMethod',v_op.payment_method,'backingStatus',v_op.backing_status)
  from generate_series(1,v_op.quantity)n;
  insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
  select id,'issued',owner_user_id,owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('provider',v_op.provider,'paymentMethod',v_op.payment_method)
  from public.flow_assets where backing_operation_id=v_op.id;
  perform public.adjust_flows_balance(v_op.recipient_user_id,v_op.quantity,'purchase',case when v_op.provider='cash' then 'cash_payment' else 'flow_purchase' end,v_op.id::text,jsonb_build_object('operationId',v_op.id,'provider',v_op.provider,'quantity',v_op.quantity),p_confirmed_by);
  update public.flow_purchase_operations set issued_at=now(),updated_at=now() where id=v_op.id;
  perform public.flow_project_event(v_op.recipient_user_id,'flow_issued','FLOWS emitidos contra una operación económica confirmada.',v_op.id,p_confirmed_by,jsonb_build_object('quantity',v_op.quantity,'provider',v_op.provider));
  return jsonb_build_object('operationId',v_op.id,'issued',v_op.quantity,'alreadyIssued',false);
end $$;
revoke all on function public.issue_flows_for_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_flows_for_operation(uuid,uuid) to service_role;

create or replace function public.confirm_flow_external_payment(p_operation_id uuid,p_provider text,p_provider_payment_id text,p_confirmed_at timestamptz,p_amount numeric,p_currency text,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.flow_purchase_operations%rowtype; v_result jsonb; v_fee numeric:=0; v_net numeric;
begin
  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found or v_op.provider<>p_provider or v_op.status not in('pending','confirmed') then raise exception 'Operación externa inválida.'; end if;
  if abs(v_op.amount-p_amount)>0.01 or upper(v_op.currency)<>upper(p_currency) then raise exception 'El dinero confirmado no coincide con la operación.'; end if;
  if exists(select 1 from public.flow_purchase_operations o where o.provider=p_provider and o.provider_payment_id=p_provider_payment_id and o.id<>v_op.id) then raise exception 'El payment_id ya pertenece a otra operación de FLOW.'; end if;
  if coalesce(p_metadata->>'providerFee','') ~ '^[0-9]+([.][0-9]+)?$' then v_fee:=(p_metadata->>'providerFee')::numeric; end if;
  v_net:=greatest(p_amount-v_fee,0);
  if coalesce(p_metadata->>'netAmount','') ~ '^[0-9]+([.][0-9]+)?$' then v_net:=(p_metadata->>'netAmount')::numeric; end if;
  update public.flow_purchase_operations set status='confirmed',backing_status='verified',provider_payment_id=p_provider_payment_id,confirmed_at=coalesce(p_confirmed_at,now()),provider_fee=v_fee,net_amount=v_net,updated_at=now() where id=v_op.id;
  insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,idempotency_key,occurred_at,provider_fee,net_amount,metadata)
  values(v_op.id,'funding',v_op.provider,v_op.payment_method,v_op.amount,upper(v_op.currency),'confirmed',p_provider_payment_id,p_idempotency_key,coalesce(p_confirmed_at,now()),v_fee,v_net,coalesce(p_metadata,'{}'::jsonb)) on conflict(idempotency_key) do nothing;
  insert into public.flow_payment_documents(operation_id,kind,provider,document_type,status,issuer,recipient,amount,currency,document_number,issued_at,metadata)
  values(v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',jsonb_build_object('name','CLOUVA'),jsonb_build_object('userId',v_op.recipient_user_id,'playerId',v_op.recipient_player_id),v_op.amount,upper(v_op.currency),'FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12)),coalesce(p_confirmed_at,now()),jsonb_build_object('internalOnly',true,'fiscalDocument',false,'providerPaymentId',p_provider_payment_id,'providerFee',v_fee,'netAmount',v_net)) on conflict(operation_id,kind,provider) do nothing;
  perform public.flow_project_event(v_op.recipient_user_id,'payment_confirmed','Dinero real confirmado para una compra de FLOWS.',v_op.id,null,jsonb_build_object('provider',v_op.provider,'amount',v_op.amount,'currency',v_op.currency,'providerFee',v_fee,'netAmount',v_net));
  select public.issue_flows_for_operation(v_op.id,null) into v_result;
  return v_result;
end $$;
revoke all on function public.confirm_flow_external_payment(uuid,text,text,timestamptz,numeric,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_flow_external_payment(uuid,text,text,timestamptz,numeric,text,text,jsonb) to service_role;

create or replace function public.register_flow_cash_payment(p_payer_player_id uuid,p_recipient_player_id uuid,p_quantity integer,p_reference text,p_note text,p_idempotency_key text,p_confirmed_by uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_payer public.players%rowtype; v_recipient public.players%rowtype; v_price numeric; v_amount numeric; v_op public.flow_purchase_operations%rowtype; v_result jsonb; v_receipt text;
begin
  if p_confirmed_by is null or p_quantity<1 or p_quantity>1000 or coalesce(trim(p_idempotency_key),'')='' then raise exception 'Datos de pago en efectivo inválidos.'; end if;
  select * into v_payer from public.players where id=p_payer_player_id; if not found or v_payer.owner_user_id is null then raise exception 'Pagador sin cuenta CLOUVA.'; end if;
  select * into v_recipient from public.players where id=p_recipient_player_id; if not found or v_recipient.owner_user_id is null then raise exception 'Receptor sin cuenta CLOUVA.'; end if;
  select flow_usd_value into v_price from public.flow_issuance_settings where id='canonical'; v_amount:=p_quantity*v_price;
  select * into v_op from public.flow_purchase_operations where provider_reference='cash:'||p_idempotency_key for update;
  if found then
    if v_op.buyer_player_id<>p_payer_player_id or v_op.recipient_player_id<>p_recipient_player_id or v_op.quantity<>p_quantity or v_op.amount<>v_amount then raise exception 'La referencia de efectivo ya existe con otros datos.'; end if;
    select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
    return jsonb_build_object('operationId',v_op.id,'duplicate',true,'amount',v_op.amount,'currency',v_op.currency,'receiptNumber','FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12)),'issued',v_result);
  end if;
  insert into public.flow_purchase_operations(buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,provider,provider_reference,payment_method,quantity,unit_usd,amount,currency,status,backing_status,confirmed_at,created_by,operation_type,provider_fee,net_amount,metadata)
  values(v_payer.owner_user_id,v_payer.id,v_recipient.owner_user_id,v_recipient.id,'cash','cash:'||p_idempotency_key,'cash',p_quantity,v_price,v_amount,'USD','confirmed','verified',now(),p_confirmed_by,'cash_purchase',0,v_amount,jsonb_build_object('reference',nullif(trim(coalesce(p_reference,'')),''),'note',nullif(trim(coalesce(p_note,'')),''),'cashReceived',true)) returning * into v_op;
  insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,confirmed_by,provider_fee,net_amount,metadata)
  values(v_op.id,'funding','cash','cash',v_amount,'USD','confirmed','cash-funding:'||p_idempotency_key,p_confirmed_by,0,v_amount,jsonb_build_object('cashReceived',true,'reference',p_reference,'note',p_note));
  v_receipt:='FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12));
  insert into public.flow_payment_documents(operation_id,kind,provider,document_type,status,issuer,recipient,amount,currency,document_number,issued_at,metadata)
  values(v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',jsonb_build_object('name','CLOUVA'),jsonb_build_object('userId',v_recipient.owner_user_id,'playerId',v_recipient.id,'payerPlayerId',v_payer.id),v_amount,'USD',v_receipt,now(),jsonb_build_object('internalOnly',true,'fiscalDocument',false,'cashReceived',true));
  perform public.flow_project_event(v_recipient.owner_user_id,'payment_created','Operación económica creada para emisión de FLOWS.',v_op.id,p_confirmed_by,jsonb_build_object('provider','cash','amount',v_amount,'currency','USD'));
  perform public.flow_project_event(v_recipient.owner_user_id,'cash_payment_registered','Ingreso de efectivo confirmado para emisión de FLOWS.',v_op.id,p_confirmed_by,jsonb_build_object('amount',v_amount,'currency','USD'));
  perform public.flow_project_event(v_recipient.owner_user_id,'payment_confirmed','Dinero real confirmado para una compra de FLOWS.',v_op.id,p_confirmed_by,jsonb_build_object('provider','cash','amount',v_amount,'currency','USD'));
  select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
  return jsonb_build_object('operationId',v_op.id,'duplicate',false,'amount',v_amount,'currency','USD','receiptNumber',v_receipt,'issued',v_result);
end $$;
revoke all on function public.register_flow_cash_payment(uuid,uuid,integer,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_flow_cash_payment(uuid,uuid,integer,text,text,text,uuid) to service_role;

create or replace function public.record_flow_refund(p_operation_id uuid,p_provider_payment_id text,p_amount numeric,p_currency text,p_reason text,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.flow_purchase_operations%rowtype; v_funding public.flow_funding_ledger%rowtype; v_refund public.flow_funding_ledger%rowtype; v_case public.flow_refund_cases%rowtype; v_assets jsonb; v_asset_count integer:=0; v_recoverable integer:=0; v_owner uuid; v_wallet integer:=0; v_auto_reversed boolean:=false;
begin
  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found or abs(v_op.amount-p_amount)>0.01 or upper(v_op.currency)<>upper(p_currency) then raise exception 'Reembolso inválido.'; end if;
  if v_op.status='refunded' then select * into v_case from public.flow_refund_cases where operation_id=v_op.id; return jsonb_build_object('operationId',v_op.id,'refundCaseId',v_case.id,'status',coalesce(v_case.status,'pending_review'),'alreadyRecorded',true); end if;
  select * into v_funding from public.flow_funding_ledger where operation_id=v_op.id and entry_type='funding' and status='confirmed' limit 1 for update;
  if not found then raise exception 'No existe respaldo confirmado para revertir.'; end if;
  insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,idempotency_key,reverses_entry_id,provider_fee,net_amount,metadata)
  values(v_op.id,'refund',v_op.provider,v_op.payment_method,p_amount,upper(p_currency),'confirmed',p_provider_payment_id,p_idempotency_key,v_funding.id,0,p_amount,coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('reason',p_reason)) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into v_refund;
  select coalesce(jsonb_agg(jsonb_build_object('flowAssetId',id,'flowNumber',flow_number,'status',status,'ownerUserId',owner_user_id,'ownerPlayerId',owner_player_id)),'[]'::jsonb),count(*)::integer,count(*) filter(where status='available')::integer,min(owner_user_id::text)::uuid
  into v_assets,v_asset_count,v_recoverable,v_owner from public.flow_assets where backing_operation_id=v_op.id and status<>'reversed';
  if v_asset_count>0 and v_recoverable=v_asset_count and not exists(select 1 from public.flow_assets where backing_operation_id=v_op.id and status<>'reversed' and owner_user_id<>v_owner) then
    select balance into v_wallet from public.flows_wallets where user_id=v_owner for update; v_wallet:=coalesce(v_wallet,0);
    if v_wallet>=v_asset_count then
      perform public.adjust_flows_balance(v_owner,-v_asset_count,'refund','flow_refund',v_op.id::text,jsonb_build_object('operationId',v_op.id,'reason',p_reason,'quantity',v_asset_count),null);
      v_auto_reversed:=true;
    end if;
  end if;
  update public.flow_assets set status='reversed',metadata=metadata||jsonb_build_object('reversedByOperationId',v_op.id,'refundReason',p_reason) where backing_operation_id=v_op.id and status<>'reversed';
  insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,from_player_id,operation_id,metadata)
  select id,'reversal',owner_user_id,owner_player_id,v_op.id,jsonb_build_object('reason',p_reason,'autoWalletDebit',v_auto_reversed) from public.flow_assets where backing_operation_id=v_op.id;
  update public.flow_purchase_operations set status='refunded',backing_status='reversed',refund_status=case when v_auto_reversed then 'reversed' else 'pending_review' end,updated_at=now() where id=v_op.id;
  insert into public.flow_refund_cases(operation_id,funding_entry_id,provider_refund_id,amount,currency,status,reason,affected_assets,metadata,resolved_at)
  values(v_op.id,v_refund.id,p_provider_payment_id,p_amount,upper(p_currency),case when v_auto_reversed then 'reversed' else 'pending_review' end,p_reason,v_assets,coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('autoWalletDebit',v_auto_reversed),case when v_auto_reversed then now() else null end)
  on conflict(operation_id) do update set funding_entry_id=excluded.funding_entry_id,provider_refund_id=excluded.provider_refund_id,status=excluded.status,reason=excluded.reason,affected_assets=excluded.affected_assets,metadata=public.flow_refund_cases.metadata||excluded.metadata,resolved_at=excluded.resolved_at returning * into v_case;
  perform public.flow_project_event(v_op.recipient_user_id,'payment_refunded',case when v_auto_reversed then 'Reembolso registrado y FLOWS revertidos de forma auditable.' else 'Reembolso registrado; los FLOWS afectados quedan bloqueados y en revisión auditable.' end,v_op.id,null,jsonb_build_object('refundCaseId',v_case.id,'affectedAssets',v_assets,'autoWalletDebit',v_auto_reversed));
  return jsonb_build_object('operationId',v_op.id,'refundCaseId',v_case.id,'status',v_case.status,'autoWalletDebit',v_auto_reversed,'requiresAssetReview',not v_auto_reversed);
end $$;
revoke all on function public.record_flow_refund(uuid,text,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_flow_refund(uuid,text,numeric,text,text,text,jsonb) to service_role;

create or replace function public.flow_reconciliation_report()
returns jsonb language sql security definer set search_path=public as $$
with issues as (
  select 'spendable_without_backing'::text issue_type,'critical'::text severity,a.id::text entity_id,jsonb_build_object('flowNumber',a.flow_number,'status',a.status,'backingOperationId',a.backing_operation_id) details
  from public.flow_assets a left join public.flow_purchase_operations o on o.id=a.backing_operation_id
  where a.status in('available','activated','transferred') and (a.backing_operation_id is null or o.id is null or o.status<>'confirmed' or o.backing_status<>'verified' or not exists(select 1 from public.flow_funding_ledger f where f.operation_id=o.id and f.entry_type='funding' and f.status='confirmed' and f.amount=o.amount and upper(f.currency)=upper(o.currency)))
  union all
  select 'confirmed_without_issuance','critical',o.id::text,jsonb_build_object('provider',o.provider,'quantity',o.quantity,'confirmedAt',o.confirmed_at) from public.flow_purchase_operations o where o.status='confirmed' and o.backing_status='verified' and o.issued_at is null
  union all
  select 'issued_without_wallet_ledger','critical',o.id::text,jsonb_build_object('quantity',o.quantity,'recipientUserId',o.recipient_user_id) from public.flow_purchase_operations o where o.issued_at is not null and not exists(select 1 from public.flows_wallet_ledger l where l.reference_id=o.id::text and l.transaction_type='purchase')
  union all
  select 'funding_amount_mismatch','critical',f.id::text,jsonb_build_object('operationId',o.id,'fundingAmount',f.amount,'operationAmount',o.amount,'currency',f.currency) from public.flow_funding_ledger f join public.flow_purchase_operations o on o.id=f.operation_id where f.entry_type='funding' and f.status='confirmed' and (f.amount<>o.amount or upper(f.currency)<>upper(o.currency))
  union all
  select 'wallet_ledger_mismatch','critical',w.user_id::text,jsonb_build_object('walletBalance',w.balance,'ledgerSum',coalesce(x.total,0)) from public.flows_wallets w left join lateral(select sum(l.amount)::integer total from public.flows_wallet_ledger l where l.user_id=w.user_id)x on true where w.balance<>coalesce(x.total,0)
  union all
  select 'legacy_unverified','warning',a.id::text,jsonb_build_object('flowNumber',a.flow_number,'ownerUserId',a.owner_user_id) from public.flow_assets a where a.status='legacy_unverified' or a.backing_operation_id is null
  union all
  select 'stale_pending_purchase','warning',o.id::text,jsonb_build_object('createdAt',o.created_at,'provider',o.provider,'operationType',o.operation_type) from public.flow_purchase_operations o where o.status='pending' and o.created_at<now()-interval '24 hours'
  union all
  select 'duplicate_provider_payment','critical',min(o.id::text),jsonb_build_object('provider',o.provider,'providerPaymentId',o.provider_payment_id,'count',count(*)) from public.flow_purchase_operations o where o.provider_payment_id is not null group by o.provider,o.provider_payment_id having count(*)>1
  union all
  select 'duplicate_funding_payment','critical',min(f.id::text),jsonb_build_object('provider',f.provider,'externalPaymentId',f.external_payment_id,'count',count(*)) from public.flow_funding_ledger f where f.entry_type='funding' and f.external_payment_id is not null group by f.provider,f.external_payment_id having count(*)>1
)
select coalesce(jsonb_agg(jsonb_build_object('type',issue_type,'severity',severity,'entityId',entity_id,'details',details) order by severity,issue_type),'[]'::jsonb) from issues;
$$;
revoke all on function public.flow_reconciliation_report() from public,anon,authenticated;
grant execute on function public.flow_reconciliation_report() to service_role;

create or replace function public.flow_treasury_snapshot()
returns jsonb language sql security definer set search_path=public as $$
with settings as (select flow_usd_value from public.flow_issuance_settings where id='canonical'),
counts as (
  select
    (select count(*) from public.flow_assets a join public.flow_purchase_operations o on o.id=a.backing_operation_id where a.status in('available','activated','transferred') and o.status='confirmed' and o.backing_status='verified')::integer backed_assets,
    (select count(*) from public.flow_assets where status='legacy_unverified' or backing_operation_id is null)::integer unbacked_assets,
    (select coalesce(sum(balance),0) from public.flows_wallets)::integer circulation,
    (select count(*) from public.flow_purchase_operations where status='pending')::integer pending_purchases,
    (select count(*) from public.flow_purchase_operations where status='confirmed')::integer confirmed_purchases,
    (select count(*) from public.flow_purchase_operations where status='failed')::integer failed_purchases,
    (select count(*) from public.flow_purchase_operations where issued_at is not null)::integer emissions,
    (select count(*) from public.flow_refund_cases)::integer refund_cases,
    (select count(*) from public.flow_refund_cases where status='pending_review')::integer refund_reviews
), money as (
  select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'grossConfirmed',gross_confirmed,'providerFees',provider_fees,'netConfirmed',net_confirmed,'refunds',refunds) order by currency),'[]'::jsonb) rows
  from (
    select currency,
      coalesce(sum(amount) filter(where entry_type='funding' and status='confirmed'),0) gross_confirmed,
      coalesce(sum(provider_fee) filter(where entry_type='funding' and status='confirmed'),0) provider_fees,
      coalesce(sum(coalesce(net_amount,amount)) filter(where entry_type='funding' and status='confirmed'),0) net_confirmed,
      coalesce(sum(amount) filter(where entry_type='refund' and status='confirmed'),0) refunds
    from public.flow_funding_ledger group by currency
  ) q
)
select jsonb_build_object('flowUsdValue',(select flow_usd_value from settings),'backedAssets',counts.backed_assets,'circulation',counts.circulation,'unbackedAssets',counts.unbacked_assets,'backingDifferenceFlows',counts.backed_assets-counts.circulation,'pendingPurchases',counts.pending_purchases,'confirmedPurchases',counts.confirmed_purchases,'failedPurchases',counts.failed_purchases,'emissions',counts.emissions,'refundCases',counts.refund_cases,'refundReviews',counts.refund_reviews,'fundingByCurrency',money.rows) from counts,money;
$$;
revoke all on function public.flow_treasury_snapshot() from public,anon,authenticated;
grant execute on function public.flow_treasury_snapshot() to service_role;

commit;
