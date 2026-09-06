alter table public.flow_reserve_accounts
  add column if not exists flow_account_role text not null default 'reserve',
  add column if not exists authorized_for_collection boolean not null default false,
  add column if not exists collection_authorized_at timestamptz,
  add column if not exists collection_authorized_by uuid references auth.users(id) on delete set null;

-- Mercado Pago is a collection rail. Refuse to demote it if it somehow backs live FLOW.
do $$
begin
  if exists (
    select 1
    from public.flow_backing_allocations b
    join public.flow_reserve_accounts r on r.id=b.reserve_account_id
    where b.status='active' and r.provider='mercadopago'
  ) then
    raise exception 'No se puede separar Mercado Pago del backing porque existen asignaciones FLOW activas sobre esa cuenta.';
  end if;
end $$;

update public.flow_reserve_accounts
set flow_account_role='collection_rail',
    authorized_for_collection=(account_reference is not null),
    collection_authorized_at=coalesce(collection_authorized_at,authorized_at),
    collection_authorized_by=coalesce(collection_authorized_by,authorized_by),
    authorized_for_flow=false,
    authorized_at=null,
    authorized_by=null,
    metadata=(metadata-'purpose') || jsonb_build_object(
      'purpose','flow_collection_rail',
      'custodySeparatedAt',now(),
      'custodyRole','processor_only'
    ),
    updated_at=now()
where provider='mercadopago';

alter table public.flow_reserve_accounts drop constraint if exists flow_reserve_accounts_role_check;
alter table public.flow_reserve_accounts add constraint flow_reserve_accounts_role_check
  check (flow_account_role in ('collection_rail','reserve'));
alter table public.flow_reserve_accounts drop constraint if exists flow_reserve_accounts_collection_role_check;
alter table public.flow_reserve_accounts add constraint flow_reserve_accounts_collection_role_check
  check (not (flow_account_role='collection_rail' and authorized_for_flow));
alter table public.flow_reserve_accounts drop constraint if exists flow_reserve_accounts_reserve_role_check;
alter table public.flow_reserve_accounts add constraint flow_reserve_accounts_reserve_role_check
  check (not (flow_account_role='reserve' and authorized_for_collection));
alter table public.flow_reserve_accounts drop constraint if exists flow_reserve_accounts_flow_reference_check;
alter table public.flow_reserve_accounts add constraint flow_reserve_accounts_flow_reference_check
  check (not authorized_for_flow or account_reference is not null);
alter table public.flow_reserve_accounts drop constraint if exists flow_reserve_accounts_collection_reference_check;
alter table public.flow_reserve_accounts add constraint flow_reserve_accounts_collection_reference_check
  check (not authorized_for_collection or account_reference is not null);

create index if not exists flow_collection_rail_authorized_idx
  on public.flow_reserve_accounts(provider,currency,account_reference)
  where flow_account_role='collection_rail' and authorized_for_collection and is_active and status='active';
create index if not exists flow_custody_reserve_authorized_idx
  on public.flow_reserve_accounts(provider,currency,account_reference)
  where flow_account_role='reserve' and authorized_for_flow and is_active and status='active';

alter table public.flow_funding_ledger
  add column if not exists custody_stage text not null default 'pending';
alter table public.flow_funding_ledger drop constraint if exists flow_funding_ledger_custody_stage_check;
alter table public.flow_funding_ledger add constraint flow_funding_ledger_custody_stage_check
  check (custody_stage in ('pending','received_by_processor','transfer_pending','reserve_received','reserve_confirmed','allocated','reversed','refunded'));
create index if not exists flow_funding_custody_stage_idx
  on public.flow_funding_ledger(custody_stage,entry_type,status,occurred_at desc);

update public.flow_funding_ledger f
set reserve_account_id=null,
    custody_status='pending',
    custody_reference=null,
    custody_confirmed_at=null,
    reference_usd_amount=0,
    custody_stage='received_by_processor',
    metadata=metadata || jsonb_build_object('processorCustodySeparatedAt',now(),'processorIsNotReserve',true)
where entry_type='funding' and provider='mercadopago' and status='confirmed';

update public.flow_funding_ledger
set custody_stage=case
  when entry_type='reserve_deposit' and status='confirmed' then 'reserve_confirmed'
  when entry_type='refund' then 'refunded'
  when entry_type in ('reversal','reserve_release') then 'reversed'
  else custody_stage
end;

update public.flow_funding_ledger f
set custody_stage='allocated'
where f.entry_type='reserve_deposit'
  and exists(select 1 from public.flow_backing_allocations b where b.funding_entry_id=f.id and b.status='active');

update public.flow_purchase_operations o
set metadata=(metadata-'reserveAccountId'-'reserveCollectorId'-'custodyConfirmed') || jsonb_build_object(
      'paymentStage',case when o.status='confirmed' then 'received_by_processor' else 'pending' end,
      'processorIsNotReserve',true
    ),
    backing_status=case when o.status='confirmed' and o.backing_status='verified' then o.backing_status when o.status='confirmed' then 'pending' else o.backing_status end,
    updated_at=now()
where o.provider='mercadopago' and o.backing_status<>'reversed';

create or replace function public.guard_flow_reserve_account_authorization()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
begin
  if new.flow_account_role='collection_rail' and new.authorized_for_flow then
    raise exception 'Un rail de cobro no puede ser una Reserva FLOW.';
  end if;
  if new.flow_account_role='reserve' and new.authorized_for_collection then
    raise exception 'Una Reserva FLOW no puede ser el collector operativo.';
  end if;
  if new.authorized_for_flow and new.account_reference is null then
    raise exception 'Una Reserva FLOW autorizada requiere referencia de cuenta.';
  end if;
  if new.authorized_for_collection and new.account_reference is null then
    raise exception 'Un rail de cobro autorizado requiere collector verificable.';
  end if;

  if exists(select 1 from public.flow_backing_allocations b where b.reserve_account_id=old.id and b.status='active') then
    if not new.authorized_for_flow or new.flow_account_role<>'reserve' or not new.is_active or new.status<>'active'
       or new.provider is distinct from old.provider
       or new.currency is distinct from old.currency
       or new.account_reference is distinct from old.account_reference
       or new.flow_account_role is distinct from old.flow_account_role then
      raise exception 'No se puede desautorizar o mutar una Reserva con backing FLOW activo.';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_flow_reserve_account_authorization() from public, anon, authenticated;
grant execute on function public.guard_flow_reserve_account_authorization() to service_role;

create or replace function public.flow_reserve_account_free_usd(p_account_id uuid)
returns numeric
language sql
security definer
set search_path='public'
as $$
with account_ok as (
  select exists(
    select 1 from public.flow_reserve_accounts r
    where r.id=p_account_id and r.flow_account_role='reserve'
      and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  ) ok
), reserve_money as (
  select
    coalesce(sum(reference_usd_amount) filter (
      where status='confirmed' and custody_status='confirmed'
        and custody_stage in ('reserve_confirmed','allocated')
        and entry_type='reserve_deposit'
    ),0) credits,
    coalesce(sum(reference_usd_amount) filter (
      where status='confirmed' and entry_type in ('refund','reversal','reserve_release')
        and custody_status in ('confirmed','released','reversed')
    ),0) debits
  from public.flow_funding_ledger
  where reserve_account_id=p_account_id
), allocations as (
  select coalesce(sum(reference_usd_value),0) allocated
  from public.flow_backing_allocations
  where reserve_account_id=p_account_id and status='active'
)
select case when account_ok.ok then reserve_money.credits-reserve_money.debits-allocations.allocated else 0 end
from account_ok,reserve_money,allocations;
$$;

revoke all on function public.flow_reserve_account_free_usd(uuid) from public, anon, authenticated;
grant execute on function public.flow_reserve_account_free_usd(uuid) to service_role;

create or replace function public.guard_flow_asset_backing()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_price numeric;
begin
  if new.status in('available','activated','transferred') then
    if new.backing_operation_id is null then raise exception 'Un FLOW disponible requiere una operación de respaldo.'; end if;
    select * into v_op from public.flow_purchase_operations where id=new.backing_operation_id;
    if not found or v_op.status<>'confirmed' or v_op.backing_status<>'verified' or v_op.confirmed_at is null then
      raise exception 'El FLOW no tiene respaldo económico confirmado.';
    end if;
    select flow_usd_value into v_price from public.flow_issuance_settings where id='canonical';
    if v_price is null or abs(v_op.unit_usd-v_price)>0.000001 or abs(v_op.required_backing_usd-(v_op.quantity*v_price))>0.000001 then
      raise exception 'El FLOW no respeta el valor canónico de respaldo.';
    end if;
    if not exists(
      select 1
      from public.flow_backing_allocations b
      join public.flow_reserve_accounts r on r.id=b.reserve_account_id
      join public.flow_funding_ledger f on f.id=b.funding_entry_id
      where b.flow_asset_id=new.id and b.status='active'
        and abs(b.reference_usd_value-v_price)<=0.000001
        and r.flow_account_role='reserve' and r.is_active and r.status='active'
        and r.authorized_for_flow and r.account_reference is not null
        and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
        and f.custody_stage in ('reserve_confirmed','allocated')
        and f.entry_type='reserve_deposit' and coalesce(f.reference_usd_amount,0)>0
    ) then
      raise exception 'El FLOW no tiene una asignación 1:1 contra dinero confirmado en la Reserva CLOUVA.';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_flow_asset_backing() from public, anon, authenticated;
grant execute on function public.guard_flow_asset_backing() to service_role;

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
  v_fee numeric:=0;
  v_net numeric;
  v_net_reference_usd numeric:=0;
  v_required_usd numeric;
  v_rail public.flow_reserve_accounts%rowtype;
  v_collector text:=nullif(trim(coalesce(p_metadata->>'collectorId','')),'');
  v_authorized boolean:=false;
begin
  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found or v_op.provider<>p_provider or v_op.status not in ('pending','confirmed') then raise exception 'Operación externa inválida.'; end if;
  if abs(v_op.amount-p_amount)>0.01 or upper(v_op.currency)<>upper(p_currency) then raise exception 'El dinero confirmado no coincide con la operación.'; end if;
  if v_op.provider_payment_id is not null and v_op.provider_payment_id<>p_provider_payment_id then raise exception 'La operación ya está asociada a otro payment_id.'; end if;
  if exists(select 1 from public.flow_purchase_operations o where o.provider=p_provider and o.provider_payment_id=p_provider_payment_id and o.id<>v_op.id) then raise exception 'El payment_id ya pertenece a otra operación de FLOW.'; end if;

  if coalesce(p_metadata->>'providerFee','') ~ '^[0-9]+([.][0-9]+)?$' then v_fee:=(p_metadata->>'providerFee')::numeric; end if;
  v_net:=greatest(p_amount-v_fee,0);
  if coalesce(p_metadata->>'netAmount','') ~ '^[0-9]+([.][0-9]+)?$' then v_net:=greatest((p_metadata->>'netAmount')::numeric,0); end if;
  if v_net>p_amount+0.01 then raise exception 'El neto reportado por el proveedor es inválido.'; end if;
  v_fee:=greatest(p_amount-v_net,0);
  v_required_usd:=v_op.quantity*v_op.unit_usd;
  if abs(v_op.required_backing_usd-v_required_usd)>0.000001 then raise exception 'El backing requerido de la operación es inválido.'; end if;

  if upper(p_currency)='USD' then
    v_net_reference_usd:=v_net;
  else
    if v_op.fx_rate_original_per_usd is null or v_op.fx_rate_original_per_usd<=0 then raise exception 'No existe FX histórico para registrar el neto del pago.'; end if;
    v_net_reference_usd:=v_net/v_op.fx_rate_original_per_usd;
  end if;

  if v_collector is not null then
    select * into v_rail
    from public.flow_reserve_accounts
    where provider=p_provider and upper(currency)=upper(p_currency)
      and account_reference=v_collector
      and flow_account_role='collection_rail' and authorized_for_collection
      and is_active and status='active'
    order by created_at limit 1 for update;
    v_authorized:=found;
  end if;

  update public.flow_purchase_operations
  set status='confirmed',
      backing_status=case when backing_status='verified' then 'verified' else 'pending' end,
      provider_payment_id=p_provider_payment_id,
      confirmed_at=coalesce(confirmed_at,p_confirmed_at,now()),
      provider_fee=v_fee,
      net_amount=v_net,
      metadata=(metadata-'custodyConfirmed'-'reserveAccountId'-'custodyRejectedReason') || jsonb_build_object(
        'collectorId',v_collector,
        'collectionRailAccountId',case when v_authorized then to_jsonb(v_rail.id) else 'null'::jsonb end,
        'collectorAuthorized',v_authorized,
        'paymentStage','received_by_processor',
        'processorIsNotReserve',true,
        'processorNetReferenceUsd',v_net_reference_usd,
        'paymentNetBackingShortfallUsd',greatest(v_required_usd-v_net_reference_usd,0)
      ) || case when v_authorized then '{}'::jsonb else jsonb_build_object('custodyRejectedReason','collector_not_authorized') end,
      updated_at=now()
  where id=v_op.id;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,idempotency_key,occurred_at,
    provider_fee,net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage,metadata
  ) values(
    v_op.id,'funding',v_op.provider,v_op.payment_method,v_op.amount,upper(v_op.currency),'confirmed',p_provider_payment_id,p_idempotency_key,coalesce(p_confirmed_at,now()),
    v_fee,v_net,null,'pending',null,null,0,'received_by_processor',
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'collectorAuthorized',v_authorized,'requiredBackingUsd',v_required_usd,
      'processorNetReferenceUsd',v_net_reference_usd,
      'collectionRailAccountId',case when v_authorized then v_rail.id else null end,
      'processorIsNotReserve',true
    )
  )
  on conflict(idempotency_key) do update set
    provider_fee=excluded.provider_fee,
    net_amount=excluded.net_amount,
    reserve_account_id=null,
    custody_status=case when public.flow_funding_ledger.custody_stage in ('reserve_confirmed','allocated','reversed','refunded') then public.flow_funding_ledger.custody_status else 'pending' end,
    custody_reference=case when public.flow_funding_ledger.custody_stage in ('reserve_confirmed','allocated','reversed','refunded') then public.flow_funding_ledger.custody_reference else null end,
    custody_confirmed_at=case when public.flow_funding_ledger.custody_stage in ('reserve_confirmed','allocated','reversed','refunded') then public.flow_funding_ledger.custody_confirmed_at else null end,
    reference_usd_amount=case when public.flow_funding_ledger.custody_stage in ('reserve_confirmed','allocated','reversed','refunded') then public.flow_funding_ledger.reference_usd_amount else 0 end,
    custody_stage=case when public.flow_funding_ledger.custody_stage in ('reserve_confirmed','allocated','reversed','refunded') then public.flow_funding_ledger.custody_stage else 'received_by_processor' end,
    metadata=public.flow_funding_ledger.metadata||excluded.metadata;

  insert into public.flow_payment_documents(operation_id,kind,provider,document_type,status,issuer,recipient,amount,currency,document_number,issued_at,metadata)
  values(v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',jsonb_build_object('name','CLOUVA'),jsonb_build_object('userId',v_op.recipient_user_id,'playerId',v_op.recipient_player_id),v_op.amount,upper(v_op.currency),'FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12)),coalesce(p_confirmed_at,now()),jsonb_build_object('internalOnly',true,'fiscalDocument',false,'providerPaymentId',p_provider_payment_id,'providerFee',v_fee,'netAmount',v_net,'collectorAuthorized',v_authorized,'processorIsNotReserve',true))
  on conflict(operation_id,kind,provider) do nothing;

  if not v_authorized then
    perform public.flow_project_event(v_op.recipient_user_id,'payment_confirmed','Pago confirmado, pero el collector no coincide con el rail de cobro autorizado.',v_op.id,null,jsonb_build_object('provider',v_op.provider,'amount',v_op.amount,'currency',v_op.currency,'collectorId',v_collector,'paymentStage','received_by_processor'));
    return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','paymentStage','received_by_processor','reason','collector_not_authorized');
  end if;

  perform public.flow_project_event(v_op.recipient_user_id,'payment_confirmed','Pago recibido por Mercado Pago. El FLOW espera que el dinero llegue a la Reserva CLOUVA.',v_op.id,null,jsonb_build_object('provider',v_op.provider,'amount',v_op.amount,'currency',v_op.currency,'providerFee',v_fee,'netAmount',v_net,'processorNetReferenceUsd',v_net_reference_usd,'requiredBackingUsd',v_required_usd,'collectionRailAccountId',v_rail.id));
  return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','paymentStage','received_by_processor','processorNetReferenceUsd',v_net_reference_usd);
end $$;

revoke all on function public.confirm_flow_external_payment(uuid,text,text,timestamptz,numeric,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_flow_external_payment(uuid,text,text,timestamptz,numeric,text,text,jsonb) to service_role;

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
  v_required_usd numeric;
  v_expected_backing_amount numeric;
  v_processor_net_usd numeric:=0;
  v_required_transfer_usd numeric:=0;
  v_operation_custody_usd numeric:=0;
  v_transfer_shortfall numeric:=0;
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
  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found then raise exception 'Operación de FLOW inexistente.'; end if;
  if v_op.status<>'confirmed' or v_op.confirmed_at is null then raise exception 'El pago real todavía no está confirmado.'; end if;
  if v_op.status='refunded' or v_op.refund_status='reversed' then raise exception 'La operación fue revertida.'; end if;

  select flow_usd_value into v_price from public.flow_issuance_settings where id='canonical';
  if v_price is null or v_price<=0 then raise exception 'Configuración canónica de FLOW inválida.'; end if;
  v_required_usd:=v_op.quantity*v_price;
  if abs(v_op.unit_usd-v_price)>0.000001 or abs(v_op.required_backing_usd-v_required_usd)>0.000001 then
    raise exception 'La operación no coincide con la regla canónica 1 FLOW = USD 1.';
  end if;

  if upper(v_op.currency)='USD' then
    v_expected_backing_amount:=v_required_usd;
  else
    if v_op.fx_rate_original_per_usd is null or v_op.fx_rate_original_per_usd<=0 or v_op.fx_source is null or v_op.fx_quoted_at is null then raise exception 'La moneda requiere cotización histórica canónica.'; end if;
    v_expected_backing_amount:=v_required_usd*v_op.fx_rate_original_per_usd;
  end if;
  if abs(v_op.backing_amount-v_expected_backing_amount)>0.02 then raise exception 'El monto de backing no coincide con la cotización histórica.'; end if;
  if v_op.amount+0.01<v_op.backing_amount then raise exception 'El checkout no cubre el backing requerido.'; end if;
  if abs(v_op.processing_fee_amount-greatest(v_op.amount-v_op.backing_amount,0))>0.02 then raise exception 'El desglose de procesamiento no coincide con el total cobrado.'; end if;

  if v_op.provider='mercadopago' then
    if coalesce(v_op.metadata->>'processorNetReferenceUsd','') ~ '^[0-9]+([.][0-9]+)?$' then
      v_processor_net_usd:=(v_op.metadata->>'processorNetReferenceUsd')::numeric;
    elsif v_op.net_amount is not null then
      if upper(v_op.currency)='USD' then v_processor_net_usd:=v_op.net_amount;
      elsif v_op.fx_rate_original_per_usd is not null and v_op.fx_rate_original_per_usd>0 then v_processor_net_usd:=v_op.net_amount/v_op.fx_rate_original_per_usd;
      end if;
    end if;
    if v_processor_net_usd<=0 then
      update public.flow_purchase_operations set backing_status='pending',metadata=metadata||jsonb_build_object('reservePendingReason','processor_net_unknown_or_zero'),updated_at=now() where id=v_op.id and backing_status<>'verified';
      return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','reason','processor_net_unknown_or_zero');
    end if;
    v_required_transfer_usd:=least(v_required_usd,v_processor_net_usd);
  else
    v_required_transfer_usd:=v_required_usd;
  end if;

  select coalesce(sum(f.reference_usd_amount),0) into v_operation_custody_usd
  from public.flow_funding_ledger f
  join public.flow_reserve_accounts r on r.id=f.reserve_account_id
  where f.operation_id=v_op.id and f.entry_type='reserve_deposit' and f.status='confirmed'
    and f.custody_status='confirmed' and f.custody_stage in ('reserve_confirmed','allocated')
    and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null;

  if v_operation_custody_usd+0.000001<v_required_transfer_usd then
    v_transfer_shortfall:=greatest(v_required_transfer_usd-v_operation_custody_usd,0);
    update public.flow_purchase_operations
      set backing_status='pending',metadata=(metadata-'reserveTransferShortfallUsd')||jsonb_build_object('reserveTransferShortfallUsd',v_transfer_shortfall,'reservePendingReason','processor_funds_not_transferred','reserveCheckedAt',now()),updated_at=now()
      where id=v_op.id and backing_status<>'verified';
    return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','reason','processor_funds_not_transferred','reserveTransferShortfallUsd',v_transfer_shortfall);
  end if;

  if not exists (select 1 from public.flow_payment_documents d where d.operation_id=v_op.id and d.kind='internal_receipt' and d.status='issued') then raise exception 'Falta el comprobante interno.'; end if;

  if v_op.operation_type='back_existing' then
    v_needed:=1;
  elsif v_op.issued_at is not null then
    select count(*)::integer into v_existing_count from public.flow_assets where operation_id=v_op.id and status='legacy_unverified';
    if v_existing_count=0 then
      select count(*)::integer into v_active_count
      from public.flow_assets a
      join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
      join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active'
      where a.backing_operation_id=v_op.id and a.status in ('available','activated','transferred');
      if v_active_count=v_op.quantity and v_op.backing_status<>'verified' then update public.flow_purchase_operations set backing_status='verified',updated_at=now() where id=v_op.id; end if;
      if v_active_count=v_op.quantity then
        update public.flow_funding_ledger set custody_stage='allocated' where operation_id=v_op.id and entry_type in ('funding','reserve_deposit') and custody_stage not in ('reversed','refunded');
      end if;
      return jsonb_build_object('operationId',v_op.id,'issued',v_active_count,'alreadyIssued',true,'backingStatus',case when v_active_count=v_op.quantity then 'verified' else 'pending' end);
    end if;
    v_needed:=v_existing_count;
  else
    v_needed:=v_op.quantity;
  end if;

  for r_account in
    select id from public.flow_reserve_accounts
    where flow_account_role='reserve' and authorized_for_flow and is_active and status='active' and account_reference is not null
    order by id for update
  loop
    v_free:=greatest(public.flow_reserve_account_free_usd(r_account.id),0);
    v_allocatable:=v_allocatable+floor(v_free/v_price)::integer;
  end loop;

  if v_allocatable<v_needed then
    v_shortfall:=(v_needed-v_allocatable)*v_price;
    update public.flow_purchase_operations
      set backing_status='pending',metadata=(metadata-'backingShortfallUsd')||jsonb_build_object('backingShortfallUsd',v_shortfall,'reservePendingReason','reserve_capacity_insufficient','reserveCheckedAt',now()),updated_at=now()
      where id=v_op.id;
    return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','backingShortfallUsd',v_shortfall);
  end if;

  update public.flow_purchase_operations
  set backing_status='verified',metadata=(metadata-'backingShortfallUsd'-'reserveTransferShortfallUsd'-'reservePendingReason')||jsonb_build_object('reserveVerifiedAt',now()),updated_at=now()
  where id=v_op.id;

  if v_op.operation_type='back_existing' then
    if v_op.target_asset_id is null or v_op.quantity<>1 then raise exception 'Operación de respaldo legacy inválida.'; end if;
    select * into v_asset from public.flow_assets where id=v_op.target_asset_id for update;
    if not found or v_asset.owner_user_id<>v_op.recipient_user_id then raise exception 'FLOW legacy inválido.'; end if;
    if v_asset.status<>'legacy_unverified' then raise exception 'El FLOW ya está respaldado o no admite respaldo.'; end if;

    v_account_id:=null;
    for r_account in select id from public.flow_reserve_accounts where flow_account_role='reserve' and authorized_for_flow and is_active and status='active' and account_reference is not null order by id loop
      if public.flow_reserve_account_free_usd(r_account.id)>=v_price then v_account_id:=r_account.id; exit; end if;
    end loop;
    if v_account_id is null then raise exception 'La reserva cambió durante la emisión.'; end if;
    select id into v_funding_entry_id from public.flow_funding_ledger
      where reserve_account_id=v_account_id and status='confirmed' and custody_status='confirmed' and custody_stage in ('reserve_confirmed','allocated') and entry_type='reserve_deposit'
      order by (operation_id=v_op.id) desc, occurred_at desc limit 1;
    if v_funding_entry_id is null then raise exception 'No existe una fuente de custodia confirmada para la asignación.'; end if;

    insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata)
    values(v_asset.id,v_account_id,v_funding_entry_id,v_price,'active',jsonb_build_object('operationId',v_op.id,'reason','back_existing'));
    update public.flow_assets set status='available',backing_operation_id=v_op.id,backed_at=now(),metadata=metadata||jsonb_build_object('backedByOperationId',v_op.id,'reserveAccountId',v_account_id) where id=v_asset.id;
    insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
    values(v_asset.id,'backed',v_asset.owner_user_id,v_asset.owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account_id));
    update public.flow_purchase_operations set issued_at=coalesce(issued_at,now()),updated_at=now() where id=v_op.id;
    update public.flow_funding_ledger set custody_stage='allocated' where operation_id=v_op.id and entry_type in ('funding','reserve_deposit') and custody_stage not in ('reversed','refunded');
    perform public.adjust_flows_balance(v_op.recipient_user_id,1,'purchase','flow_backing',v_op.id::text,jsonb_build_object('operationId',v_op.id,'targetAssetId',v_asset.id,'reserveAccountId',v_account_id),p_confirmed_by);
    return jsonb_build_object('operationId',v_op.id,'issued',1,'alreadyIssued',false,'backingStatus','verified','targetAssetId',v_asset.id);
  end if;

  if v_op.issued_at is not null and v_existing_count>0 then
    for r_asset in select * from public.flow_assets where operation_id=v_op.id and status='legacy_unverified' order by flow_number for update loop
      v_account_id:=null;
      for r_account in select id from public.flow_reserve_accounts where flow_account_role='reserve' and authorized_for_flow and is_active and status='active' and account_reference is not null order by id loop
        if public.flow_reserve_account_free_usd(r_account.id)>=v_price then v_account_id:=r_account.id; exit; end if;
      end loop;
      if v_account_id is null then raise exception 'La reserva cambió durante la reconciliación.'; end if;
      select id into v_funding_entry_id from public.flow_funding_ledger
        where reserve_account_id=v_account_id and status='confirmed' and custody_status='confirmed' and custody_stage in ('reserve_confirmed','allocated') and entry_type='reserve_deposit'
        order by (operation_id=v_op.id) desc, occurred_at desc limit 1;
      if v_funding_entry_id is null then raise exception 'No existe una fuente de custodia confirmada para la reconciliación.'; end if;
      insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata)
      values(r_asset.id,v_account_id,v_funding_entry_id,v_price,'active',jsonb_build_object('operationId',v_op.id,'reason','historical_reconciliation'));
      update public.flow_assets set status='available',backing_operation_id=v_op.id,backed_at=now(),metadata=metadata||jsonb_build_object('reserveAccountId',v_account_id,'reconciledCustodyAt',now()) where id=r_asset.id;
      insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
      values(r_asset.id,'backed',r_asset.owner_user_id,r_asset.owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account_id,'historical',true));
    end loop;
    update public.flow_funding_ledger set custody_stage='allocated' where operation_id=v_op.id and entry_type in ('funding','reserve_deposit') and custody_stage not in ('reversed','refunded');
    perform public.adjust_flows_balance(v_op.recipient_user_id,v_existing_count,'purchase','reserve_reconciliation',v_op.id::text,jsonb_build_object('operationId',v_op.id,'quantity',v_existing_count),p_confirmed_by);
    perform public.flow_project_event(v_op.recipient_user_id,'flow_backed','FLOW histórico reactivado después de confirmar custodia en Reserva CLOUVA.',v_op.id,p_confirmed_by,jsonb_build_object('quantity',v_existing_count));
    return jsonb_build_object('operationId',v_op.id,'issued',v_existing_count,'alreadyIssued',false,'backingStatus','verified','reconciled',true);
  end if;

  for v_unit in 1..v_op.quantity loop
    v_account_id:=null;
    for r_account in select id from public.flow_reserve_accounts where flow_account_role='reserve' and authorized_for_flow and is_active and status='active' and account_reference is not null order by id loop
      if public.flow_reserve_account_free_usd(r_account.id)>=v_price then v_account_id:=r_account.id; exit; end if;
    end loop;
    if v_account_id is null then raise exception 'La reserva cambió durante la emisión.'; end if;
    select id into v_funding_entry_id from public.flow_funding_ledger
      where reserve_account_id=v_account_id and status='confirmed' and custody_status='confirmed' and custody_stage in ('reserve_confirmed','allocated') and entry_type='reserve_deposit'
      order by (operation_id=v_op.id) desc, occurred_at desc limit 1;
    if v_funding_entry_id is null then raise exception 'No existe una fuente de custodia confirmada para la emisión.'; end if;

    insert into public.flow_assets(operation_id,operation_unit,owner_user_id,owner_player_id,original_buyer_user_id,original_buyer_player_id,status,backing_operation_id,backed_at,metadata)
    values(v_op.id,v_unit,v_op.recipient_user_id,v_op.recipient_player_id,v_op.buyer_user_id,v_op.buyer_player_id,'pending_payment',v_op.id,null,jsonb_build_object('provider',v_op.provider,'paymentMethod',v_op.payment_method,'reserveAccountId',v_account_id))
    returning * into v_asset;
    insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata)
    values(v_asset.id,v_account_id,v_funding_entry_id,v_price,'active',jsonb_build_object('operationId',v_op.id,'operationUnit',v_unit));
    update public.flow_assets set status='available',backed_at=now() where id=v_asset.id returning * into v_asset;
    insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
    values(v_asset.id,'issued',v_asset.owner_user_id,v_asset.owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account_id));
  end loop;

  update public.flow_purchase_operations set issued_at=now(),updated_at=now() where id=v_op.id;
  update public.flow_funding_ledger set custody_stage='allocated' where operation_id=v_op.id and entry_type in ('funding','reserve_deposit') and custody_stage not in ('reversed','refunded');
  perform public.adjust_flows_balance(v_op.recipient_user_id,v_op.quantity,'purchase',case when v_op.provider='cash' then 'cash_backed' else 'flow_purchase' end,v_op.id::text,jsonb_build_object('operationId',v_op.id,'provider',v_op.provider,'quantity',v_op.quantity),p_confirmed_by);
  perform public.flow_project_event(v_op.recipient_user_id,'flow_issued','FLOWS emitidos contra dinero ya confirmado en la Reserva CLOUVA y asignado 1:1.',v_op.id,p_confirmed_by,jsonb_build_object('quantity',v_op.quantity,'provider',v_op.provider,'requiredBackingUsd',v_required_usd,'processingFeeAmount',v_op.processing_fee_amount));
  return jsonb_build_object('operationId',v_op.id,'issued',v_op.quantity,'alreadyIssued',false,'backingStatus','verified');
end $$;

revoke all on function public.issue_flows_for_operation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.issue_flows_for_operation(uuid,uuid) to service_role;

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

  insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,confirmed_by,occurred_at,provider_fee,net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage,metadata)
  values(v_op.id,'reserve_deposit',v_account.provider,'reserve_deposit',p_amount,upper(p_currency),'confirmed',p_idempotency_key,p_confirmed_by,coalesce(p_occurred_at,now()),0,p_amount,v_account.id,'confirmed',trim(p_custody_reference),coalesce(p_occurred_at,now()),p_reference_usd_amount,'reserve_confirmed',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('operationId',v_op.id,'historicalFxRate',v_op.fx_rate_original_per_usd,'historicalFxSource',v_op.fx_source,'historicalFxQuotedAt',v_op.fx_quoted_at))
  returning * into v_entry;

  if v_op.provider='mercadopago' then
    if coalesce(v_op.metadata->>'processorNetReferenceUsd','') ~ '^[0-9]+([.][0-9]+)?$' then v_processor_net_usd:=(v_op.metadata->>'processorNetReferenceUsd')::numeric;
    elsif v_op.net_amount is not null then
      if upper(v_op.currency)='USD' then v_processor_net_usd:=v_op.net_amount;
      elsif v_op.fx_rate_original_per_usd is not null and v_op.fx_rate_original_per_usd>0 then v_processor_net_usd:=v_op.net_amount/v_op.fx_rate_original_per_usd;
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
  set backing_status='pending',metadata=metadata||jsonb_build_object('paymentStage',case when v_total_reference_usd+0.000001>=v_required_transfer_usd and v_required_transfer_usd>0 then 'reserve_confirmed' else 'transfer_pending' end,'reserveTransferredReferenceUsd',v_total_reference_usd),updated_at=now()
  where id=v_op.id and backing_status<>'verified';

  select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
  if coalesce(v_result->>'backingStatus','')='verified' then
    update public.flow_funding_ledger set custody_stage='allocated' where operation_id=v_op.id and entry_type in ('funding','reserve_deposit') and custody_stage not in ('reversed','refunded');
    update public.flow_purchase_operations set metadata=metadata||jsonb_build_object('paymentStage','allocated'),updated_at=now() where id=v_op.id;
  end if;
  perform public.flow_project_event(v_op.recipient_user_id,'reserve_deposit_confirmed','Ingreso real confirmado en la Reserva CLOUVA.',v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account.id,'referenceUsdAmount',p_reference_usd_amount,'fundingEntryId',v_entry.id,'custodyReference',trim(p_custody_reference)));
  return jsonb_build_object('duplicate',false,'fundingEntryId',v_entry.id,'operationId',v_op.id,'issued',v_result);
end $$;

revoke all on function public.confirm_flow_reserve_deposit(uuid,uuid,numeric,text,numeric,text,timestamptz,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.confirm_flow_reserve_deposit(uuid,uuid,numeric,text,numeric,text,timestamptz,text,uuid,jsonb) to service_role;

create or replace function public.flow_treasury_snapshot()
returns jsonb
language sql
security definer
set search_path='public'
as $$
with settings as (
  select flow_usd_value,processing_fee_policy,processing_fee_bps,processing_fee_fixed_usd from public.flow_issuance_settings where id='canonical'
), reserve_accounts as (
  select id from public.flow_reserve_accounts where flow_account_role='reserve' and authorized_for_flow and is_active and status='active' and account_reference is not null
), reserve as (
  select
    coalesce(sum(f.reference_usd_amount) filter(where f.status='confirmed' and f.custody_status='confirmed' and f.custody_stage in ('reserve_confirmed','allocated') and f.entry_type='reserve_deposit' and f.reserve_account_id in(select id from reserve_accounts)),0) -
    coalesce(sum(f.reference_usd_amount) filter(where f.status='confirmed' and f.entry_type in ('refund','reversal','reserve_release') and f.custody_status in ('confirmed','released','reversed') and f.reserve_account_id in(select id from reserve_accounts)),0) total_reserve
  from public.flow_funding_ledger f
), allocated as (
  select coalesce(sum(b.reference_usd_value),0) allocated_reserve
  from public.flow_backing_allocations b where b.status='active' and b.reserve_account_id in(select id from reserve_accounts)
), counts as (
  select
    (select count(*) from public.flow_assets a where a.status in('available','activated','transferred') and exists(select 1 from public.flow_backing_allocations b join public.flow_reserve_accounts r on r.id=b.reserve_account_id where b.flow_asset_id=a.id and b.status='active' and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active'))::integer backed_assets,
    (select count(*) from public.flow_assets a where a.status='legacy_unverified' or (a.status in('available','activated','transferred') and not exists(select 1 from public.flow_backing_allocations b join public.flow_reserve_accounts r on r.id=b.reserve_account_id where b.flow_asset_id=a.id and b.status='active' and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active')))::integer unbacked_assets,
    (select coalesce(sum(balance),0) from public.flows_wallets)::integer circulation,
    (select count(*) from public.flow_purchase_operations where status='pending')::integer pending_purchases,
    (select count(*) from public.flow_purchase_operations where status='confirmed')::integer confirmed_purchases,
    (select count(*) from public.flow_purchase_operations where status='failed')::integer failed_purchases,
    (select count(*) from public.flow_purchase_operations where issued_at is not null)::integer emissions,
    (select count(*) from public.flow_refund_cases)::integer refund_cases,
    (select count(*) from public.flow_refund_cases where status='pending_review')::integer refund_reviews,
    ((select count(*) from public.flow_assets where status='legacy_unverified') + (select coalesce(sum(quantity),0) from public.flow_purchase_operations where status='confirmed' and backing_status='pending' and issued_at is null))::integer pending_backing_flows,
    (select count(*) from public.flow_purchase_operations where provider='mercadopago' and status='confirmed' and backing_status='pending')::integer payments_awaiting_reserve
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
select jsonb_build_object(
  'flowUsdValue',settings.flow_usd_value,
  'processingFeePolicy',settings.processing_fee_policy,
  'processingFeeBps',settings.processing_fee_bps,
  'processingFeeFixedUsd',settings.processing_fee_fixed_usd,
  'backedAssets',counts.backed_assets,'circulation',counts.circulation,'unbackedAssets',counts.unbacked_assets,
  'backingDifferenceFlows',counts.backed_assets-counts.circulation,'pendingBackingFlows',counts.pending_backing_flows,
  'paymentsAwaitingReserve',counts.payments_awaiting_reserve,
  'totalReserveUsd',reserve.total_reserve,'allocatedReserveUsd',allocated.allocated_reserve,'freeReserveUsd',reserve.total_reserve-allocated.allocated_reserve,
  'reserveDeficit',(allocated.allocated_reserve>reserve.total_reserve+0.000001),
  'pendingPurchases',counts.pending_purchases,'confirmedPurchases',counts.confirmed_purchases,'failedPurchases',counts.failed_purchases,
  'emissions',counts.emissions,'refundCases',counts.refund_cases,'refundReviews',counts.refund_reviews,'fundingByCurrency',money.rows
) from counts,money,reserve,allocated,settings;
$$;

revoke all on function public.flow_treasury_snapshot() from public, anon, authenticated;
grant execute on function public.flow_treasury_snapshot() to service_role;

create or replace function public.flow_reconciliation_report()
returns jsonb
language sql
security definer
set search_path='public'
as $$
with issues as (
  select 'collection_rail_marked_as_reserve'::text issue_type,'critical'::text severity,r.id::text entity_id,jsonb_build_object('name',r.name,'provider',r.provider) details
  from public.flow_reserve_accounts r where r.flow_account_role='collection_rail' and r.authorized_for_flow
  union all
  select 'reserve_marked_as_collection_rail','critical',r.id::text,jsonb_build_object('name',r.name,'provider',r.provider)
  from public.flow_reserve_accounts r where r.flow_account_role='reserve' and r.authorized_for_collection
  union all
  select 'processor_funding_claims_custody','critical',f.id::text,jsonb_build_object('operationId',f.operation_id,'provider',f.provider,'custodyStatus',f.custody_status,'reserveAccountId',f.reserve_account_id)
  from public.flow_funding_ledger f where f.entry_type='funding' and f.provider='mercadopago' and (f.reserve_account_id is not null or f.custody_status='confirmed' or coalesce(f.reference_usd_amount,0)>0)
  union all
  select 'spendable_without_backing_allocation','critical',a.id::text,jsonb_build_object('flowNumber',a.flow_number,'status',a.status)
  from public.flow_assets a where a.status in('available','activated','transferred') and not exists(select 1 from public.flow_backing_allocations b where b.flow_asset_id=a.id and b.status='active')
  union all
  select 'spendable_with_invalid_reserve','critical',a.id::text,jsonb_build_object('flowNumber',a.flow_number,'reserveAccountId',b.reserve_account_id)
  from public.flow_assets a join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  left join public.flow_reserve_accounts r on r.id=b.reserve_account_id
  where a.status in('available','activated','transferred') and (r.id is null or r.flow_account_role<>'reserve' or not r.is_active or r.status<>'active' or not r.authorized_for_flow or r.account_reference is null)
  union all
  select 'reserve_overallocated','critical',r.id::text,jsonb_build_object('name',r.name,'freeUsd',public.flow_reserve_account_free_usd(r.id))
  from public.flow_reserve_accounts r where r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and public.flow_reserve_account_free_usd(r.id)<-0.000001
  union all
  select 'custody_confirmed_without_authorized_reserve','critical',f.id::text,jsonb_build_object('operationId',f.operation_id,'entryType',f.entry_type,'reserveAccountId',f.reserve_account_id)
  from public.flow_funding_ledger f left join public.flow_reserve_accounts r on r.id=f.reserve_account_id
  where f.entry_type='reserve_deposit' and f.status='confirmed' and f.custody_status='confirmed'
    and (r.id is null or r.flow_account_role<>'reserve' or not r.authorized_for_flow or not r.is_active or r.status<>'active' or r.account_reference is null)
  union all
  select 'active_allocation_on_nonspendable_asset','critical',b.id::text,jsonb_build_object('flowAssetId',a.id,'flowNumber',a.flow_number,'assetStatus',a.status)
  from public.flow_backing_allocations b join public.flow_assets a on a.id=b.flow_asset_id where b.status='active' and a.status not in('available','activated','transferred')
  union all
  select 'wallet_backing_mismatch','critical',w.user_id::text,jsonb_build_object('walletBalance',w.balance,'backedAssets',coalesce(x.backed,0))
  from public.flows_wallets w
  left join lateral(
    select count(*)::integer backed from public.flow_assets a where a.owner_user_id=w.user_id and a.status in('available','activated','transferred')
      and exists(select 1 from public.flow_backing_allocations b join public.flow_reserve_accounts r on r.id=b.reserve_account_id join public.flow_funding_ledger f on f.id=b.funding_entry_id where b.flow_asset_id=a.id and b.status='active' and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null and f.entry_type='reserve_deposit' and f.custody_status='confirmed')
  ) x on true
  where w.balance<>coalesce(x.backed,0)
  union all
  select 'wallet_ledger_mismatch','critical',w.user_id::text,jsonb_build_object('walletBalance',w.balance,'ledgerSum',coalesce(x.total,0))
  from public.flows_wallets w left join lateral(select sum(l.amount)::integer total from public.flows_wallet_ledger l where l.user_id=w.user_id)x on true
  where w.balance<>coalesce(x.total,0)
  union all
  select 'reserve_account_not_authorized','warning',r.id::text,jsonb_build_object('name',r.name,'provider',r.provider,'currency',r.currency,'hasAccountReference',r.account_reference is not null)
  from public.flow_reserve_accounts r where r.flow_account_role='reserve' and r.is_active and r.status='active' and not r.authorized_for_flow
  union all
  select 'legacy_unverified','warning',a.id::text,jsonb_build_object('flowNumber',a.flow_number,'ownerUserId',a.owner_user_id) from public.flow_assets a where a.status='legacy_unverified'
  union all
  select 'confirmed_pending_backing','warning',o.id::text,jsonb_build_object('provider',o.provider,'quantity',o.quantity,'issuedAt',o.issued_at,'paymentStage',o.metadata->'paymentStage','shortfallUsd',o.metadata->'backingShortfallUsd','reserveTransferShortfallUsd',o.metadata->'reserveTransferShortfallUsd')
  from public.flow_purchase_operations o where o.status='confirmed' and o.backing_status in('pending','legacy_unverified')
  union all
  select 'stale_pending_purchase','warning',o.id::text,jsonb_build_object('createdAt',o.created_at,'provider',o.provider,'operationType',o.operation_type)
  from public.flow_purchase_operations o where o.status='pending' and o.created_at<now()-interval '24 hours'
  union all
  select 'duplicate_provider_payment','critical',min(o.id::text),jsonb_build_object('provider',o.provider,'providerPaymentId',o.provider_payment_id,'count',count(*))
  from public.flow_purchase_operations o where o.provider_payment_id is not null group by o.provider,o.provider_payment_id having count(*)>1
  union all
  select 'duplicate_funding_payment','critical',min(f.id::text),jsonb_build_object('provider',f.provider,'externalPaymentId',f.external_payment_id,'count',count(*))
  from public.flow_funding_ledger f where f.entry_type='funding' and f.external_payment_id is not null group by f.provider,f.external_payment_id having count(*)>1
)
select coalesce(jsonb_agg(jsonb_build_object('type',issue_type,'severity',severity,'entityId',entity_id,'details',details) order by severity,issue_type),'[]'::jsonb) from issues;
$$;

revoke all on function public.flow_reconciliation_report() from public, anon, authenticated;
grant execute on function public.flow_reconciliation_report() to service_role;
