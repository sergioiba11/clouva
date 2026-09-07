-- Universal QR / Modo Kiosco
-- Additive base-unit accounting for fractional merchant payments without creating a second wallet.
-- 1 FLOW = 1,000,000 base units. Legacy integer balances remain the whole-FLOW compatibility view.

create or replace function public.flow_units_per_flow()
returns bigint
language sql
immutable
set search_path = ''
as $$ select 1000000::bigint $$;

alter table public.flows_wallets add column if not exists balance_units bigint;
update public.flows_wallets
set balance_units = balance::bigint * public.flow_units_per_flow()
where balance_units is null;
alter table public.flows_wallets alter column balance_units set not null;
alter table public.flows_wallets alter column balance_units set default 0;
alter table public.flows_wallets drop constraint if exists flows_wallets_balance_units_check;
alter table public.flows_wallets add constraint flows_wallets_balance_units_check check (balance_units >= 0);

alter table public.flows_wallet_ledger add column if not exists amount_units bigint;
alter table public.flows_wallet_ledger add column if not exists balance_after_units bigint;
update public.flows_wallet_ledger
set amount_units = amount::bigint * public.flow_units_per_flow(),
    balance_after_units = balance_after::bigint * public.flow_units_per_flow()
where amount_units is null or balance_after_units is null;

alter table public.flow_assets add column if not exists total_units bigint;
alter table public.flow_assets add column if not exists available_units bigint;
alter table public.flow_assets add column if not exists held_units bigint;
update public.flow_assets
set total_units = coalesce(total_units, public.flow_units_per_flow()),
    available_units = coalesce(available_units, case when status in ('redeemed','reversed') then 0 else public.flow_units_per_flow() end),
    held_units = coalesce(held_units, 0);
alter table public.flow_assets alter column total_units set default 1000000;
alter table public.flow_assets alter column available_units set default 1000000;
alter table public.flow_assets alter column held_units set default 0;
alter table public.flow_assets alter column total_units set not null;
alter table public.flow_assets alter column available_units set not null;
alter table public.flow_assets alter column held_units set not null;
alter table public.flow_assets drop constraint if exists flow_assets_units_check;
alter table public.flow_assets add constraint flow_assets_units_check check (
  total_units = 1000000 and available_units between 0 and total_units and held_units between 0 and available_units
);

alter table public.flow_backing_allocations add column if not exists consumed_reference_usd_value numeric;
update public.flow_backing_allocations set consumed_reference_usd_value = 0 where consumed_reference_usd_value is null;
alter table public.flow_backing_allocations alter column consumed_reference_usd_value set default 0;
alter table public.flow_backing_allocations alter column consumed_reference_usd_value set not null;
alter table public.flow_backing_allocations drop constraint if exists flow_backing_allocations_consumed_check;
alter table public.flow_backing_allocations add constraint flow_backing_allocations_consumed_check check (
  consumed_reference_usd_value >= 0 and consumed_reference_usd_value <= reference_usd_value + 0.000001
);

create or replace function public.sync_flow_wallet_base_units()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scale bigint := public.flow_units_per_flow();
begin
  if tg_op = 'INSERT' then
    if new.balance_units is null or (new.balance_units = 0 and coalesce(new.balance,0) <> 0) then
      new.balance_units := coalesce(new.balance,0)::bigint * v_scale;
    else
      new.balance := floor(new.balance_units::numeric / v_scale)::integer;
    end if;
  else
    if new.balance_units is distinct from old.balance_units then
      if new.balance_units < 0 then raise exception 'Saldo FLOW en unidades no puede ser negativo.'; end if;
      new.balance := floor(new.balance_units::numeric / v_scale)::integer;
    elsif new.balance is distinct from old.balance then
      -- Legacy whole-FLOW operations preserve any fractional remainder.
      new.balance_units := old.balance_units + ((new.balance - old.balance)::bigint * v_scale);
    end if;
  end if;
  if new.balance_units < 0 then raise exception 'Saldo FLOW en unidades no puede ser negativo.'; end if;
  return new;
end $$;

drop trigger if exists flows_wallets_sync_base_units on public.flows_wallets;
create trigger flows_wallets_sync_base_units
before insert or update on public.flows_wallets
for each row execute function public.sync_flow_wallet_base_units();

create or replace function public.sync_flow_wallet_ledger_base_units()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scale bigint := public.flow_units_per_flow();
begin
  if new.amount_units is null then new.amount_units := new.amount::bigint * v_scale; end if;
  if new.balance_after_units is null then new.balance_after_units := new.balance_after::bigint * v_scale; end if;
  return new;
end $$;

drop trigger if exists flows_wallet_ledger_sync_base_units on public.flows_wallet_ledger;
create trigger flows_wallet_ledger_sync_base_units
before insert on public.flows_wallet_ledger
for each row execute function public.sync_flow_wallet_ledger_base_units();

alter table public.flows_wallet_ledger alter column amount_units set not null;
alter table public.flows_wallet_ledger alter column balance_after_units set not null;

alter table public.flow_assets drop constraint if exists flow_assets_status_check;
alter table public.flow_assets add constraint flow_assets_status_check check (status in (
  'pending_payment','available','activated','transferred','qr_payment_pending','qr_partial',
  'redemption_pending','redeemed','legacy_unverified','reversed'
));

alter table public.flow_asset_movements drop constraint if exists flow_asset_movements_action_check;
alter table public.flow_asset_movements add constraint flow_asset_movements_action_check check (action in (
  'issued','backed','backing_pending','activated','transferred',
  'qr_payment_held','qr_payment_released','qr_payment_redeemed',
  'redemption_held','redeemed','redemption_cancelled','refund','reversal'
));

alter table public.flows_wallet_ledger drop constraint if exists flows_wallet_ledger_transaction_type_check;
alter table public.flows_wallet_ledger add constraint flows_wallet_ledger_transaction_type_check check (transaction_type in (
  'purchase','reward','refund','ai_usage','avatar_purchase','marketplace_purchase','admin_adjustment','promotional_credit',
  'transfer_out','transfer_in','qr_payment_hold','qr_payment_release','redemption_hold','redemption_cancel'
));

create unique index if not exists flows_wallet_ledger_qr_payment_reference_unique
on public.flows_wallet_ledger(transaction_type,reference_id)
where transaction_type in ('qr_payment_hold','qr_payment_release') and reference_id is not null;

alter table public.flow_payment_rails add column if not exists rail_kind text not null default 'account';
alter table public.flow_payment_rails drop constraint if exists flow_payment_rails_kind_check;
alter table public.flow_payment_rails add constraint flow_payment_rails_kind_check check (rail_kind in ('account','checkout','bank_payout','merchant_qr'));
update public.flow_payment_rails set rail_kind = case
  when payment_method='checkout_pro' then 'checkout'
  when direction='payout' and payment_method='bank_transfer' then 'bank_payout'
  else rail_kind
end;

insert into public.flow_payment_rails(
  provider,direction,country_code,currency,payment_method,merchant_account_key,enabled,priority,rail_kind,metadata
) values (
  'mercadopago','payout','AR','ARS','interoperable_qr','external_wallet',false,5,'merchant_qr',
  jsonb_build_object(
    'requiresOnboarding',true,
    'requiresHomologation',true,
    'requiresCoelsaPctForAccountMoney',true,
    'resolver','/instore/v2/external/resolve',
    'productionEnabledByMigration',false
  )
) on conflict(provider,direction,country_code,currency,payment_method,merchant_account_key)
do update set rail_kind='merchant_qr', enabled=false, metadata=excluded.metadata, updated_at=now();

create table if not exists public.flow_qr_payment_operations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  player_id uuid not null references public.players(id) on delete restrict,
  raw_qr text not null check (length(raw_qr) between 1 and 4096),
  qr_payload_hash text not null check (qr_payload_hash ~ '^[0-9a-f]{64}$'),
  qr_type text not null check (qr_type in ('mercadopago','argentina_interoperable','merchant_emv','payment_link','bank_destination','sandbox_merchant','unknown')),
  provider text,
  administrator text,
  merchant_name text,
  merchant_id text,
  merchant_city text,
  merchant_mcc text,
  merchant_amount numeric check (merchant_amount is null or merchant_amount > 0),
  merchant_currency text check (merchant_currency is null or merchant_currency ~ '^[A-Z]{3}$'),
  qr_transaction_id text,
  provider_order_id text,
  dynamic_qr boolean,
  amount_editable boolean not null default false,
  capability text not null check (capability in ('DETECTED','RESOLVABLE','PAYABLE','UNSUPPORTED','NOT_AUTHORIZED')),
  resolution jsonb not null default '{}'::jsonb,
  status text not null default 'resolved' check (status in (
    'resolved','quoted','flow_held','payment_submitted','payment_pending','payment_confirmed','failed','expired','reversed'
  )),
  fx_pair text,
  fx_rate numeric check (fx_rate is null or fx_rate > 0),
  fx_source text,
  fx_quoted_at timestamptz,
  quote_expires_at timestamptz,
  reference_usd numeric check (reference_usd is null or reference_usd > 0),
  flow_units bigint check (flow_units is null or flow_units > 0),
  provider_fee_units bigint not null default 0 check (provider_fee_units >= 0),
  clouva_fee_units bigint not null default 0 check (clouva_fee_units >= 0),
  total_flow_units bigint check (total_flow_units is null or total_flow_units > 0),
  rail_provider text,
  rail_method text,
  provider_payment_id text,
  provider_status text,
  sandbox boolean not null default false,
  last_error_code text,
  last_safe_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_flow_units is null or total_flow_units = flow_units + provider_fee_units + clouva_fee_units)
);

create index if not exists flow_qr_payment_operations_user_status_idx on public.flow_qr_payment_operations(user_id,status,created_at desc);
create index if not exists flow_qr_payment_operations_hash_idx on public.flow_qr_payment_operations(qr_payload_hash,created_at desc);
create unique index if not exists flow_qr_payment_provider_payment_unique on public.flow_qr_payment_operations(provider,provider_payment_id) where provider_payment_id is not null;
create unique index if not exists flow_qr_payment_provider_transaction_unique on public.flow_qr_payment_operations(provider,qr_transaction_id) where qr_transaction_id is not null and status in ('flow_held','payment_submitted','payment_pending','payment_confirmed');

create table if not exists public.flow_qr_payment_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.flow_qr_payment_operations(id) on delete restrict,
  flow_asset_id uuid not null references public.flow_assets(id) on delete restrict,
  backing_allocation_id uuid not null references public.flow_backing_allocations(id) on delete restrict,
  reserve_account_id uuid not null references public.flow_reserve_accounts(id) on delete restrict,
  funding_entry_id uuid references public.flow_funding_ledger(id) on delete restrict,
  held_units bigint not null check (held_units > 0 and held_units <= 1000000),
  previous_asset_status text not null check (previous_asset_status in ('available','activated','transferred','qr_partial')),
  reference_usd_value numeric not null check (reference_usd_value > 0),
  reserve_currency text not null check (reserve_currency ~ '^[A-Z]{3}$'),
  reserve_release_amount numeric not null check (reserve_release_amount > 0),
  status text not null default 'held' check (status in ('held','released','redeemed')),
  released_at timestamptz,
  redeemed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(operation_id,flow_asset_id)
);

create index if not exists flow_qr_payment_items_operation_idx on public.flow_qr_payment_items(operation_id,status);
create index if not exists flow_qr_payment_items_asset_idx on public.flow_qr_payment_items(flow_asset_id,status);

create table if not exists public.flow_qr_payment_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references public.flow_qr_payment_operations(id) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  provider_payment_id text,
  event_status text,
  payload_hash text not null,
  signature_valid boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider,provider_event_id)
);

alter table public.flow_qr_payment_operations enable row level security;
alter table public.flow_qr_payment_items enable row level security;
alter table public.flow_qr_payment_events enable row level security;
revoke all on table public.flow_qr_payment_operations from public,anon,authenticated;
revoke all on table public.flow_qr_payment_items from public,anon,authenticated;
revoke all on table public.flow_qr_payment_events from public,anon,authenticated;
grant all on table public.flow_qr_payment_operations to service_role;
grant all on table public.flow_qr_payment_items to service_role;
grant all on table public.flow_qr_payment_events to service_role;

create or replace function public.flow_reserve_account_free_usd(p_account_id uuid)
returns numeric
language sql
security definer
set search_path = ''
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
        and custody_stage in ('reserve_confirmed','allocated') and entry_type='reserve_deposit'
    ),0) credits,
    coalesce(sum(reference_usd_amount) filter (
      where status='confirmed' and entry_type in ('refund','reversal','reserve_release')
        and custody_status in ('confirmed','released','reversed')
    ),0) debits
  from public.flow_funding_ledger where reserve_account_id=p_account_id
), allocations as (
  select coalesce(sum(greatest(reference_usd_value-consumed_reference_usd_value,0)),0) allocated
  from public.flow_backing_allocations where reserve_account_id=p_account_id and status='active'
)
select case when account_ok.ok then reserve_money.credits-reserve_money.debits-allocations.allocated else 0 end
from account_ok,reserve_money,allocations;
$$;

create or replace function public.guard_flow_asset_backing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_price numeric;
  v_expected_reference numeric;
  v_remaining_reference numeric;
begin
  if new.status in('available','activated','transferred','qr_partial','qr_payment_pending') then
    if new.backing_operation_id is null then raise exception 'Un FLOW disponible requiere una operación de respaldo.'; end if;
    if new.total_units<>public.flow_units_per_flow() or new.available_units<0 or new.available_units>new.total_units or new.held_units<0 or new.held_units>new.available_units then
      raise exception 'Las subunidades del FLOW son inválidas.';
    end if;
    if new.status='qr_partial' and not (new.available_units>0 and new.available_units<new.total_units and new.held_units=0) then
      raise exception 'Un FLOW parcial debe conservar unidades disponibles menores a un FLOW completo.';
    end if;
    if new.status='qr_payment_pending' and new.held_units<=0 then
      raise exception 'Un FLOW retenido para QR necesita unidades en hold.';
    end if;
    if new.status in('available','activated','transferred') and (new.available_units<>new.total_units or new.held_units<>0) then
      raise exception 'Un FLOW transferible debe estar completo y sin holds.';
    end if;

    select * into v_op from public.flow_purchase_operations where id=new.backing_operation_id;
    if not found or v_op.status<>'confirmed' or v_op.backing_status<>'verified' or v_op.confirmed_at is null then
      raise exception 'El FLOW no tiene respaldo económico confirmado.';
    end if;
    select flow_usd_value into v_price from public.flow_issuance_settings where id='canonical';
    if v_price is null or abs(v_op.unit_usd-v_price)>0.000001 or abs(v_op.required_backing_usd-(v_op.quantity*v_price))>0.000001 then
      raise exception 'El FLOW no respeta el valor canónico de respaldo.';
    end if;
    v_expected_reference:=v_price*(new.available_units::numeric/new.total_units::numeric);

    select greatest(b.reference_usd_value-b.consumed_reference_usd_value,0)
    into v_remaining_reference
    from public.flow_backing_allocations b
    join public.flow_reserve_accounts r on r.id=b.reserve_account_id
    join public.flow_funding_ledger f on f.id=b.funding_entry_id
    where b.flow_asset_id=new.id and b.status='active'
      and r.flow_account_role='reserve' and r.is_active and r.status='active'
      and r.authorized_for_flow and r.account_reference is not null
      and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed'
      and f.custody_stage in ('reserve_confirmed','allocated')
      and f.entry_type='reserve_deposit' and coalesce(f.reference_usd_amount,0)>0
    limit 1;
    if v_remaining_reference is null or abs(v_remaining_reference-v_expected_reference)>0.00001 then
      raise exception 'El FLOW no tiene backing proporcional a sus unidades disponibles.';
    end if;
  end if;
  return new;
end $$;

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

  select coalesce(sum(a.available_units-a.held_units),0)::bigint into v_backed_units
  from public.flow_assets a
  join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active'
  join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null
  join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.custody_stage in('reserve_confirmed','allocated') and f.entry_type='reserve_deposit' and coalesce(f.reference_usd_amount,0)>0
  where a.owner_user_id=p_user_id and a.status in('available','activated','transferred','qr_partial') and a.available_units>a.held_units
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
    where a.owner_user_id=p_user_id and a.status in('available','activated','transferred','qr_partial') and a.held_units=0 and a.available_units>0
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

create or replace function public.release_flow_qr_payment(
  p_operation_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_final_status text default 'failed',
  p_error_code text default null,
  p_safe_message text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.flow_qr_payment_operations%rowtype;
  v_wallet_units bigint:=0;
  v_wallet_whole integer:=0;
  v_new_units bigint;
  v_new_whole integer;
  v_released bigint:=0;
  v_player_id uuid;
  r_item record;
begin
  if p_final_status not in('failed','expired','reversed') then raise exception 'Estado final QR inválido.'; end if;
  if p_actor_id<>p_user_id then raise exception 'Actor QR inválido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flow-qr-payment:'||p_operation_id::text,0));
  select * into v_op from public.flow_qr_payment_operations where id=p_operation_id for update;
  if not found or v_op.user_id<>p_user_id then raise exception 'Operación QR inexistente.'; end if;
  if v_op.status in('failed','expired','reversed') then return jsonb_build_object('operationId',v_op.id,'status',v_op.status,'duplicate',true); end if;
  if v_op.status='payment_confirmed' then raise exception 'Un pago QR confirmado no puede liberar los FLOW.'; end if;
  if v_op.status not in('flow_held','payment_submitted','payment_pending') then raise exception 'La operación QR no tiene FLOW retenidos liberables.'; end if;
  v_player_id:=v_op.player_id;

  select balance,balance_units into v_wallet_whole,v_wallet_units from public.flows_wallets where user_id=p_user_id for update;
  for r_item in
    select i.*,a.held_units as asset_held_units,a.status as asset_status
    from public.flow_qr_payment_items i join public.flow_assets a on a.id=i.flow_asset_id
    where i.operation_id=v_op.id and i.status='held' order by i.id for update of i,a
  loop
    if r_item.asset_status<>'qr_payment_pending' or r_item.asset_held_units<r_item.held_units then raise exception 'Un FLOW retenido perdió su estado de hold.'; end if;
    update public.flow_assets set held_units=held_units-r_item.held_units,status=r_item.previous_asset_status,metadata=(metadata-'qrPaymentOperationId'-'qrHeldAt'-'qrPreviousStatus')||jsonb_build_object('qrPaymentReleasedAt',now()) where id=r_item.flow_asset_id;
    update public.flow_qr_payment_items set status='released',released_at=now() where id=r_item.id;
    insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,to_user_id,from_player_id,to_player_id,created_by,metadata)
    values(r_item.flow_asset_id,'qr_payment_released',p_user_id,p_user_id,v_player_id,v_player_id,p_actor_id,jsonb_build_object('operationId',v_op.id,'releasedUnits',r_item.held_units,'reason',p_error_code));
    v_released:=v_released+r_item.held_units;
  end loop;
  if v_released<>v_op.total_flow_units then raise exception 'Las unidades liberadas no coinciden con el hold QR.'; end if;

  v_new_units:=v_wallet_units+v_released;
  update public.flows_wallets set balance_units=v_new_units,updated_at=now() where user_id=p_user_id returning balance into v_new_whole;
  insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,amount_units,balance_after_units,source,reference_id,metadata,created_by)
  values(p_user_id,'qr_payment_release',v_new_whole-v_wallet_whole,v_new_whole,v_released,v_new_units,'flow_universal_qr',v_op.id::text,jsonb_build_object('operationId',v_op.id,'reason',p_error_code),p_actor_id)
  on conflict(transaction_type,reference_id) where transaction_type in('qr_payment_hold','qr_payment_release') and reference_id is not null do nothing;

  update public.flow_qr_payment_operations
  set status=p_final_status,last_error_code=p_error_code,last_safe_message=p_safe_message,updated_at=now(),
      failed_at=case when p_final_status='failed' then now() else failed_at end,
      expired_at=case when p_final_status='expired' then now() else expired_at end,
      reversed_at=case when p_final_status='reversed' then now() else reversed_at end
  where id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'status',p_final_status,'duplicate',false,'releasedUnits',v_released,'balanceUnitsAfter',v_new_units);
end $$;

create or replace function public.confirm_flow_qr_payment(
  p_operation_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_provider_payment_id text,
  p_custody_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.flow_qr_payment_operations%rowtype;
  v_redeemed bigint:=0;
  v_remaining bigint;
  v_new_consumed numeric;
  v_release jsonb;
  r_item record;
  r_release record;
begin
  if p_actor_id<>p_user_id or nullif(trim(coalesce(p_provider_payment_id,'')),'') is null then raise exception 'Confirmación QR inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flow-qr-payment:'||p_operation_id::text,0));
  select * into v_op from public.flow_qr_payment_operations where id=p_operation_id for update;
  if not found or v_op.user_id<>p_user_id then raise exception 'Operación QR inexistente.'; end if;
  if v_op.status='payment_confirmed' then
    if v_op.provider_payment_id is distinct from p_provider_payment_id then raise exception 'El pago del proveedor no coincide con la operación confirmada.'; end if;
    return jsonb_build_object('operationId',v_op.id,'status','payment_confirmed','duplicate',true,'providerPaymentId',v_op.provider_payment_id);
  end if;
  if v_op.status not in('flow_held','payment_submitted','payment_pending') then raise exception 'La operación QR no admite confirmación.'; end if;
  if v_op.provider_payment_id is not null and v_op.provider_payment_id<>p_provider_payment_id then raise exception 'La operación QR ya está vinculada a otro pago externo.'; end if;

  for r_item in
    select i.*,a.available_units,a.held_units as asset_held_units,a.status as asset_status,b.reference_usd_value as backing_reference,b.consumed_reference_usd_value
    from public.flow_qr_payment_items i
    join public.flow_assets a on a.id=i.flow_asset_id
    join public.flow_backing_allocations b on b.id=i.backing_allocation_id
    where i.operation_id=v_op.id and i.status='held' order by i.id for update of i,a,b
  loop
    if r_item.asset_status<>'qr_payment_pending' or r_item.asset_held_units<r_item.held_units or r_item.available_units<r_item.held_units then raise exception 'Un FLOW retenido perdió sus unidades antes de confirmar.'; end if;
    v_remaining:=r_item.available_units-r_item.held_units;
    v_new_consumed:=least(r_item.backing_reference,r_item.consumed_reference_usd_value+r_item.reference_usd_value);

    if v_remaining=0 then
      update public.flow_backing_allocations set consumed_reference_usd_value=v_new_consumed,status='released',released_at=now(),metadata=metadata||jsonb_build_object('qrPaymentOperationId',v_op.id,'releasedForMerchantQr',true) where id=r_item.backing_allocation_id;
      update public.flow_assets set available_units=0,held_units=held_units-r_item.held_units,status='redeemed',metadata=(metadata-'qrPaymentOperationId'-'qrHeldAt'-'qrPreviousStatus')||jsonb_build_object('qrRedeemedBy',v_op.id,'qrRedeemedAt',now()) where id=r_item.flow_asset_id;
    else
      update public.flow_backing_allocations set consumed_reference_usd_value=v_new_consumed,metadata=metadata||jsonb_build_object('lastQrPaymentOperationId',v_op.id,'partialBackingConsumedAt',now()) where id=r_item.backing_allocation_id;
      update public.flow_assets set available_units=v_remaining,held_units=held_units-r_item.held_units,status='qr_partial',metadata=(metadata-'qrPaymentOperationId'-'qrHeldAt'-'qrPreviousStatus')||jsonb_build_object('lastQrPaymentOperationId',v_op.id,'partialAt',now()) where id=r_item.flow_asset_id;
    end if;

    update public.flow_qr_payment_items set status='redeemed',redeemed_at=now() where id=r_item.id;
    insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,from_player_id,created_by,metadata)
    values(r_item.flow_asset_id,'qr_payment_redeemed',p_user_id,v_op.player_id,p_actor_id,jsonb_build_object('operationId',v_op.id,'redeemedUnits',r_item.held_units,'referenceUsd',r_item.reference_usd_value,'providerPaymentId',p_provider_payment_id));
    v_redeemed:=v_redeemed+r_item.held_units;
  end loop;
  if v_redeemed<>v_op.total_flow_units then raise exception 'Las unidades redimidas no coinciden con el pago QR.'; end if;

  for r_release in
    select reserve_account_id,reserve_currency,sum(reserve_release_amount) local_amount,sum(reference_usd_value) usd_amount
    from public.flow_qr_payment_items where operation_id=v_op.id and status='redeemed'
    group by reserve_account_id,reserve_currency
  loop
    select public.record_flow_reserve_release(
      r_release.reserve_account_id,r_release.local_amount,r_release.reserve_currency,r_release.usd_amount,
      coalesce(nullif(trim(coalesce(p_custody_reference,'')),''),'merchant-qr:'||v_op.id::text),
      'merchant-qr-reserve-release:'||v_op.id::text||':'||r_release.reserve_account_id::text,
      p_actor_id,jsonb_build_object('qrPaymentOperationId',v_op.id,'provider',v_op.provider,'providerPaymentId',p_provider_payment_id,'merchant',v_op.merchant_name)
    ) into v_release;
  end loop;

  update public.flow_qr_payment_operations set status='payment_confirmed',provider_payment_id=p_provider_payment_id,provider_status='CONFIRMED',confirmed_at=now(),updated_at=now(),last_error_code=null,last_safe_message=null where id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'status','payment_confirmed','duplicate',false,'providerPaymentId',p_provider_payment_id,'redeemedUnits',v_redeemed,'backingReleased',true);
end $$;

create or replace function public.mark_flow_qr_payment_submitted(
  p_operation_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_provider_payment_id text,
  p_provider_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op public.flow_qr_payment_operations%rowtype;
  v_status text;
begin
  if p_actor_id<>p_user_id or nullif(trim(coalesce(p_provider_payment_id,'')),'') is null then raise exception 'Submission QR inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flow-qr-payment:'||p_operation_id::text,0));
  select * into v_op from public.flow_qr_payment_operations where id=p_operation_id for update;
  if not found or v_op.user_id<>p_user_id then raise exception 'Operación QR inexistente.'; end if;
  if v_op.status='payment_confirmed' then return jsonb_build_object('operationId',v_op.id,'status',v_op.status,'duplicate',true); end if;
  if v_op.status not in('flow_held','payment_submitted','payment_pending') then raise exception 'La operación QR no tiene FLOW en hold.'; end if;
  if v_op.provider_payment_id is not null and v_op.provider_payment_id<>p_provider_payment_id then raise exception 'La operación QR ya pertenece a otro pago externo.'; end if;
  v_status:=case when upper(p_provider_status)='PENDING' then 'payment_pending' else 'payment_submitted' end;
  update public.flow_qr_payment_operations set status=v_status,provider_payment_id=p_provider_payment_id,provider_status=upper(p_provider_status),submitted_at=coalesce(submitted_at,now()),updated_at=now() where id=v_op.id;
  return jsonb_build_object('operationId',v_op.id,'status',v_status,'providerPaymentId',p_provider_payment_id,'duplicate',false);
end $$;

revoke all on function public.hold_flow_qr_payment(uuid,uuid,bigint,uuid) from public,anon,authenticated;
revoke all on function public.release_flow_qr_payment(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.confirm_flow_qr_payment(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.mark_flow_qr_payment_submitted(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.hold_flow_qr_payment(uuid,uuid,bigint,uuid) to service_role;
grant execute on function public.release_flow_qr_payment(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.confirm_flow_qr_payment(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.mark_flow_qr_payment_submitted(uuid,uuid,uuid,text,text) to service_role;
