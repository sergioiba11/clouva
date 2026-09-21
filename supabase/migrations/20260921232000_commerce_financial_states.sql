-- Commerce financial states: inventory capital -> pending settlement -> settled available.
-- FLOW equivalents use the exact Spot FX snapshot. Spendable FLOW remains separate and reserve-backed.

create or replace function public.commerce_spot_financial_summary(p_spot_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with variant_lines as (
    select greatest(coalesce(v.stock,0),0)::numeric units,
           coalesce(v.cost_override,p.cost_amount,0)::numeric unit_cost,
           coalesce(v.price_override,p.price,0)::numeric unit_price
    from public.commerce_products p
    join public.commerce_product_variants v on v.product_id=p.id
    where p.spot_id=p_spot_id and p.product_type='physical' and p.status<>'archived'
  ),
  base_lines as (
    select greatest(coalesce(p.stock,0),0)::numeric units,
           coalesce(p.cost_amount,0)::numeric unit_cost,
           coalesce(p.price,0)::numeric unit_price
    from public.commerce_products p
    where p.spot_id=p_spot_id and p.product_type='physical' and p.status<>'archived'
      and not exists(select 1 from public.commerce_product_variants v where v.product_id=p.id)
  ),
  inventory as (
    select coalesce(sum(x.units*x.unit_cost),0) capital_local,
           coalesce(sum(x.units*x.unit_price),0) retail_local
    from (select * from variant_lines union all select * from base_lines) x
  ),
  totals as (
    select coalesce(sum(gross_original),0) gross_local,
           coalesce(sum(cost_original),0) costs_local,
           coalesce(sum(commission_original),0) commissions_local,
           coalesce(sum(net_original),0) net_local,
           coalesce(sum(gross_original-commission_original),0) available_local,
           coalesce(sum(gross_usd),0) gross_usd,
           coalesce(sum(cost_usd),0) costs_usd,
           coalesce(sum(commission_usd),0) commissions_usd,
           coalesce(sum(net_usd),0) net_usd,
           coalesce(sum(gross_usd-commission_usd),0) available_usd,
           coalesce(sum(flows_amount),0) flows
    from public.commerce_flow_ledger
    where spot_id=p_spot_id and status='confirmed'
  ),
  pending as (
    select coalesce(sum(total),0) amount_local
    from public.commerce_orders
    where spot_id=p_spot_id and payment_status='pending'
      and external_payment_id is not null and status<>'cancelled'
  ),
  goal as (
    select * from public.commerce_financial_goals
    where spot_id=p_spot_id and status='active' order by created_at desc limit 1
  ),
  latest_fx as (
    select * from public.commerce_fx_rates
    where spot_id=p_spot_id order by quoted_at desc limit 1
  ),
  spot as (select currency from public.commerce_spots where id=p_spot_id)
  select jsonb_build_object(
    'currency',coalesce(spot.currency,'ARS'),
    'gross_local',totals.gross_local,
    'costs_local',totals.costs_local,
    'commissions_local',totals.commissions_local,
    'net_local',totals.net_local,
    'realized_margin_local',totals.net_local,
    'available_local',totals.available_local,
    'pending_settlement_local',pending.amount_local,
    'stock_capital_local',inventory.capital_local,
    'stock_retail_local',inventory.retail_local,
    'gross_usd',totals.gross_usd,
    'costs_usd',totals.costs_usd,
    'commissions_usd',totals.commissions_usd,
    'net_usd',totals.net_usd,
    'available_usd',totals.available_usd,
    'flows',totals.flows,
    'stock_capital_flows',case when latest_fx.local_per_quote>0 then round(inventory.capital_local/latest_fx.local_per_quote,8) else 0 end,
    'pending_settlement_flows',case when latest_fx.local_per_quote>0 then round(pending.amount_local/latest_fx.local_per_quote,8) else 0 end,
    'available_flows_equivalent',case when latest_fx.local_per_quote>0 then round(totals.available_local/latest_fx.local_per_quote,8) else totals.available_usd end,
    'goal',case when goal.id is null then null else jsonb_build_object(
      'id',goal.id,'name',goal.name,'metric',goal.metric,
      'target_currency',goal.target_currency,'target_amount',goal.target_amount,
      'progress_amount',case goal.metric
        when 'gross_revenue' then totals.gross_usd
        when 'available_balance' then totals.available_usd
        else totals.net_usd end
    ) end,
    'fx_rate',case when latest_fx.id is null then null else to_jsonb(latest_fx) end
  )
  from totals cross join inventory cross join pending
  left join goal on true left join latest_fx on true left join spot on true;
$$;

create or replace function public.upsert_mi_flow_money_event(
  p_beneficiary_user_id uuid,p_beneficiary_type text,p_beneficiary_entity_id uuid,p_currency text,
  p_source_type text,p_source_id uuid,p_gross_amount_minor bigint,p_fees_amount_minor bigint,
  p_commission_amount_minor bigint,p_net_amount_minor bigint,p_event_status text,p_event_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns public.mi_flow_money_ledger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.mi_flow_money_ledger%rowtype;
  v_status text;
begin
  if p_beneficiary_user_id is null then raise exception 'MI FLOW beneficiary is required'; end if;
  if p_event_status not in ('pending','paid','available','settled','refunded','reversed') then
    raise exception 'Unsupported MI FLOW payment event: %',p_event_status;
  end if;
  v_status:=case p_event_status
    when 'refunded' then 'refunded'
    when 'reversed' then 'reversed'
    when 'available' then 'available'
    when 'settled' then 'available'
    else 'pending' end;

  insert into public.mi_flow_money_ledger(
    beneficiary_user_id,beneficiary_type,beneficiary_entity_id,currency,source_type,source_id,
    gross_amount_minor,fees_amount_minor,commission_amount_minor,net_amount_minor,status,
    pending_at,available_at,refunded_at,reversed_at,metadata
  ) values (
    p_beneficiary_user_id,p_beneficiary_type,p_beneficiary_entity_id,upper(p_currency),p_source_type,p_source_id,
    greatest(p_gross_amount_minor,0),greatest(p_fees_amount_minor,0),greatest(p_commission_amount_minor,0),
    greatest(p_net_amount_minor,0),v_status,
    case when v_status='pending' then coalesce(p_event_at,now()) end,
    case when v_status='available' then coalesce(p_event_at,now()) end,
    case when v_status='refunded' then coalesce(p_event_at,now()) end,
    case when v_status='reversed' then coalesce(p_event_at,now()) end,
    coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict(source_type,source_id,beneficiary_user_id) do update set
    gross_amount_minor=excluded.gross_amount_minor,
    fees_amount_minor=excluded.fees_amount_minor,
    commission_amount_minor=excluded.commission_amount_minor,
    net_amount_minor=excluded.net_amount_minor,
    status=case
      when excluded.status in ('refunded','reversed') then excluded.status
      when mi_flow_money_ledger.status='withdrawn' then 'withdrawn'
      when excluded.status='available' then 'available'
      when mi_flow_money_ledger.status='available' then 'available'
      else 'pending' end,
    pending_at=case when excluded.status='pending' then coalesce(mi_flow_money_ledger.pending_at,excluded.pending_at) else mi_flow_money_ledger.pending_at end,
    available_at=case when excluded.status='available' then coalesce(mi_flow_money_ledger.available_at,excluded.available_at,now()) else mi_flow_money_ledger.available_at end,
    refunded_at=case when excluded.status='refunded' then coalesce(excluded.refunded_at,now()) else mi_flow_money_ledger.refunded_at end,
    reversed_at=case when excluded.status='reversed' then coalesce(excluded.reversed_at,now()) else mi_flow_money_ledger.reversed_at end,
    metadata=mi_flow_money_ledger.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.upsert_mi_flow_money_event(uuid,text,uuid,text,text,uuid,bigint,bigint,bigint,bigint,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_mi_flow_money_event(uuid,text,uuid,text,text,uuid,bigint,bigint,bigint,bigint,text,timestamptz,jsonb) to service_role;

create or replace function public.sync_commerce_order_to_mi_flow()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid;
  v_entity_type text;
  v_entity_id uuid;
  v_event_status text;
  v_gross numeric;
  v_fees numeric;
  v_commission numeric;
begin
  if new.seller_type='clouva' then return new; end if;
  if new.payment_status='pending' and new.external_payment_id is null then return new; end if;
  if new.payment_status not in ('pending','paid','refunded') then return new; end if;

  if new.seller_type='player' and new.seller_player_id is not null then
    select p.owner_user_id into v_user_id from public.players p where p.id=new.seller_player_id;
    v_entity_type:='player'; v_entity_id:=new.seller_player_id;
  elsif new.seller_type='studio' and new.seller_studio_id is not null then
    select s.owner_id into v_user_id from public.studios s where s.id=new.seller_studio_id;
    v_entity_type:='studio'; v_entity_id:=new.seller_studio_id;
  end if;
  if v_user_id is null or v_entity_id is null then return new; end if;

  v_event_status:=case
    when new.payment_status='refunded' then 'refunded'
    when new.payment_status='pending' then 'pending'
    else 'paid' end;
  v_gross:=greatest(coalesce(new.total,0),0);
  v_fees:=greatest(coalesce(new.fees,0),0);
  v_commission:=greatest(coalesce(new.commission,0),0);

  perform public.upsert_mi_flow_money_event(
    v_user_id,v_entity_type,v_entity_id,coalesce(new.currency,'ARS'),'commerce_order',new.id,
    round(v_gross*100)::bigint,round(v_fees*100)::bigint,round(v_commission*100)::bigint,
    round(greatest(v_gross-v_fees-v_commission,0)*100)::bigint,v_event_status,coalesce(new.paid_at,now()),
    jsonb_build_object('seller_type',new.seller_type,'spot_id',new.spot_id,'order_total',new.total,'external_payment_id',new.external_payment_id)
  );
  return new;
end;
$$;

revoke all on function public.sync_commerce_order_to_mi_flow() from public,anon,authenticated;
drop trigger if exists commerce_orders_sync_mi_flow on public.commerce_orders;
create trigger commerce_orders_sync_mi_flow
  after insert or update of payment_status,subtotal,fees,commission,total,external_payment_id on public.commerce_orders
  for each row execute function public.sync_commerce_order_to_mi_flow();

create or replace function public.sync_commerce_payment_to_mi_flow()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order public.commerce_orders%rowtype;
  v_user_id uuid;
  v_entity_type text;
  v_entity_id uuid;
  v_commission numeric;
begin
  if new.status<>'confirmed' then return new; end if;
  select * into v_order from public.commerce_orders where id=new.order_id;
  if not found or v_order.payment_status<>'paid' or v_order.seller_type='clouva' then return new; end if;

  if v_order.seller_type='player' and v_order.seller_player_id is not null then
    select p.owner_user_id into v_user_id from public.players p where p.id=v_order.seller_player_id;
    v_entity_type:='player'; v_entity_id:=v_order.seller_player_id;
  elsif v_order.seller_type='studio' and v_order.seller_studio_id is not null then
    select s.owner_id into v_user_id from public.studios s where s.id=v_order.seller_studio_id;
    v_entity_type:='studio'; v_entity_id:=v_order.seller_studio_id;
  end if;
  if v_user_id is null or v_entity_id is null then return new; end if;

  v_commission:=greatest(coalesce(v_order.commission,0),0);
  perform public.upsert_mi_flow_money_event(
    v_user_id,v_entity_type,v_entity_id,coalesce(new.currency,v_order.currency,'ARS'),'commerce_order',v_order.id,
    round(greatest(coalesce(new.gross_amount,0),0)*100)::bigint,
    round(greatest(coalesce(new.fee_amount,0),0)*100)::bigint,
    round(v_commission*100)::bigint,
    round(greatest(coalesce(new.gross_amount,0)-coalesce(new.fee_amount,0)-v_commission,0)*100)::bigint,
    'available',coalesce(new.confirmed_at,now()),
    jsonb_build_object('seller_type',v_order.seller_type,'spot_id',v_order.spot_id,'order_total',v_order.total,'payment_id',new.id,'provider',new.provider,'external_payment_id',new.external_payment_id)
  );
  return new;
end;
$$;

revoke all on function public.sync_commerce_payment_to_mi_flow() from public,anon,authenticated;
drop trigger if exists commerce_payments_sync_mi_flow on public.commerce_payments;
create trigger commerce_payments_sync_mi_flow
  after insert or update of status,gross_amount,fee_amount,net_amount,confirmed_at on public.commerce_payments
  for each row execute function public.sync_commerce_payment_to_mi_flow();

update public.mi_flow_money_ledger ml
set gross_amount_minor=round(greatest(coalesce(cp.gross_amount,0),0)*100)::bigint,
    fees_amount_minor=round(greatest(coalesce(cp.fee_amount,0),0)*100)::bigint,
    commission_amount_minor=round(greatest(coalesce(co.commission,0),0)*100)::bigint,
    net_amount_minor=round(greatest(coalesce(cp.gross_amount,0)-coalesce(cp.fee_amount,0)-coalesce(co.commission,0),0)*100)::bigint,
    status=case when ml.status='withdrawn' then 'withdrawn' else 'available' end,
    available_at=coalesce(ml.available_at,cp.confirmed_at,cp.created_at),
    metadata=ml.metadata||jsonb_build_object('spot_id',co.spot_id,'payment_id',cp.id,'provider',cp.provider,'external_payment_id',cp.external_payment_id),
    updated_at=now()
from public.commerce_payments cp
join public.commerce_orders co on co.id=cp.order_id
where ml.source_type='commerce_order'
  and ml.source_id=cp.order_id
  and cp.status='confirmed'
  and co.payment_status='paid'
  and ml.status not in ('refunded','reversed');

insert into public.mi_flow_money_ledger(
  beneficiary_user_id,beneficiary_type,beneficiary_entity_id,currency,source_type,source_id,
  gross_amount_minor,fees_amount_minor,commission_amount_minor,net_amount_minor,status,pending_at,metadata
)
select case co.seller_type when 'player' then p.owner_user_id when 'studio' then s.owner_id end,
       co.seller_type,
       case co.seller_type when 'player' then co.seller_player_id else co.seller_studio_id end,
       upper(coalesce(co.currency,'ARS')),
       'commerce_order',co.id,
       round(greatest(coalesce(co.total,0),0)*100)::bigint,
       round(greatest(coalesce(co.fees,0),0)*100)::bigint,
       round(greatest(coalesce(co.commission,0),0)*100)::bigint,
       round(greatest(coalesce(co.total,0)-coalesce(co.fees,0)-coalesce(co.commission,0),0)*100)::bigint,
       'pending',coalesce(co.updated_at,co.created_at),
       jsonb_build_object('seller_type',co.seller_type,'spot_id',co.spot_id,'order_total',co.total,'external_payment_id',co.external_payment_id)
from public.commerce_orders co
left join public.players p on co.seller_type='player' and p.id=co.seller_player_id
left join public.studios s on co.seller_type='studio' and s.id=co.seller_studio_id
where co.payment_status='pending'
  and co.external_payment_id is not null
  and co.seller_type in ('player','studio')
  and case co.seller_type when 'player' then p.owner_user_id else s.owner_id end is not null
on conflict(source_type,source_id,beneficiary_user_id) do nothing;
