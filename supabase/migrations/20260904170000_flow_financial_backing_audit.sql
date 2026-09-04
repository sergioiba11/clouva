begin;

create table if not exists public.flow_issuance_settings(
 id text primary key check(id='canonical'),
 flow_usd_value numeric(12,2) not null check(flow_usd_value>0),
 updated_at timestamptz not null default now()
);
insert into public.flow_issuance_settings values('canonical',1,now()) on conflict(id) do nothing;
alter table public.flow_issuance_settings enable row level security;
drop policy if exists flow_issuance_settings_read on public.flow_issuance_settings;
create policy flow_issuance_settings_read on public.flow_issuance_settings for select to authenticated using(true);
revoke insert,update,delete on public.flow_issuance_settings from anon,authenticated;

alter table public.flow_purchase_operations
 add column if not exists backing_status text not null default 'pending',
 add column if not exists fx_rate_original_per_usd numeric(18,6),
 add column if not exists fx_source text,
 add column if not exists fx_quoted_at timestamptz,
 add column if not exists refund_status text;
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_operations_backing_status_check;
alter table public.flow_purchase_operations add constraint flow_purchase_operations_backing_status_check check(backing_status in('pending','verified','reversed','legacy_unverified'));
alter table public.flow_purchase_operations drop constraint if exists flow_purchase_operations_refund_status_check;
alter table public.flow_purchase_operations add constraint flow_purchase_operations_refund_status_check check(refund_status is null or refund_status in('pending_review','reversed','resolved'));

create table if not exists public.flow_funding_ledger(
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.flow_purchase_operations(id) on delete restrict,
 entry_type text not null check(entry_type in('funding','refund','reversal')),
 provider text not null,
 payment_method text not null,
 amount numeric(14,2) not null check(amount>0),
 currency text not null check(currency~'^[A-Z]{3}$'),
 status text not null check(status in('pending','confirmed','reversed')),
 external_payment_id text,
 idempotency_key text not null unique,
 confirmed_by uuid references auth.users(id) on delete set null,
 occurred_at timestamptz not null default now(),
 reverses_entry_id uuid references public.flow_funding_ledger(id) on delete restrict,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create unique index if not exists flow_funding_confirmed_operation_uidx on public.flow_funding_ledger(operation_id) where entry_type='funding' and status='confirmed';
create index if not exists flow_funding_operation_idx on public.flow_funding_ledger(operation_id,occurred_at desc);
alter table public.flow_funding_ledger enable row level security;
drop policy if exists flow_funding_read_related on public.flow_funding_ledger;
create policy flow_funding_read_related on public.flow_funding_ledger for select to authenticated using(
 exists(select 1 from public.flow_purchase_operations o where o.id=operation_id and (o.buyer_user_id=auth.uid() or o.recipient_user_id=auth.uid()))
 or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
revoke insert,update,delete on public.flow_funding_ledger from anon,authenticated;

create table if not exists public.flow_payment_documents(
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.flow_purchase_operations(id) on delete restrict,
 kind text not null check(kind in('internal_receipt','fiscal_document')),
 provider text not null,
 document_type text not null,
 status text not null check(status in('pending','issued','failed','cancelled')),
 issuer jsonb not null default '{}'::jsonb,
 recipient jsonb not null default '{}'::jsonb,
 amount numeric(14,2) not null check(amount>=0),
 currency text not null check(currency~'^[A-Z]{3}$'),
 tax_data jsonb not null default '{}'::jsonb,
 external_document_id text,
 document_number text,
 issued_at timestamptz,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(operation_id,kind,provider)
);
create index if not exists flow_payment_documents_operation_idx on public.flow_payment_documents(operation_id,created_at desc);
alter table public.flow_payment_documents enable row level security;
drop policy if exists flow_documents_read_related on public.flow_payment_documents;
create policy flow_documents_read_related on public.flow_payment_documents for select to authenticated using(
 exists(select 1 from public.flow_purchase_operations o where o.id=operation_id and (o.buyer_user_id=auth.uid() or o.recipient_user_id=auth.uid()))
 or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
revoke insert,update,delete on public.flow_payment_documents from anon,authenticated;

create table if not exists public.flow_refund_cases(
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null unique references public.flow_purchase_operations(id) on delete restrict,
 funding_entry_id uuid references public.flow_funding_ledger(id) on delete restrict,
 provider_refund_id text,
 amount numeric(14,2) not null check(amount>0),
 currency text not null check(currency~'^[A-Z]{3}$'),
 status text not null default 'pending_review' check(status in('pending_review','reversed','resolved')),
 reason text,
 affected_assets jsonb not null default '[]'::jsonb,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 resolved_at timestamptz
);
alter table public.flow_refund_cases enable row level security;
drop policy if exists flow_refund_cases_read_related on public.flow_refund_cases;
create policy flow_refund_cases_read_related on public.flow_refund_cases for select to authenticated using(
 exists(select 1 from public.flow_purchase_operations o where o.id=operation_id and (o.buyer_user_id=auth.uid() or o.recipient_user_id=auth.uid()))
 or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
);
revoke insert,update,delete on public.flow_refund_cases from anon,authenticated;

alter table public.flow_assets drop constraint if exists flow_assets_status_check;
alter table public.flow_assets add constraint flow_assets_status_check check(status in('pending_payment','available','activated','transferred','legacy_unverified','reversed'));
alter table public.flow_asset_movements drop constraint if exists flow_asset_movements_action_check;
alter table public.flow_asset_movements add constraint flow_asset_movements_action_check check(action in('issued','activated','transferred','refund','reversal'));

-- Reconcile existing physical/manual payments as real cash without minting again.
update public.flow_purchase_operations set
 metadata=metadata||jsonb_build_object('legacyProvider',provider,'legacyPaymentMethod',payment_method,'legacyProviderReference',provider_reference,'reconciledAsCashAt',now()),
 provider='cash',
 provider_reference=regexp_replace(provider_reference,'^manual:','cash:'),
 payment_method='cash',
 backing_status='verified',
 updated_at=now()
where provider='manual' and payment_method='physical_manual' and status='confirmed';

insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,confirmed_by,occurred_at,metadata)
select id,'funding',provider,payment_method,amount,upper(currency),'confirmed','reconciled-funding:'||id::text,created_by,coalesce(confirmed_at,created_at),jsonb_build_object('reconciled',true)
from public.flow_purchase_operations where status='confirmed' and backing_status='verified'
on conflict(idempotency_key) do nothing;

insert into public.flow_payment_documents(operation_id,kind,provider,document_type,status,issuer,recipient,amount,currency,document_number,issued_at,metadata)
select id,'internal_receipt','clouva_internal','payment_receipt','issued',jsonb_build_object('name','CLOUVA'),jsonb_build_object('userId',recipient_user_id,'playerId',recipient_player_id),amount,upper(currency),
 'FLOW-R-'||upper(substring(replace(id::text,'-','') from 1 for 12)),coalesce(confirmed_at,created_at),jsonb_build_object('internalOnly',true,'fiscalDocument',false)
from public.flow_purchase_operations where status='confirmed' and backing_status='verified'
on conflict(operation_id,kind,provider) do nothing;

update public.flows_wallet_ledger l set source='cash_payment',metadata=l.metadata||jsonb_build_object('reconciledSource','manual_payment')
where source='manual_payment' and exists(select 1 from public.flow_purchase_operations o where o.id::text=l.reference_id and o.provider='cash');

create unique index if not exists flows_wallet_purchase_reference_uidx on public.flows_wallet_ledger(reference_id) where transaction_type='purchase' and reference_id is not null;

create or replace function public.adjust_flows_balance(p_user_id uuid,p_amount integer,p_transaction_type text,p_source text default null,p_reference_id text default null,p_metadata jsonb default '{}'::jsonb,p_created_by uuid default null)
returns public.flows_wallet_ledger language plpgsql security definer set search_path=public as $$
declare v_balance integer; v_new integer; v_row public.flows_wallet_ledger%rowtype; v_op public.flow_purchase_operations%rowtype;
begin
 if p_amount>0 then
  if p_transaction_type<>'purchase' or p_reference_id is null then raise exception 'Los créditos positivos de FLOWS requieren una operación económica confirmada.'; end if;
  begin select * into v_op from public.flow_purchase_operations where id=p_reference_id::uuid; exception when invalid_text_representation then raise exception 'Referencia económica de FLOW inválida.'; end;
  if not found or v_op.recipient_user_id<>p_user_id or v_op.status<>'confirmed' or v_op.backing_status<>'verified' or v_op.quantity<>p_amount
   or not exists(select 1 from public.flow_funding_ledger f where f.operation_id=v_op.id and f.entry_type='funding' and f.status='confirmed' and f.amount=v_op.amount and f.currency=upper(v_op.currency))
  then raise exception 'La emisión no tiene respaldo económico confirmado.'; end if;
 end if;
 insert into public.flows_wallets(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
 select balance into v_balance from public.flows_wallets where user_id=p_user_id for update;
 v_new:=v_balance+p_amount; if v_new<0 then raise exception 'Saldo de Flows insuficiente.'; end if;
 update public.flows_wallets set balance=v_new,updated_at=now() where user_id=p_user_id;
 insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,source,reference_id,metadata,created_by)
 values(p_user_id,p_transaction_type,p_amount,v_new,p_source,p_reference_id,coalesce(p_metadata,'{}'::jsonb),p_created_by) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.adjust_flows_balance(uuid,integer,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.adjust_flows_balance(uuid,integer,text,text,text,jsonb,uuid) to service_role;

create or replace function public.flow_project_event(p_user uuid,p_type text,p_summary text,p_operation uuid,p_actor uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.project_events(user_id,event_type,component,summary,payload,actor_user_id,entity_type,entity_id,source,scope,visibility,context_eligible,knowledge_eligible,training_eligible,idempotency_key)
 values(p_user,p_type,'mi_flow',p_summary,coalesce(p_payload,'{}'::jsonb),p_actor,'flow_purchase_operation',p_operation::text,'application','private','private',true,false,false,'flow:'||p_type||':'||p_operation::text)
 on conflict do nothing;
end $$;
revoke all on function public.flow_project_event(uuid,text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.flow_project_event(uuid,text,text,uuid,uuid,jsonb) to service_role;

create or replace function public.issue_flows_for_operation(p_operation_id uuid,p_confirmed_by uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.flow_purchase_operations%rowtype; v_count integer; v_price numeric; v_usd numeric;
begin
 select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
 if not found then raise exception 'Operación de FLOW inexistente.'; end if;
 if v_op.status<>'confirmed' or v_op.confirmed_at is null or v_op.backing_status<>'verified' then raise exception 'El dinero real todavía no está confirmado.'; end if;
 select flow_usd_value into v_price from public.flow_issuance_settings where id='canonical';
 if upper(v_op.currency)='USD' then
  if abs(v_op.unit_usd-v_price)>0.000001 or abs(v_op.amount-(v_op.quantity*v_price))>0.01 then raise exception 'El importe USD no coincide con la regla canónica.'; end if;
 else
  if v_op.fx_rate_original_per_usd is null or v_op.fx_source is null or v_op.fx_quoted_at is null then raise exception 'La moneda requiere cotización canónica.'; end if;
  v_usd:=v_op.amount/v_op.fx_rate_original_per_usd;
  if abs(v_usd-(v_op.quantity*v_price))>0.01 then raise exception 'La conversión no respalda los FLOWS.'; end if;
 end if;
 if not exists(select 1 from public.flow_funding_ledger f where f.operation_id=v_op.id and f.entry_type='funding' and f.status='confirmed' and f.amount=v_op.amount and f.currency=upper(v_op.currency)) then raise exception 'Falta el registro confirmado del dinero recibido.'; end if;
 if not exists(select 1 from public.flow_payment_documents d where d.operation_id=v_op.id and d.kind='internal_receipt' and d.status='issued') then raise exception 'Falta el comprobante interno.'; end if;
 if v_op.issued_at is not null then select count(*)::integer into v_count from public.flow_assets where operation_id=v_op.id; return jsonb_build_object('operationId',v_op.id,'issued',v_count,'alreadyIssued',true); end if;

 insert into public.flow_assets(operation_id,operation_unit,owner_user_id,owner_player_id,original_buyer_user_id,original_buyer_player_id,status,metadata)
 select v_op.id,n,v_op.recipient_user_id,v_op.recipient_player_id,v_op.buyer_user_id,v_op.buyer_player_id,'available',jsonb_build_object('provider',v_op.provider,'paymentMethod',v_op.payment_method,'backingStatus',v_op.backing_status)
 from generate_series(1,v_op.quantity)n;

 insert into public.flow_asset_movements(flow_asset_id,action,to_user_id,to_player_id,operation_id,created_by,metadata)
 select id,'issued',owner_user_id,owner_player_id,v_op.id,p_confirmed_by,jsonb_build_object('provider',v_op.provider,'paymentMethod',v_op.payment_method)
 from public.flow_assets where operation_id=v_op.id;

 perform public.adjust_flows_balance(v_op.recipient_user_id,v_op.quantity,'purchase',case when v_op.provider='cash' then 'cash_payment' else 'flow_purchase' end,v_op.id::text,jsonb_build_object('operationId',v_op.id,'provider',v_op.provider,'quantity',v_op.quantity),p_confirmed_by);
 update public.flow_purchase_operations set issued_at=now(),updated_at=now() where id=v_op.id;
 perform public.flow_project_event(v_op.recipient_user_id,'flow_issued','FLOWS emitidos contra una operación económica confirmada.',v_op.id,p_confirmed_by,jsonb_build_object('quantity',v_op.quantity,'provider',v_op.provider));
 return jsonb_build_object('operationId',v_op.id,'issued',v_op.quantity,'alreadyIssued',false);
end $$;
revoke all on function public.issue_flows_for_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_flows_for_operation(uuid,uuid) to service_role;

create or replace function public.confirm_flow_external_payment(p_operation_id uuid,p_provider text,p_provider_payment_id text,p_confirmed_at timestamptz,p_amount numeric,p_currency text,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.flow_purchase_operations%rowtype; v_result jsonb;
begin
 select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
 if not found or v_op.provider<>p_provider or v_op.status not in('pending','confirmed') then raise exception 'Operación externa inválida.'; end if;
 if abs(v_op.amount-p_amount)>0.01 or upper(v_op.currency)<>upper(p_currency) then raise exception 'El dinero confirmado no coincide con la operación.'; end if;
 update public.flow_purchase_operations set status='confirmed',backing_status='verified',provider_payment_id=p_provider_payment_id,confirmed_at=coalesce(p_confirmed_at,now()),updated_at=now() where id=v_op.id;
 insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,idempotency_key,occurred_at,metadata)
 values(v_op.id,'funding',v_op.provider,v_op.payment_method,v_op.amount,upper(v_op.currency),'confirmed',p_provider_payment_id,p_idempotency_key,coalesce(p_confirmed_at,now()),coalesce(p_metadata,'{}'::jsonb))
 on conflict(idempotency_key) do nothing;
 insert into public.flow_payment_documents(operation_id,kind,provider,document_type,status,issuer,recipient,amount,currency,document_number,issued_at,metadata)
 values(v_op.id,'internal_receipt','clouva_internal','payment_receipt','issued',jsonb_build_object('name','CLOUVA'),jsonb_build_object('userId',v_op.recipient_user_id,'playerId',v_op.recipient_player_id),v_op.amount,upper(v_op.currency),'FLOW-R-'||upper(substring(replace(v_op.id::text,'-','') from 1 for 12)),coalesce(p_confirmed_at,now()),jsonb_build_object('internalOnly',true,'fiscalDocument',false,'providerPaymentId',p_provider_payment_id))
 on conflict(operation_id,kind,provider) do nothing;
 perform public.flow_project_event(v_op.recipient_user_id,'payment_confirmed','Dinero real confirmado para una compra de FLOWS.',v_op.id,null,jsonb_build_object('provider',v_op.provider,'amount',v_op.amount,'currency',v_op.currency));
 select public.issue_flows_for_operation(v_op.id,null) into v_result; return v_result;
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
 insert into public.flow_purchase_operations(buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,provider,provider_reference,payment_method,quantity,unit_usd,amount,currency,status,backing_status,confirmed_at,created_by,metadata)
 values(v_payer.owner_user_id,v_payer.id,v_recipient.owner_user_id,v_recipient.id,'cash','cash:'||p_idempotency_key,'cash',p_quantity,v_price,v_amount,'USD','confirmed','verified',now(),p_confirmed_by,jsonb_build_object('reference',nullif(trim(coalesce(p_reference,'')),''),'note',nullif(trim(coalesce(p_note,'')),''),'cashReceived',true))
 returning * into v_op;
 insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,idempotency_key,confirmed_by,metadata)
 values(v_op.id,'funding','cash','cash',v_amount,'USD','confirmed','cash-funding:'||p_idempotency_key,p_confirmed_by,jsonb_build_object('cashReceived',true,'reference',p_reference,'note',p_note));
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
declare v_op public.flow_purchase_operations%rowtype; v_funding public.flow_funding_ledger%rowtype; v_refund public.flow_funding_ledger%rowtype; v_case public.flow_refund_cases%rowtype; v_assets jsonb;
begin
 select * into v_op from public.flow_purchase_operations where id=p_operation_id for update;
 if not found or abs(v_op.amount-p_amount)>0.01 or upper(v_op.currency)<>upper(p_currency) then raise exception 'Reembolso inválido.'; end if;
 select * into v_funding from public.flow_funding_ledger where operation_id=v_op.id and entry_type='funding' and status='confirmed' limit 1;
 if not found then raise exception 'No existe respaldo confirmado para revertir.'; end if;
 insert into public.flow_funding_ledger(operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,idempotency_key,reverses_entry_id,metadata)
 values(v_op.id,'refund',v_op.provider,v_op.payment_method,p_amount,upper(p_currency),'confirmed',p_provider_payment_id,p_idempotency_key,v_funding.id,coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('reason',p_reason))
 on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into v_refund;
 select coalesce(jsonb_agg(jsonb_build_object('flowAssetId',id,'flowNumber',flow_number,'status',status,'ownerUserId',owner_user_id,'ownerPlayerId',owner_player_id)),'[]'::jsonb) into v_assets from public.flow_assets where operation_id=v_op.id;
 update public.flow_purchase_operations set status='refunded',backing_status='reversed',refund_status='pending_review',updated_at=now() where id=v_op.id;
 insert into public.flow_refund_cases(operation_id,funding_entry_id,provider_refund_id,amount,currency,status,reason,affected_assets,metadata)
 values(v_op.id,v_refund.id,p_provider_payment_id,p_amount,upper(p_currency),'pending_review',p_reason,v_assets,coalesce(p_metadata,'{}'::jsonb))
 on conflict(operation_id) do update set funding_entry_id=excluded.funding_entry_id,provider_refund_id=excluded.provider_refund_id,reason=excluded.reason,affected_assets=excluded.affected_assets,metadata=public.flow_refund_cases.metadata||excluded.metadata returning * into v_case;
 perform public.flow_project_event(v_op.recipient_user_id,'payment_refunded','Reembolso registrado; los FLOWS afectados quedan en revisión auditable.',v_op.id,null,jsonb_build_object('refundCaseId',v_case.id,'affectedAssets',v_assets));
 return jsonb_build_object('operationId',v_op.id,'refundCaseId',v_case.id,'status',v_case.status,'requiresAssetReview',true);
end $$;
revoke all on function public.record_flow_refund(uuid,text,numeric,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_flow_refund(uuid,text,numeric,text,text,text,jsonb) to service_role;

-- Backfill audit for already reconciled operations.
select public.flow_project_event(recipient_user_id,'payment_created','Operación económica creada para emisión de FLOWS.',id,created_by,jsonb_build_object('provider',provider,'amount',amount,'currency',currency)) from public.flow_purchase_operations;
select public.flow_project_event(recipient_user_id,'payment_confirmed','Dinero real confirmado para una compra de FLOWS.',id,created_by,jsonb_build_object('provider',provider,'amount',amount,'currency',currency)) from public.flow_purchase_operations where status='confirmed';
select public.flow_project_event(recipient_user_id,'cash_payment_registered','Ingreso de efectivo confirmado para emisión de FLOWS.',id,created_by,jsonb_build_object('amount',amount,'currency',currency)) from public.flow_purchase_operations where provider='cash' and status='confirmed';
select public.flow_project_event(recipient_user_id,'flow_issued','FLOWS emitidos contra una operación económica confirmada.',id,created_by,jsonb_build_object('quantity',quantity,'provider',provider)) from public.flow_purchase_operations where issued_at is not null;

commit;
