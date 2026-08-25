-- MI FLOW: canonical personal real-money ledger.
--
-- This does NOT replace the business-facing commerce_flow_ledger, nor either
-- CLOUVA credit wallet. It projects verified paid/refunded commerce events into
-- one personal economic history so /mi-flow never has to infer wallet money
-- from flow_money_entries or from buyer activity.

begin;

create table if not exists public.mi_flow_money_ledger (
  id uuid primary key default gen_random_uuid(),
  beneficiary_user_id uuid not null references auth.users(id) on delete cascade,
  beneficiary_type text not null check (beneficiary_type in ('player', 'studio')),
  beneficiary_entity_id uuid not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  source_type text not null check (source_type in ('commerce_order', 'service_order', 'booking')),
  source_id uuid not null,
  gross_amount_minor bigint not null check (gross_amount_minor >= 0),
  fees_amount_minor bigint not null default 0 check (fees_amount_minor >= 0),
  commission_amount_minor bigint not null default 0 check (commission_amount_minor >= 0),
  net_amount_minor bigint not null check (net_amount_minor >= 0),
  status text not null check (status in ('pending', 'available', 'withdrawn', 'refunded', 'reversed')),
  pending_at timestamptz,
  available_at timestamptz,
  withdrawn_at timestamptz,
  refunded_at timestamptz,
  reversed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mi_flow_money_ledger_source_beneficiary_unique
    unique (source_type, source_id, beneficiary_user_id)
);

create index if not exists mi_flow_money_ledger_user_created_idx
  on public.mi_flow_money_ledger(beneficiary_user_id, created_at desc);
create index if not exists mi_flow_money_ledger_entity_created_idx
  on public.mi_flow_money_ledger(beneficiary_type, beneficiary_entity_id, created_at desc);
create index if not exists mi_flow_money_ledger_status_idx
  on public.mi_flow_money_ledger(beneficiary_user_id, status, currency);

alter table public.mi_flow_money_ledger enable row level security;

drop policy if exists mi_flow_money_ledger_self_or_admin_select on public.mi_flow_money_ledger;
create policy mi_flow_money_ledger_self_or_admin_select
  on public.mi_flow_money_ledger for select
  using (
    beneficiary_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- No client write policy. Payment webhooks/trusted server code and the database
-- triggers below are the only paths that can create economic entries.
revoke insert, update, delete on public.mi_flow_money_ledger from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'mi_flow_money_ledger_immutable_identity'
  ) then
    create or replace function public.protect_mi_flow_money_ledger_identity()
    returns trigger
    language plpgsql
    set search_path = public
    as $fn$
    begin
      if new.beneficiary_user_id <> old.beneficiary_user_id
        or new.beneficiary_type <> old.beneficiary_type
        or new.beneficiary_entity_id <> old.beneficiary_entity_id
        or new.source_type <> old.source_type
        or new.source_id <> old.source_id
        or new.currency <> old.currency then
        raise exception 'MI FLOW ledger economic identity is immutable';
      end if;
      new.updated_at = now();
      return new;
    end
    $fn$;

    create trigger mi_flow_money_ledger_immutable_identity
      before update on public.mi_flow_money_ledger
      for each row execute function public.protect_mi_flow_money_ledger_identity();
  end if;
end
$$;

create or replace function public.upsert_mi_flow_money_event(
  p_beneficiary_user_id uuid,
  p_beneficiary_type text,
  p_beneficiary_entity_id uuid,
  p_currency text,
  p_source_type text,
  p_source_id uuid,
  p_gross_amount_minor bigint,
  p_fees_amount_minor bigint,
  p_commission_amount_minor bigint,
  p_net_amount_minor bigint,
  p_event_status text,
  p_event_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns public.mi_flow_money_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mi_flow_money_ledger%rowtype;
  v_status text;
begin
  if p_beneficiary_user_id is null then
    raise exception 'MI FLOW beneficiary is required';
  end if;

  if p_event_status not in ('paid', 'refunded', 'reversed') then
    raise exception 'Unsupported MI FLOW payment event: %', p_event_status;
  end if;

  v_status := case p_event_status
    when 'refunded' then 'refunded'
    when 'reversed' then 'reversed'
    else 'pending'
  end;

  insert into public.mi_flow_money_ledger (
    beneficiary_user_id,
    beneficiary_type,
    beneficiary_entity_id,
    currency,
    source_type,
    source_id,
    gross_amount_minor,
    fees_amount_minor,
    commission_amount_minor,
    net_amount_minor,
    status,
    pending_at,
    refunded_at,
    reversed_at,
    metadata
  ) values (
    p_beneficiary_user_id,
    p_beneficiary_type,
    p_beneficiary_entity_id,
    upper(p_currency),
    p_source_type,
    p_source_id,
    greatest(p_gross_amount_minor, 0),
    greatest(p_fees_amount_minor, 0),
    greatest(p_commission_amount_minor, 0),
    greatest(p_net_amount_minor, 0),
    v_status,
    case when v_status = 'pending' then coalesce(p_event_at, now()) end,
    case when v_status = 'refunded' then coalesce(p_event_at, now()) end,
    case when v_status = 'reversed' then coalesce(p_event_at, now()) end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_type, source_id, beneficiary_user_id)
  do update set
    gross_amount_minor = excluded.gross_amount_minor,
    fees_amount_minor = excluded.fees_amount_minor,
    commission_amount_minor = excluded.commission_amount_minor,
    net_amount_minor = excluded.net_amount_minor,
    status = case
      when excluded.status in ('refunded', 'reversed') then excluded.status
      when mi_flow_money_ledger.status in ('available', 'withdrawn') then mi_flow_money_ledger.status
      else 'pending'
    end,
    pending_at = case
      when excluded.status = 'pending' then coalesce(mi_flow_money_ledger.pending_at, excluded.pending_at)
      else mi_flow_money_ledger.pending_at
    end,
    refunded_at = case
      when excluded.status = 'refunded' then coalesce(excluded.refunded_at, now())
      else mi_flow_money_ledger.refunded_at
    end,
    reversed_at = case
      when excluded.status = 'reversed' then coalesce(excluded.reversed_at, now())
      else mi_flow_money_ledger.reversed_at
    end,
    metadata = mi_flow_money_ledger.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_mi_flow_money_event(uuid, text, uuid, text, text, uuid, bigint, bigint, bigint, bigint, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_mi_flow_money_event(uuid, text, uuid, text, text, uuid, bigint, bigint, bigint, bigint, text, timestamptz, jsonb)
  to service_role;

create or replace function public.sync_commerce_order_to_mi_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_entity_type text;
  v_entity_id uuid;
  v_event_status text;
  v_subtotal numeric;
  v_commission numeric;
begin
  if new.payment_status not in ('paid', 'refunded') then
    return new;
  end if;
  if new.seller_type = 'clouva' then
    return new;
  end if;

  if new.seller_type = 'player' and new.seller_player_id is not null then
    select p.owner_user_id into v_user_id from public.players p where p.id = new.seller_player_id;
    v_entity_type := 'player';
    v_entity_id := new.seller_player_id;
  elsif new.seller_type = 'studio' and new.seller_studio_id is not null then
    select s.owner_id into v_user_id from public.studios s where s.id = new.seller_studio_id;
    v_entity_type := 'studio';
    v_entity_id := new.seller_studio_id;
  end if;

  if v_user_id is null or v_entity_id is null then return new; end if;

  v_event_status := case when new.payment_status = 'refunded' then 'refunded' else 'paid' end;
  v_subtotal := coalesce(new.subtotal, 0);
  v_commission := greatest(coalesce(new.commission, 0), 0);

  perform public.upsert_mi_flow_money_event(
    v_user_id,
    v_entity_type,
    v_entity_id,
    coalesce(new.currency, 'ARS'),
    'commerce_order',
    new.id,
    round(v_subtotal * 100)::bigint,
    round(greatest(coalesce(new.fees, 0), 0) * 100)::bigint,
    round(v_commission * 100)::bigint,
    round(greatest(v_subtotal - v_commission, 0) * 100)::bigint,
    v_event_status,
    coalesce(new.paid_at, now()),
    jsonb_build_object('seller_type', new.seller_type, 'order_total', new.total)
  );
  return new;
end;
$$;

create or replace function public.sync_service_order_to_mi_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event_status text;
begin
  if new.payment_status not in ('paid', 'refunded') then return new; end if;
  select s.owner_id into v_user_id from public.studios s where s.id = new.studio_id;
  if v_user_id is null then return new; end if;
  v_event_status := case when new.payment_status = 'refunded' then 'refunded' else 'paid' end;

  perform public.upsert_mi_flow_money_event(
    v_user_id, 'studio', new.studio_id, coalesce(new.currency, 'ARS'),
    'service_order', new.id,
    round(coalesce(new.total_amount, 0) * 100)::bigint,
    0, 0,
    round(coalesce(new.total_amount, 0) * 100)::bigint,
    v_event_status, coalesce(new.updated_at, now()),
    jsonb_build_object('order_status', new.status)
  );
  return new;
end;
$$;

create or replace function public.sync_booking_to_mi_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_event_status text;
begin
  if new.payment_status not in ('paid', 'refunded') then return new; end if;
  select s.owner_id into v_user_id from public.studios s where s.id = new.studio_id;
  if v_user_id is null then return new; end if;
  v_event_status := case when new.payment_status = 'refunded' then 'refunded' else 'paid' end;

  perform public.upsert_mi_flow_money_event(
    v_user_id, 'studio', new.studio_id, coalesce(new.currency, 'ARS'),
    'booking', new.id,
    round(coalesce(new.price, 0) * 100)::bigint,
    0, 0,
    round(coalesce(new.price, 0) * 100)::bigint,
    v_event_status, coalesce(new.updated_at, now()),
    jsonb_build_object('booking_status', new.status)
  );
  return new;
end;
$$;

revoke all on function public.sync_commerce_order_to_mi_flow() from public, anon, authenticated;
revoke all on function public.sync_service_order_to_mi_flow() from public, anon, authenticated;
revoke all on function public.sync_booking_to_mi_flow() from public, anon, authenticated;

drop trigger if exists commerce_orders_sync_mi_flow on public.commerce_orders;
create trigger commerce_orders_sync_mi_flow
  after insert or update of payment_status, subtotal, fees, commission on public.commerce_orders
  for each row execute function public.sync_commerce_order_to_mi_flow();

drop trigger if exists service_orders_sync_mi_flow on public.service_orders;
create trigger service_orders_sync_mi_flow
  after insert or update of payment_status, total_amount on public.service_orders
  for each row execute function public.sync_service_order_to_mi_flow();

drop trigger if exists bookings_sync_mi_flow on public.bookings;
create trigger bookings_sync_mi_flow
  after insert or update of payment_status, price on public.bookings
  for each row execute function public.sync_booking_to_mi_flow();

-- Backfill verified historical events. ON CONFLICT makes this safe to rerun.
insert into public.mi_flow_money_ledger (
  beneficiary_user_id, beneficiary_type, beneficiary_entity_id, currency,
  source_type, source_id, gross_amount_minor, fees_amount_minor,
  commission_amount_minor, net_amount_minor, status, pending_at, refunded_at, metadata
)
select
  case co.seller_type
    when 'player' then p.owner_user_id
    when 'studio' then s.owner_id
  end,
  co.seller_type,
  case co.seller_type when 'player' then co.seller_player_id else co.seller_studio_id end,
  upper(coalesce(co.currency, 'ARS')),
  'commerce_order', co.id,
  round(coalesce(co.subtotal, 0) * 100)::bigint,
  round(greatest(coalesce(co.fees, 0), 0) * 100)::bigint,
  round(greatest(coalesce(co.commission, 0), 0) * 100)::bigint,
  round(greatest(coalesce(co.subtotal, 0) - greatest(coalesce(co.commission, 0), 0), 0) * 100)::bigint,
  case when co.payment_status = 'refunded' then 'refunded' else 'pending' end,
  case when co.payment_status = 'paid' then coalesce(co.paid_at, co.created_at) end,
  case when co.payment_status = 'refunded' then now() end,
  jsonb_build_object('backfilled', true, 'seller_type', co.seller_type)
from public.commerce_orders co
left join public.players p on co.seller_type = 'player' and p.id = co.seller_player_id
left join public.studios s on co.seller_type = 'studio' and s.id = co.seller_studio_id
where co.payment_status in ('paid', 'refunded')
  and co.seller_type in ('player', 'studio')
  and case co.seller_type when 'player' then p.owner_user_id else s.owner_id end is not null
on conflict (source_type, source_id, beneficiary_user_id) do nothing;

insert into public.mi_flow_money_ledger (
  beneficiary_user_id, beneficiary_type, beneficiary_entity_id, currency,
  source_type, source_id, gross_amount_minor, net_amount_minor, status,
  pending_at, refunded_at, metadata
)
select
  s.owner_id, 'studio', so.studio_id, upper(coalesce(so.currency, 'ARS')),
  'service_order', so.id,
  round(coalesce(so.total_amount, 0) * 100)::bigint,
  round(coalesce(so.total_amount, 0) * 100)::bigint,
  case when so.payment_status = 'refunded' then 'refunded' else 'pending' end,
  case when so.payment_status = 'paid' then coalesce(so.updated_at, so.created_at) end,
  case when so.payment_status = 'refunded' then coalesce(so.updated_at, now()) end,
  jsonb_build_object('backfilled', true)
from public.service_orders so
join public.studios s on s.id = so.studio_id
where so.payment_status in ('paid', 'refunded')
  and s.owner_id is not null
on conflict (source_type, source_id, beneficiary_user_id) do nothing;

insert into public.mi_flow_money_ledger (
  beneficiary_user_id, beneficiary_type, beneficiary_entity_id, currency,
  source_type, source_id, gross_amount_minor, net_amount_minor, status,
  pending_at, refunded_at, metadata
)
select
  s.owner_id, 'studio', b.studio_id, upper(coalesce(b.currency, 'ARS')),
  'booking', b.id,
  round(coalesce(b.price, 0) * 100)::bigint,
  round(coalesce(b.price, 0) * 100)::bigint,
  case when b.payment_status = 'refunded' then 'refunded' else 'pending' end,
  case when b.payment_status = 'paid' then coalesce(b.updated_at, b.created_at) end,
  case when b.payment_status = 'refunded' then coalesce(b.updated_at, now()) end,
  jsonb_build_object('backfilled', true)
from public.bookings b
join public.studios s on s.id = b.studio_id
where b.payment_status in ('paid', 'refunded')
  and s.owner_id is not null
on conflict (source_type, source_id, beneficiary_user_id) do nothing;

commit;
