alter table public.flow_issuance_settings
  add column if not exists processing_fee_policy text not null default 'clouva_absorbs',
  add column if not exists processing_fee_bps numeric not null default 0,
  add column if not exists processing_fee_fixed_usd numeric not null default 0;

alter table public.flow_issuance_settings drop constraint if exists flow_issuance_settings_processing_fee_policy_check;
alter table public.flow_issuance_settings add constraint flow_issuance_settings_processing_fee_policy_check
  check (processing_fee_policy in ('clouva_absorbs','customer_buffer'));
alter table public.flow_issuance_settings drop constraint if exists flow_issuance_settings_processing_fee_bps_check;
alter table public.flow_issuance_settings add constraint flow_issuance_settings_processing_fee_bps_check
  check (processing_fee_bps >= 0 and processing_fee_bps <= 10000);
alter table public.flow_issuance_settings drop constraint if exists flow_issuance_settings_processing_fee_fixed_usd_check;
alter table public.flow_issuance_settings add constraint flow_issuance_settings_processing_fee_fixed_usd_check
  check (processing_fee_fixed_usd >= 0);

alter table public.flow_purchase_operations
  add column if not exists required_backing_usd numeric,
  add column if not exists backing_amount numeric,
  add column if not exists processing_fee_amount numeric not null default 0,
  add column if not exists processing_fee_policy text not null default 'legacy';

update public.flow_purchase_operations
set required_backing_usd=coalesce(required_backing_usd, quantity*unit_usd),
    backing_amount=coalesce(
      backing_amount,
      case
        when upper(currency)='USD' then quantity*unit_usd
        when fx_rate_original_per_usd is not null and fx_rate_original_per_usd>0 then quantity*unit_usd*fx_rate_original_per_usd
        else amount
      end
    );

update public.flow_purchase_operations
set processing_fee_amount=greatest(amount-backing_amount,0)
where processing_fee_amount=0 and amount>backing_amount;

alter table public.flow_purchase_operations alter column required_backing_usd set not null;
alter table public.flow_purchase_operations alter column backing_amount set not null;
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_required_backing_usd_check;
alter table public.flow_purchase_operations add constraint flow_purchase_required_backing_usd_check check (required_backing_usd>0);
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_backing_amount_check;
alter table public.flow_purchase_operations add constraint flow_purchase_backing_amount_check check (backing_amount>0 and amount+0.01>=backing_amount);
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_processing_fee_amount_check;
alter table public.flow_purchase_operations add constraint flow_purchase_processing_fee_amount_check check (processing_fee_amount>=0);
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_processing_fee_policy_check;
alter table public.flow_purchase_operations add constraint flow_purchase_processing_fee_policy_check check (processing_fee_policy in ('legacy','clouva_absorbs','customer_buffer'));

alter table public.flow_reserve_accounts
  add column if not exists authorized_for_flow boolean not null default false,
  add column if not exists authorized_at timestamptz,
  add column if not exists authorized_by uuid references auth.users(id) on delete set null;

create index if not exists flow_reserve_accounts_authorized_idx
  on public.flow_reserve_accounts(provider,currency,account_reference)
  where authorized_for_flow and is_active and status='active' and account_reference is not null;

create or replace function public.guard_flow_reserve_account_authorization()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
begin
  if exists(select 1 from public.flow_backing_allocations b where b.reserve_account_id=old.id and b.status='active') then
    if not new.authorized_for_flow or not new.is_active or new.status<>'active'
       or new.provider is distinct from old.provider
       or new.currency is distinct from old.currency
       or new.account_reference is distinct from old.account_reference then
      raise exception 'No se puede desautorizar o mutar una cuenta de reserva con respaldo FLOW activo.';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_flow_reserve_account_authorization() from public, anon, authenticated;
grant execute on function public.guard_flow_reserve_account_authorization() to service_role;

drop trigger if exists trg_guard_flow_reserve_account_authorization on public.flow_reserve_accounts;
create trigger trg_guard_flow_reserve_account_authorization
before update on public.flow_reserve_accounts
for each row execute function public.guard_flow_reserve_account_authorization();

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
      select * into v_op from public.flow_purchase_operations where id=p_reference_id::uuid;
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
    join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
    join public.flow_reserve_accounts r on r.id=b.reserve_account_id
      and r.is_active and r.status='active' and r.authorized_for_flow and r.account_reference is not null
    where a.backing_operation_id=v_op.id
      and a.owner_user_id=p_user_id
      and a.status in ('available','activated','transferred');

    if v_backed_count<>p_amount then
      raise exception 'La wallet no puede acreditarse sin un respaldo 1:1 por FLOW en una cuenta autorizada.';
    end if;

    if exists (
      select 1 from public.flow_reserve_accounts r
      where r.authorized_for_flow and r.is_active and r.status='active'
        and public.flow_reserve_account_free_usd(r.id)<-0.000001
    ) then
      raise exception 'La reserva quedaría sobreasignada.';
    end if;
  end if;

  insert into public.flows_wallets(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
  select balance into v_balance from public.flows_wallets where user_id=p_user_id for update;
  v_new:=v_balance+p_amount;
  if v_new<0 then raise exception 'Saldo de Flows insuficiente.'; end if;
  update public.flows_wallets set balance=v_new,updated_at=now() where user_id=p_user_id;
  insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,source,reference_id,metadata,created_by)
  values(p_user_id,p_transaction_type,p_amount,v_new,p_source,p_reference_id,coalesce(p_metadata,'{}'::jsonb),p_created_by)
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.adjust_flows_balance(uuid,integer,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.adjust_flows_balance(uuid,integer,text,text,text,jsonb,uuid) to service_role;

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
        and r.is_active and r.status='active' and r.authorized_for_flow and r.account_reference is not null
        and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
        and f.entry_type in ('funding','reserve_deposit') and coalesce(f.reference_usd_amount,0)>0
    ) then
      raise exception 'El FLOW no tiene una asignación 1:1 activa contra dinero custodiado en una reserva autorizada.';
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
  v_result jsonb;
  v_fee numeric:=0;
  v_net numeric;
  v_reference_usd numeric:=0;
  v_required_usd numeric;
  v_account public.flow_reserve_accounts%rowtype;
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

  if v_collector is not null then
    select * into v_account
    from public.flow_reserve_accounts
    where provider=p_provider and upper(currency)=upper(p_currency)
      and account_reference=v_collector
      and authorized_for_flow and is_active and status='active'
    order by created_at
    limit 1 for update;
    v_authorized:=found;
  end if;

  if v_authorized then
    if upper(p_currency)='USD' then
      v_reference_usd:=v_net;
    else
      if v_op.fx_rate_original_per_usd is null or v_op.fx_rate_original_per_usd<=0 then raise exception 'No existe FX canónico para calcular la reserva neta.'; end if;
      v_reference_usd:=v_net/v_op.fx_rate_original_per_usd;
    end if;
  end if;

  update public.flow_purchase_operations
  set status='confirmed',
      backing_status=case when backing_status='verified' then 'verified' else 'pending' end,
      provider_payment_id=p_provider_payment_id,
      confirmed_at=coalesce(confirmed_at,p_confirmed_at,now()),
      provider_fee=v_fee,
      net_amount=v_net,
      metadata=(metadata - 'custodyRejectedReason') || jsonb_build_object(
        'collectorId',v_collector,
        'custodyConfirmed',v_authorized,
        'reserveAccountId',case when v_authorized then to_jsonb(v_account.id) else 'null'::jsonb end,
        'paymentNetReferenceUsd',v_reference_usd,
        'paymentNetBackingShortfallUsd',greatest(v_required_usd-v_reference_usd,0)
      ) || case when v_authorized then '{}'::jsonb else jsonb_build_object('custodyRejectedReason','collector_not_authorized') end,
      updated_at=now()
  where id=v_op.id;

  insert into public.flow_funding_ledger(
    operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,idempotency_key,occurred_at,
    provider_fee,net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,metadata
  ) values(
    v_op.id,'funding',v_op.provider,v_op.payment_method,v_op.amount,upper(v_op.currency),'confirmed',p_provider_payment_id,p_idempotency_key,coalesce(p_confirmed_at,now()),
    v_fee,v_net,case when v_authorized then v_account.id else null end,
    case when v_authorized then 'confirmed' else 'not_in_reserve' end,
    case when v_authorized then p_provider_payment_id else null end,
    case when v_authorized then coalesce(p_confirmed_at,now()) else null end,
    case when v_authorized then v_reference_usd else 0 end,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('collectorAuthorized',v_authorized,'requiredBackingUsd',v_required_usd)
  )
  on conflict(idempotency_key) do update set
    provider_fee=excluded.provider_fee,
    net_amount=excluded.net_amount,
    reserve_account_id=excluded.reserve_account_id,
    custody_status=excluded.custody_status,
    custody_reference=excluded.custody_reference,
    custody_confirmed_at=excluded.custody_confirmed_at,
    reference_usd_amount=excluded.reference_usd_amount,
    metadata=public.flow_funding_ledger.metadata||excluded.metadata;

  insert into public.flow_payment_documents(operation_id,kind,provider,document_type,status,issuer,recipient,amount,currency,document_number,issued_at,metadata)
  values(v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',jsonb_build_object('name','CLOUVA'),jsonb_build_object('userId',v_op.recipient_user_id,'playerId',v_op.recipient_player_id),v_op.amount,upper(v_op.currency),'FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12)),coalesce(p_confirmed_at,now()),jsonb_build_object('internalOnly',true,'fiscalDocument',false,'providerPaymentId',p_provider_payment_id,'providerFee',v_fee,'netAmount',v_net,'reserveAccountId',case when v_authorized then v_account.id else null end,'collectorAuthorized',v_authorized))
  on conflict(operation_id,kind,provider) do nothing;

  if not v_authorized then
    perform public.flow_project_event(v_op.recipient_user_id,'payment_confirmed','Pago confirmado, pero el collector no está autorizado como cuenta de reserva FLOW.',v_op.id,null,jsonb_build_object('provider',v_op.provider,'amount',v_op.amount,'currency',v_op.currency,'collectorId',v_collector,'custodyStatus','not_in_reserve'));
    return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','custodyStatus','not_in_reserve','reason','collector_not_authorized');
  end if;

  perform public.flow_project_event(v_op.recipient_user_id,'payment_confirmed','Pago confirmado y custodiado en una cuenta de reserva FLOW autorizada.',v_op.id,null,jsonb_build_object('provider',v_op.provider,'amount',v_op.amount,'currency',v_op.currency,'providerFee',v_fee,'netAmount',v_net,'referenceUsdAmount',v_reference_usd,'requiredBackingUsd',v_required_usd,'reserveAccountId',v_account.id));
  select public.issue_flows_for_operation(v_op.id,null) into v_result;
  return v_result;
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
    if v_op.fx_rate_original_per_usd is null or v_op.fx_rate_original_per_usd<=0 or v_op.fx_source is null or v_op.fx_quoted_at is null then raise exception 'La moneda requiere cotización canónica.'; end if;
    v_expected_backing_amount:=v_required_usd*v_op.fx_rate_original_per_usd;
  end if;
  if abs(v_op.backing_amount-v_expected_backing_amount)>0.02 then raise exception 'El monto de backing no coincide con la cotización histórica.'; end if;
  if v_op.amount+0.01<v_op.backing_amount then raise exception 'El checkout no cubre el backing requerido.'; end if;
  if abs(v_op.processing_fee_amount-greatest(v_op.amount-v_op.backing_amount,0))>0.02 then raise exception 'El desglose de procesamiento no coincide con el total cobrado.'; end if;

  if not exists (
    select 1 from public.flow_funding_ledger f
    join public.flow_reserve_accounts r on r.id=f.reserve_account_id
    where f.operation_id=v_op.id and f.entry_type='funding' and f.status='confirmed'
      and f.custody_status='confirmed' and coalesce(f.reference_usd_amount,0)>0
      and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  ) then
    update public.flow_purchase_operations set backing_status='pending',updated_at=now() where id=v_op.id and backing_status<>'verified';
    return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','reason','custody_not_confirmed');
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
      join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.authorized_for_flow and r.is_active and r.status='active'
      where a.backing_operation_id=v_op.id and a.status in ('available','activated','transferred');
      if v_active_count=v_op.quantity and v_op.backing_status<>'verified' then update public.flow_purchase_operations set backing_status='verified',updated_at=now() where id=v_op.id; end if;
      return jsonb_build_object('operationId',v_op.id,'issued',v_active_count,'alreadyIssued',true,'backingStatus','verified');
    end if;
    v_needed:=v_existing_count;
  else
    v_needed:=v_op.quantity;
  end if;

  for r_account in
    select id from public.flow_reserve_accounts
    where authorized_for_flow and is_active and status='active' and account_reference is not null
    order by id for update
  loop
    v_free:=greatest(public.flow_reserve_account_free_usd(r_account.id),0);
    v_allocatable:=v_allocatable+floor(v_free/v_price)::integer;
  end loop;

  if v_allocatable<v_needed then
    v_shortfall:=(v_needed-v_allocatable)*v_price;
    update public.flow_purchase_operations
    set backing_status='pending',metadata=(metadata-'backingShortfallUsd')||jsonb_build_object('backingShortfallUsd',v_shortfall,'reserveCheckedAt',now()),updated_at=now()
    where id=v_op.id;
    return jsonb_build_object('operationId',v_op.id,'issued',0,'alreadyIssued',false,'backingStatus','pending','backingShortfallUsd',v_shortfall);
  end if;

  update public.flow_purchase_operations
  set backing_status='verified',metadata=(metadata-'backingShortfallUsd')||jsonb_build_object('reserveVerifiedAt',now()),updated_at=now()
  where id=v_op.id;

  if v_op.operation_type='back_existing' then
    if v_op.target_asset_id is null or v_op.quantity<>1 then raise exception 'Operación de respaldo legacy inválida.'; end if;
    select * into v_asset from public.flow_assets where id=v_op.target_asset_id for update;
    if not found or v_asset.owner_user_id<>v_op.recipient_user_id then raise exception 'FLOW legacy inválido.'; end if;
    if v_asset.status<>'legacy_unverified' then raise exception 'El FLOW ya está respaldado o no admite respaldo.'; end if;

    v_account_id:=null;
    for r_account in select id from public.flow_reserve_accounts where authorized_for_flow and is_active and status='active' and account_reference is not null order by id loop
      if public.flow_reserve_account_free_usd(r_account.id)>=v_price then v_account_id:=r_account.id; exit; end if;
    end loop;
    if v_account_id is null then raise exception 'La reserva cambió durante la emisión.'; end if;
    select id into v_funding_entry_id from public.flow_funding_ledger
      where reserve_account_id=v_account_id and status='confirmed' and custody_status='confirmed' and entry_type in ('funding','reserve_deposit')
      order by (operation_id=v_op.id) desc, occurred_at desc limit 1;
    if v_funding_entry_id is null then raise exception 'No existe una fuente de custodia confirmada para la asignación.'; end if;

    insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata)
    values(v_asset.id,v_account_id,v_funding_entry_id,v_price,'active',jsonb_build_object('operationId',v_op.id,'reason','back_existing'));
    update public.flow_assets set status='available',backing_operation_id=v_op.id,backed_at=now(),metadata=metadata||jsonb_build_object('backedByOperationId',v_op.id,'reserveAccountId',v_account_id) where id=v_asset.id;
    insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
    values(v_asset.id,'backed',v_asset.owner_user_id,v_asset.owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account_id));
    update public.flow_purchase_operations set issued_at=coalesce(issued_at,now()),updated_at=now() where id=v_op.id;
    perform public.adjust_flows_balance(v_op.recipient_user_id,1,'purchase','flow_backing',v_op.id::text,jsonb_build_object('operationId',v_op.id,'targetAssetId',v_asset.id,'reserveAccountId',v_account_id),p_confirmed_by);
    return jsonb_build_object('operationId',v_op.id,'issued',1,'alreadyIssued',false,'backingStatus','verified','targetAssetId',v_asset.id);
  end if;

  if v_op.issued_at is not null and v_existing_count>0 then
    for r_asset in select * from public.flow_assets where operation_id=v_op.id and status='legacy_unverified' order by flow_number for update loop
      v_account_id:=null;
      for r_account in select id from public.flow_reserve_accounts where authorized_for_flow and is_active and status='active' and account_reference is not null order by id loop
        if public.flow_reserve_account_free_usd(r_account.id)>=v_price then v_account_id:=r_account.id; exit; end if;
      end loop;
      if v_account_id is null then raise exception 'La reserva cambió durante la reconciliación.'; end if;
      select id into v_funding_entry_id from public.flow_funding_ledger
        where reserve_account_id=v_account_id and status='confirmed' and custody_status='confirmed' and entry_type in ('funding','reserve_deposit')
        order by (operation_id=v_op.id) desc, occurred_at desc limit 1;
      if v_funding_entry_id is null then raise exception 'No existe una fuente de custodia confirmada para la reconciliación.'; end if;
      insert into public.flow_backing_allocations(flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,metadata)
      values(r_asset.id,v_account_id,v_funding_entry_id,v_price,'active',jsonb_build_object('operationId',v_op.id,'reason','historical_reconciliation'));
      update public.flow_assets set status='available',backing_operation_id=v_op.id,backed_at=now(),metadata=metadata||jsonb_build_object('reserveAccountId',v_account_id,'reconciledCustodyAt',now()) where id=r_asset.id;
      insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
      values(r_asset.id,'backed',r_asset.owner_user_id,r_asset.owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account_id,'historical',true));
    end loop;
    perform public.adjust_flows_balance(v_op.recipient_user_id,v_existing_count,'purchase','reserve_reconciliation',v_op.id::text,jsonb_build_object('operationId',v_op.id,'quantity',v_existing_count),p_confirmed_by);
    perform public.flow_project_event(v_op.recipient_user_id,'flow_backed','FLOW histórico reactivado después de confirmar custodia en reserva.',v_op.id,p_confirmed_by,jsonb_build_object('quantity',v_existing_count));
    return jsonb_build_object('operationId',v_op.id,'issued',v_existing_count,'alreadyIssued',false,'backingStatus','verified','reconciled',true);
  end if;

  for v_unit in 1..v_op.quantity loop
    v_account_id:=null;
    for r_account in select id from public.flow_reserve_accounts where authorized_for_flow and is_active and status='active' and account_reference is not null order by id loop
      if public.flow_reserve_account_free_usd(r_account.id)>=v_price then v_account_id:=r_account.id; exit; end if;
    end loop;
    if v_account_id is null then raise exception 'La reserva cambió durante la emisión.'; end if;
    select id into v_funding_entry_id from public.flow_funding_ledger
      where reserve_account_id=v_account_id and status='confirmed' and custody_status='confirmed' and entry_type in ('funding','reserve_deposit')
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
  perform public.adjust_flows_balance(v_op.recipient_user_id,v_op.quantity,'purchase',case when v_op.provider='cash' then 'cash_backed' else 'flow_purchase' end,v_op.id::text,jsonb_build_object('operationId',v_op.id,'provider',v_op.provider,'quantity',v_op.quantity),p_confirmed_by);
  perform public.flow_project_event(v_op.recipient_user_id,'flow_issued','FLOWS emitidos contra reserva real custodiada, autorizada y asignada 1:1.',v_op.id,p_confirmed_by,jsonb_build_object('quantity',v_op.quantity,'provider',v_op.provider,'requiredBackingUsd',v_required_usd,'processingFeeAmount',v_op.processing_fee_amount));
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
begin
  if p_confirmed_by is null or p_amount<=0 or p_reference_usd_amount<=0 or coalesce(trim(p_idempotency_key),'')='' then raise exception 'Depósito de reserva inválido.'; end if;
  select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
  if not found or v_op.status<>'confirmed' or v_op.status='refunded' then raise exception 'La operación no admite respaldo.'; end if;
  select * into v_account from public.flow_reserve_accounts
    where id=p_reserve_account_id and authorized_for_flow and account_reference is not null and is_active and status='active' for update;
  if not found then raise exception 'Cuenta de reserva no autorizada para FLOW.'; end if;
  if upper(v_account.currency)<>upper(p_currency) then raise exception 'La moneda del depósito no coincide con la cuenta de reserva.'; end if;

  select * into v_existing from public.flow_funding_ledger where idempotency_key=p_idempotency_key;
  if found then
    select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
    return jsonb_build_object('duplicate',true,'fundingEntryId',v_existing.id,'operationId',v_op.id,'issued',v_result);
  end if;

  insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,confirmed_by,occurred_at,provider_fee,net_amount,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,metadata)
  values(v_op.id,'reserve_deposit',v_account.provider,'reserve_deposit',p_amount,upper(p_currency),'confirmed',p_idempotency_key,p_confirmed_by,coalesce(p_occurred_at,now()),0,p_amount,v_account.id,'confirmed',nullif(trim(coalesce(p_custody_reference,'')),''),coalesce(p_occurred_at,now()),p_reference_usd_amount,coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('operationId',v_op.id))
  returning * into v_entry;

  update public.flow_purchase_operations set backing_status='pending',updated_at=now() where id=v_op.id and backing_status<>'verified';
  select public.issue_flows_for_operation(v_op.id,p_confirmed_by) into v_result;
  perform public.flow_project_event(v_op.recipient_user_id,'reserve_deposit_confirmed','Depósito confirmado en una cuenta de reserva FLOW autorizada.',v_op.id,p_confirmed_by,jsonb_build_object('reserveAccountId',v_account.id,'referenceUsdAmount',p_reference_usd_amount,'fundingEntryId',v_entry.id));
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
), authorized_accounts as (
  select id from public.flow_reserve_accounts where authorized_for_flow and is_active and status='active' and account_reference is not null
), reserve as (
  select
    coalesce(sum(f.reference_usd_amount) filter(where f.status='confirmed' and f.custody_status='confirmed' and f.entry_type in ('funding','reserve_deposit') and f.reserve_account_id in(select id from authorized_accounts)),0) -
    coalesce(sum(f.reference_usd_amount) filter(where f.status='confirmed' and f.entry_type in ('refund','reversal','reserve_release') and f.custody_status in ('confirmed','released','reversed') and f.reserve_account_id in(select id from authorized_accounts)),0) total_reserve
  from public.flow_funding_ledger f
), allocated as (
  select coalesce(sum(b.reference_usd_value),0) allocated_reserve
  from public.flow_backing_allocations b where b.status='active' and b.reserve_account_id in(select id from authorized_accounts)
), counts as (
  select
    (select count(*) from public.flow_assets a where a.status in('available','activated','transferred') and exists(select 1 from public.flow_backing_allocations b join public.flow_reserve_accounts r on r.id=b.reserve_account_id where b.flow_asset_id=a.id and b.status='active' and r.authorized_for_flow and r.is_active and r.status='active'))::integer backed_assets,
    (select count(*) from public.flow_assets a where a.status='legacy_unverified' or (a.status in('available','activated','transferred') and not exists(select 1 from public.flow_backing_allocations b join public.flow_reserve_accounts r on r.id=b.reserve_account_id where b.flow_asset_id=a.id and b.status='active' and r.authorized_for_flow and r.is_active and r.status='active')))::integer unbacked_assets,
    (select coalesce(sum(balance),0) from public.flows_wallets)::integer circulation,
    (select count(*) from public.flow_purchase_operations where status='pending')::integer pending_purchases,
    (select count(*) from public.flow_purchase_operations where status='confirmed')::integer confirmed_purchases,
    (select count(*) from public.flow_purchase_operations where status='failed')::integer failed_purchases,
    (select count(*) from public.flow_purchase_operations where issued_at is not null)::integer emissions,
    (select count(*) from public.flow_refund_cases)::integer refund_cases,
    (select count(*) from public.flow_refund_cases where status='pending_review')::integer refund_reviews,
    ((select count(*) from public.flow_assets where status='legacy_unverified') + (select coalesce(sum(quantity),0) from public.flow_purchase_operations where status='confirmed' and backing_status='pending' and issued_at is null))::integer pending_backing_flows
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
  select 'spendable_without_backing_allocation'::text issue_type,'critical'::text severity,a.id::text entity_id,jsonb_build_object('flowNumber',a.flow_number,'status',a.status) details
  from public.flow_assets a where a.status in('available','activated','transferred') and not exists(select 1 from public.flow_backing_allocations b where b.flow_asset_id=a.id and b.status='active')
  union all
  select 'spendable_with_invalid_reserve','critical',a.id::text,jsonb_build_object('flowNumber',a.flow_number,'reserveAccountId',b.reserve_account_id)
  from public.flow_assets a join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  left join public.flow_reserve_accounts r on r.id=b.reserve_account_id
  where a.status in('available','activated','transferred') and (r.id is null or not r.is_active or r.status<>'active' or not r.authorized_for_flow or r.account_reference is null)
  union all
  select 'reserve_overallocated','critical',r.id::text,jsonb_build_object('name',r.name,'freeUsd',public.flow_reserve_account_free_usd(r.id))
  from public.flow_reserve_accounts r where r.authorized_for_flow and r.is_active and r.status='active' and public.flow_reserve_account_free_usd(r.id)<-0.000001
  union all
  select 'custody_confirmed_without_authorized_account','critical',f.id::text,jsonb_build_object('operationId',f.operation_id,'entryType',f.entry_type,'reserveAccountId',f.reserve_account_id)
  from public.flow_funding_ledger f left join public.flow_reserve_accounts r on r.id=f.reserve_account_id
  where f.status='confirmed' and f.custody_status='confirmed' and (r.id is null or not r.authorized_for_flow or not r.is_active or r.status<>'active' or r.account_reference is null)
  union all
  select 'active_allocation_on_nonspendable_asset','critical',b.id::text,jsonb_build_object('flowAssetId',a.id,'flowNumber',a.flow_number,'assetStatus',a.status)
  from public.flow_backing_allocations b join public.flow_assets a on a.id=b.flow_asset_id where b.status='active' and a.status not in('available','activated','transferred')
  union all
  select 'wallet_backing_mismatch','critical',w.user_id::text,jsonb_build_object('walletBalance',w.balance,'backedAssets',coalesce(x.backed,0))
  from public.flows_wallets w
  left join lateral(
    select count(*)::integer backed from public.flow_assets a where a.owner_user_id=w.user_id and a.status in('available','activated','transferred')
      and exists(select 1 from public.flow_backing_allocations b join public.flow_reserve_accounts r on r.id=b.reserve_account_id where b.flow_asset_id=a.id and b.status='active' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null)
  ) x on true
  where w.balance<>coalesce(x.backed,0)
  union all
  select 'wallet_ledger_mismatch','critical',w.user_id::text,jsonb_build_object('walletBalance',w.balance,'ledgerSum',coalesce(x.total,0))
  from public.flows_wallets w left join lateral(select sum(l.amount)::integer total from public.flows_wallet_ledger l where l.user_id=w.user_id)x on true
  where w.balance<>coalesce(x.total,0)
  union all
  select 'reserve_account_not_authorized','warning',r.id::text,jsonb_build_object('name',r.name,'provider',r.provider,'currency',r.currency,'hasAccountReference',r.account_reference is not null)
  from public.flow_reserve_accounts r where r.is_active and r.status='active' and not r.authorized_for_flow
  union all
  select 'legacy_unverified','warning',a.id::text,jsonb_build_object('flowNumber',a.flow_number,'ownerUserId',a.owner_user_id) from public.flow_assets a where a.status='legacy_unverified'
  union all
  select 'confirmed_pending_backing','warning',o.id::text,jsonb_build_object('provider',o.provider,'quantity',o.quantity,'issuedAt',o.issued_at,'shortfallUsd',o.metadata->'backingShortfallUsd','custodyRejectedReason',o.metadata->'custodyRejectedReason')
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
