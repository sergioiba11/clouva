alter table public.flow_assets drop constraint if exists flow_assets_status_check;
alter table public.flow_assets add constraint flow_assets_status_check check (status in ('pending_payment','available','activated','transferred','redemption_pending','redeemed','legacy_unverified','reversed'));

alter table public.flow_asset_movements drop constraint if exists flow_asset_movements_action_check;
alter table public.flow_asset_movements add constraint flow_asset_movements_action_check check (action in ('issued','backed','backing_pending','activated','transferred','redemption_held','redeemed','redemption_cancelled','refund','reversal'));

alter table public.flows_wallet_ledger drop constraint if exists flows_wallet_ledger_transaction_type_check;
alter table public.flows_wallet_ledger add constraint flows_wallet_ledger_transaction_type_check check (transaction_type in ('purchase','reward','refund','ai_usage','avatar_purchase','marketplace_purchase','admin_adjustment','promotional_credit','transfer_out','transfer_in','redemption_hold','redemption_cancel'));

create unique index if not exists flows_wallet_ledger_redemption_reference_unique on public.flows_wallet_ledger(transaction_type,reference_id) where transaction_type in ('redemption_hold','redemption_cancel') and reference_id is not null;

create table if not exists public.flow_payout_destinations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null, country_code text not null references public.flow_country_rules(country_code) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'), provider text not null, payout_method text not null,
  provider_destination_ref text, masked_destination text not null, encrypted_payload text,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','disabled')),
  verified_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists flow_payout_destinations_user_idx on public.flow_payout_destinations(user_id,verification_status,created_at desc);
create unique index if not exists flow_payout_destinations_provider_ref_unique on public.flow_payout_destinations(provider,provider_destination_ref) where provider_destination_ref is not null;

create table if not exists public.flow_redemption_operations (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict, player_id uuid not null references public.players(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 50), flow_usd_value_snapshot numeric not null check (flow_usd_value_snapshot > 0),
  target_country text not null references public.flow_country_rules(country_code) on delete restrict, target_currency text not null check (target_currency ~ '^[A-Z]{3}$'),
  provider text not null, payout_method text not null, payout_destination_id uuid not null references public.flow_payout_destinations(id) on delete restrict,
  gross_reference_usd numeric not null check (gross_reference_usd > 0), fx_pair text not null, fx_rate numeric not null check (fx_rate > 0), fx_source text not null, fx_quoted_at timestamptz not null,
  gross_payout_amount numeric not null check (gross_payout_amount > 0), provider_fee numeric not null default 0 check (provider_fee >= 0), clouva_fee numeric not null default 0 check (clouva_fee >= 0), net_payout_amount numeric not null check (net_payout_amount > 0),
  idempotency_key text not null unique, external_id text not null unique, provider_payout_id text,
  status text not null default 'requested' check (status in ('requested','locked','payout_submitted','payout_pending','payout_confirmed','completed','failed','cancelled','manual_review')),
  reserve_release_status text not null default 'not_started' check (reserve_release_status in ('not_started','pending','completed','failed')),
  failure_code text, failure_safe_reason text, requested_at timestamptz not null default now(), locked_at timestamptz, submitted_at timestamptz, confirmed_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (net_payout_amount <= gross_payout_amount + 0.01)
);
create index if not exists flow_redemption_operations_user_status_idx on public.flow_redemption_operations(user_id,status,created_at desc);
create unique index if not exists flow_redemption_provider_payout_unique on public.flow_redemption_operations(provider,provider_payout_id) where provider_payout_id is not null;

create table if not exists public.flow_redemption_items (
  id uuid primary key default gen_random_uuid(), redemption_id uuid not null references public.flow_redemption_operations(id) on delete restrict,
  flow_asset_id uuid not null unique references public.flow_assets(id) on delete restrict,
  backing_allocation_id uuid not null unique references public.flow_backing_allocations(id) on delete restrict,
  reserve_account_id uuid not null references public.flow_reserve_accounts(id) on delete restrict,
  funding_entry_id uuid references public.flow_funding_ledger(id) on delete restrict,
  reference_usd_value numeric not null check (reference_usd_value > 0), previous_asset_status text not null check (previous_asset_status in ('available','activated','transferred')),
  reserve_currency text not null check (reserve_currency ~ '^[A-Z]{3}$'), reserve_release_amount numeric not null check (reserve_release_amount > 0), released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(redemption_id,flow_asset_id)
);
create index if not exists flow_redemption_items_redemption_idx on public.flow_redemption_items(redemption_id);
create index if not exists flow_redemption_items_reserve_idx on public.flow_redemption_items(reserve_account_id,redemption_id);

create table if not exists public.flow_payout_events (
  id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
  redemption_id uuid references public.flow_redemption_operations(id) on delete restrict, provider_payout_id text, event_status text,
  payload_hash text not null, signature_valid boolean not null default false, received_at timestamptz not null default now(), processed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb, unique(provider,provider_event_id)
);
create index if not exists flow_payout_events_redemption_idx on public.flow_payout_events(redemption_id,received_at desc);

alter table public.flow_payout_destinations enable row level security;
alter table public.flow_redemption_operations enable row level security;
alter table public.flow_redemption_items enable row level security;
alter table public.flow_payout_events enable row level security;
revoke all on table public.flow_payout_destinations from public,anon,authenticated;
revoke all on table public.flow_redemption_operations from public,anon,authenticated;
revoke all on table public.flow_redemption_items from public,anon,authenticated;
revoke all on table public.flow_payout_events from public,anon,authenticated;
grant all on table public.flow_payout_destinations to service_role;
grant all on table public.flow_redemption_operations to service_role;
grant all on table public.flow_redemption_items to service_role;
grant all on table public.flow_payout_events to service_role;

create or replace function public.request_flow_redemption(p_redemption_id uuid,p_user_id uuid,p_quantity integer,p_destination_id uuid,p_provider text,p_payout_method text,p_target_country text,p_target_currency text,p_flow_usd_value numeric,p_fx_pair text,p_fx_rate numeric,p_fx_source text,p_fx_quoted_at timestamptz,p_gross_payout_amount numeric,p_provider_fee numeric,p_clouva_fee numeric,p_net_payout_amount numeric,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_existing public.flow_redemption_operations%rowtype; v_player_id uuid; v_destination public.flow_payout_destinations%rowtype; v_wallet_balance integer:=0; v_backed_count integer:=0; v_selected integer:=0; v_new_balance integer:=0; v_gross_reference_usd numeric; r_asset record;
begin
  if p_redemption_id is null or p_user_id is null or p_actor_id is null or p_actor_id<>p_user_id then raise exception 'Solicitud de retiro inválida.'; end if;
  if p_quantity is null or p_quantity<1 or p_quantity>50 then raise exception 'La cantidad de FLOW a retirar es inválida.'; end if;
  if p_flow_usd_value<=0 or p_fx_rate<=0 or p_gross_payout_amount<=0 or p_net_payout_amount<=0 then raise exception 'La cotización del retiro es inválida.'; end if;
  if p_provider_fee<0 or p_clouva_fee<0 or p_net_payout_amount>p_gross_payout_amount+0.01 then raise exception 'Las comisiones del retiro son inválidas.'; end if;
  if p_fx_quoted_at is null or coalesce(trim(p_fx_pair),'')='' or coalesce(trim(p_fx_source),'')='' then raise exception 'Falta el snapshot FX del retiro.'; end if;
  v_gross_reference_usd:=p_quantity*p_flow_usd_value;
  perform pg_advisory_xact_lock(hashtextextended('flow-redemption:'||p_redemption_id::text,0));
  select * into v_existing from public.flow_redemption_operations where id=p_redemption_id for update;
  if found then
    if v_existing.user_id<>p_user_id or v_existing.quantity<>p_quantity or v_existing.payout_destination_id<>p_destination_id then raise exception 'La idempotencia del retiro pertenece a otra operación.'; end if;
    return jsonb_build_object('redemptionId',v_existing.id,'status',v_existing.status,'duplicate',true,'quantity',v_existing.quantity,'netPayoutAmount',v_existing.net_payout_amount,'currency',v_existing.target_currency);
  end if;
  if not exists(select 1 from public.flow_country_rules c where c.country_code=upper(p_target_country) and c.redemption_enabled and upper(p_target_currency)=any(c.supported_currencies) and (c.min_flow is null or p_quantity>=c.min_flow) and (c.max_flow is null or p_quantity<=c.max_flow)) then raise exception 'Los retiros no están habilitados para ese país o monto.'; end if;
  if not exists(select 1 from public.flow_payment_rails r where r.provider=p_provider and r.direction='payout' and r.country_code=upper(p_target_country) and r.currency=upper(p_target_currency) and r.payment_method=p_payout_method and r.enabled and (r.min_reference_usd is null or v_gross_reference_usd>=r.min_reference_usd) and (r.max_reference_usd is null or v_gross_reference_usd<=r.max_reference_usd)) then raise exception 'No hay un rail de payout habilitado para este retiro.'; end if;
  select * into v_destination from public.flow_payout_destinations where id=p_destination_id and user_id=p_user_id for update;
  if not found or v_destination.verification_status<>'verified' or v_destination.provider<>p_provider or v_destination.country_code<>upper(p_target_country) or v_destination.currency<>upper(p_target_currency) or v_destination.payout_method<>p_payout_method then raise exception 'El destino de retiro no está verificado para este rail.'; end if;
  select id into v_player_id from public.players where owner_user_id=p_user_id order by created_at,id limit 1;
  if v_player_id is null then raise exception 'La cuenta no tiene un Player asociado.'; end if;
  insert into public.flows_wallets(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
  select balance into v_wallet_balance from public.flows_wallets where user_id=p_user_id for update;
  select count(distinct a.id)::integer into v_backed_count from public.flow_assets a join public.flow_purchase_operations o on o.id=a.backing_operation_id and o.status='confirmed' and coalesce(o.refund_status,'') not in ('pending_review','reversed') join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active' join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.entry_type='reserve_deposit' and coalesce(f.reference_usd_amount,0)>0 where a.owner_user_id=p_user_id and a.status in ('available','activated','transferred');
  if v_wallet_balance<>v_backed_count then raise exception 'La wallet no está reconciliada con sus FLOW respaldados y libres.'; end if;
  if v_wallet_balance<p_quantity then raise exception 'Saldo de FLOW respaldado insuficiente para retirar.'; end if;
  insert into public.flow_redemption_operations(id,user_id,player_id,quantity,flow_usd_value_snapshot,target_country,target_currency,provider,payout_method,payout_destination_id,gross_reference_usd,fx_pair,fx_rate,fx_source,fx_quoted_at,gross_payout_amount,provider_fee,clouva_fee,net_payout_amount,idempotency_key,external_id,status,reserve_release_status,locked_at,metadata) values(p_redemption_id,p_user_id,v_player_id,p_quantity,p_flow_usd_value,upper(p_target_country),upper(p_target_currency),p_provider,p_payout_method,p_destination_id,v_gross_reference_usd,p_fx_pair,p_fx_rate,p_fx_source,p_fx_quoted_at,p_gross_payout_amount,p_provider_fee,p_clouva_fee,p_net_payout_amount,p_redemption_id::text,'flow-redemption:'||p_redemption_id::text,'locked','not_started',now(),jsonb_build_object('walletBalanceBefore',v_wallet_balance));
  for r_asset in select a.id as flow_asset_id,a.status as previous_status,b.id as allocation_id,b.reserve_account_id,b.funding_entry_id,b.reference_usd_value,r.currency as reserve_currency,(b.reference_usd_value*f.amount/f.reference_usd_amount) as reserve_release_amount from public.flow_assets a join public.flow_purchase_operations o on o.id=a.backing_operation_id and o.status='confirmed' and coalesce(o.refund_status,'') not in ('pending_review','reversed') join public.flow_backing_allocations b on b.flow_asset_id=a.id and b.status='active' join public.flow_reserve_accounts r on r.id=b.reserve_account_id and r.flow_account_role='reserve' and r.authorized_for_flow and r.is_active and r.status='active' and r.account_reference is not null join public.flow_funding_ledger f on f.id=b.funding_entry_id and f.reserve_account_id=r.id and f.status='confirmed' and f.custody_status='confirmed' and f.entry_type='reserve_deposit' and f.reference_usd_amount>0 and f.amount>0 where a.owner_user_id=p_user_id and a.status in ('available','activated','transferred') order by a.flow_number limit p_quantity for update of a,b,r,f loop
    insert into public.flow_redemption_items(redemption_id,flow_asset_id,backing_allocation_id,reserve_account_id,funding_entry_id,reference_usd_value,previous_asset_status,reserve_currency,reserve_release_amount,metadata) values(p_redemption_id,r_asset.flow_asset_id,r_asset.allocation_id,r_asset.reserve_account_id,r_asset.funding_entry_id,r_asset.reference_usd_value,r_asset.previous_status,upper(r_asset.reserve_currency),r_asset.reserve_release_amount,jsonb_build_object('lockedAt',now()));
    update public.flow_assets set status='redemption_pending',metadata=metadata||jsonb_build_object('redemptionId',p_redemption_id,'redemptionHeldAt',now()) where id=r_asset.flow_asset_id;
    insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,to_user_id,from_player_id,to_player_id,created_by,metadata) values(r_asset.flow_asset_id,'redemption_held',p_user_id,p_user_id,v_player_id,v_player_id,p_actor_id,jsonb_build_object('redemptionId',p_redemption_id,'backingMoved',false)); v_selected:=v_selected+1;
  end loop;
  if v_selected<>p_quantity then raise exception 'No hay suficientes FLOW respaldados y libres para retirar.'; end if;
  v_new_balance:=v_wallet_balance-p_quantity; update public.flows_wallets set balance=v_new_balance,updated_at=now() where user_id=p_user_id;
  insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,source,reference_id,metadata,created_by) values(p_user_id,'redemption_hold',-p_quantity,v_new_balance,'flow_redemption',p_redemption_id::text,jsonb_build_object('redemptionId',p_redemption_id,'quantity',p_quantity),p_actor_id);
  return jsonb_build_object('redemptionId',p_redemption_id,'status','locked','duplicate',false,'quantity',p_quantity,'walletBalanceAfter',v_new_balance,'grossReferenceUsd',v_gross_reference_usd,'netPayoutAmount',p_net_payout_amount,'currency',upper(p_target_currency));
end $$;
revoke all on function public.request_flow_redemption(uuid,uuid,integer,uuid,text,text,text,text,numeric,text,numeric,text,timestamptz,numeric,numeric,numeric,numeric,uuid) from public,anon,authenticated;
grant execute on function public.request_flow_redemption(uuid,uuid,integer,uuid,text,text,text,text,numeric,text,numeric,text,timestamptz,numeric,numeric,numeric,numeric,uuid) to service_role;

create or replace function public.cancel_flow_redemption(p_redemption_id uuid,p_actor_id uuid,p_status text default 'failed',p_failure_code text default null,p_failure_safe_reason text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.flow_redemption_operations%rowtype; v_wallet integer:=0; v_count integer:=0; r_item record;
begin
  if p_status not in ('failed','cancelled') then raise exception 'Estado final de redención inválido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flow-redemption:'||p_redemption_id::text,0)); select * into v_op from public.flow_redemption_operations where id=p_redemption_id for update;
  if not found then raise exception 'Redención inexistente.'; end if; if v_op.status in ('failed','cancelled') then return jsonb_build_object('redemptionId',v_op.id,'status',v_op.status,'duplicate',true); end if;
  if v_op.status in ('payout_confirmed','completed') then raise exception 'Una redención con payout confirmado no puede restaurarse.'; end if; if v_op.status not in ('locked','payout_submitted','payout_pending','manual_review') then raise exception 'La redención no admite cancelación en su estado actual.'; end if;
  select balance into v_wallet from public.flows_wallets where user_id=v_op.user_id for update;
  for r_item in select i.*,a.status as current_asset_status from public.flow_redemption_items i join public.flow_assets a on a.id=i.flow_asset_id where i.redemption_id=v_op.id order by i.id for update of i,a loop
    if r_item.current_asset_status<>'redemption_pending' then raise exception 'Un FLOW del retiro ya no está retenido correctamente.'; end if;
    update public.flow_assets set status=r_item.previous_asset_status,metadata=(metadata-'redemptionId'-'redemptionHeldAt')||jsonb_build_object('redemptionCancelledAt',now()) where id=r_item.flow_asset_id;
    insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,to_user_id,from_player_id,to_player_id,created_by,metadata) values(r_item.flow_asset_id,'redemption_cancelled',v_op.user_id,v_op.user_id,v_op.player_id,v_op.player_id,p_actor_id,jsonb_build_object('redemptionId',v_op.id)); v_count:=v_count+1;
  end loop;
  if v_count<>v_op.quantity then raise exception 'Los FLOW retenidos no coinciden con la redención.'; end if;
  update public.flows_wallets set balance=v_wallet+v_op.quantity,updated_at=now() where user_id=v_op.user_id;
  insert into public.flows_wallet_ledger(user_id,transaction_type,amount,balance_after,source,reference_id,metadata,created_by) values(v_op.user_id,'redemption_cancel',v_op.quantity,v_wallet+v_op.quantity,'flow_redemption',v_op.id::text,jsonb_build_object('redemptionId',v_op.id,'reason',p_failure_code),p_actor_id) on conflict(transaction_type,reference_id) where transaction_type in ('redemption_hold','redemption_cancel') and reference_id is not null do nothing;
  update public.flow_redemption_operations set status=p_status,failure_code=p_failure_code,failure_safe_reason=p_failure_safe_reason,cancelled_at=case when p_status='cancelled' then now() else cancelled_at end,updated_at=now() where id=v_op.id;
  return jsonb_build_object('redemptionId',v_op.id,'status',p_status,'duplicate',false,'walletRestored',v_op.quantity);
end $$;
revoke all on function public.cancel_flow_redemption(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cancel_flow_redemption(uuid,uuid,text,text,text) to service_role;

create or replace function public.finalize_flow_redemption(p_redemption_id uuid,p_actor_id uuid,p_custody_reference text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_op public.flow_redemption_operations%rowtype; v_count integer:=0; r_item record; r_release record; v_release jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('flow-redemption:'||p_redemption_id::text,0)); select * into v_op from public.flow_redemption_operations where id=p_redemption_id for update;
  if not found then raise exception 'Redención inexistente.'; end if; if v_op.status='completed' then return jsonb_build_object('redemptionId',v_op.id,'status','completed','duplicate',true); end if; if v_op.status<>'payout_confirmed' then raise exception 'El payout todavía no está confirmado.'; end if;
  update public.flow_redemption_operations set reserve_release_status='pending',updated_at=now() where id=v_op.id;
  for r_item in select i.*,a.status as current_asset_status,b.status as allocation_status from public.flow_redemption_items i join public.flow_assets a on a.id=i.flow_asset_id join public.flow_backing_allocations b on b.id=i.backing_allocation_id where i.redemption_id=v_op.id order by i.id for update of i,a,b loop
    if r_item.current_asset_status<>'redemption_pending' or r_item.allocation_status<>'active' then raise exception 'El backing exacto del retiro no está en el estado esperado.'; end if;
    update public.flow_assets set status='redeemed',metadata=metadata||jsonb_build_object('redeemedBy',v_op.id,'redeemedAt',now()) where id=r_item.flow_asset_id;
    update public.flow_backing_allocations set status='released',released_at=now(),metadata=metadata||jsonb_build_object('redemptionId',v_op.id,'releasedForPayout',true) where id=r_item.backing_allocation_id;
    update public.flow_redemption_items set released_at=now() where id=r_item.id;
    insert into public.flow_asset_movements(flow_asset_id,action,from_user_id,from_player_id,created_by,metadata) values(r_item.flow_asset_id,'redeemed',v_op.user_id,v_op.player_id,p_actor_id,jsonb_build_object('redemptionId',v_op.id,'providerPayoutId',v_op.provider_payout_id)); v_count:=v_count+1;
  end loop;
  if v_count<>v_op.quantity then raise exception 'Los FLOW del retiro no coinciden con la operación.'; end if;
  for r_release in select reserve_account_id,reserve_currency,sum(reserve_release_amount) as local_amount,sum(reference_usd_value) as usd_amount from public.flow_redemption_items where redemption_id=v_op.id group by reserve_account_id,reserve_currency loop
    select public.record_flow_reserve_release(r_release.reserve_account_id,r_release.local_amount,r_release.reserve_currency,r_release.usd_amount,coalesce(nullif(trim(p_custody_reference),''),'redemption:'||v_op.id::text),'redemption-reserve-release:'||v_op.id::text||':'||r_release.reserve_account_id::text,p_actor_id,jsonb_build_object('redemptionId',v_op.id,'provider',v_op.provider,'providerPayoutId',v_op.provider_payout_id)) into v_release;
  end loop;
  update public.flow_redemption_operations set status='completed',reserve_release_status='completed',completed_at=now(),updated_at=now() where id=v_op.id;
  return jsonb_build_object('redemptionId',v_op.id,'status','completed','duplicate',false,'redeemed',v_count,'backingReleased',true);
end $$;
revoke all on function public.finalize_flow_redemption(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_flow_redemption(uuid,uuid,text) to service_role;
