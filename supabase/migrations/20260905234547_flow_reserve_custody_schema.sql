create table if not exists public.flow_reserve_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null,
  account_type text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_reference text null,
  status text not null default 'active' check (status in ('active','disabled')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists flow_reserve_accounts_provider_reference_uidx
  on public.flow_reserve_accounts(provider, account_reference)
  where account_reference is not null;

create index if not exists flow_reserve_accounts_active_idx
  on public.flow_reserve_accounts(provider, currency)
  where is_active and status='active';

alter table public.flow_reserve_accounts enable row level security;
revoke all on public.flow_reserve_accounts from anon, authenticated;

insert into public.flow_reserve_accounts(
  name, provider, account_type, currency, account_reference, status, is_active, metadata
)
select
  'Mercado Pago CLOUVA',
  'mercadopago',
  'digital_wallet',
  'ARS',
  null,
  'active',
  true,
  jsonb_build_object('seeded', true, 'purpose', 'flow_reserve')
where not exists (
  select 1
  from public.flow_reserve_accounts
  where provider='mercadopago' and is_active and status='active'
);

alter table public.flow_funding_ledger
  add column if not exists reserve_account_id uuid null references public.flow_reserve_accounts(id) on delete restrict,
  add column if not exists custody_status text not null default 'not_in_reserve',
  add column if not exists custody_reference text null,
  add column if not exists custody_confirmed_at timestamptz null,
  add column if not exists reference_usd_amount numeric null;

alter table public.flow_funding_ledger alter column operation_id drop not null;

alter table public.flow_funding_ledger drop constraint if exists flow_funding_ledger_entry_type_check;
alter table public.flow_funding_ledger
  add constraint flow_funding_ledger_entry_type_check
  check (entry_type in ('funding','refund','reversal','reserve_deposit','reserve_release'));

alter table public.flow_funding_ledger drop constraint if exists flow_funding_ledger_custody_status_check;
alter table public.flow_funding_ledger
  add constraint flow_funding_ledger_custody_status_check
  check (custody_status in ('not_in_reserve','pending','confirmed','released','reversed'));

alter table public.flow_funding_ledger drop constraint if exists flow_funding_ledger_reference_usd_amount_check;
alter table public.flow_funding_ledger
  add constraint flow_funding_ledger_reference_usd_amount_check
  check (reference_usd_amount is null or reference_usd_amount >= 0);

create index if not exists flow_funding_reserve_account_idx
  on public.flow_funding_ledger(reserve_account_id, occurred_at desc)
  where reserve_account_id is not null;

create index if not exists flow_funding_custody_idx
  on public.flow_funding_ledger(custody_status, entry_type, status);

create table if not exists public.flow_backing_allocations (
  id uuid primary key default gen_random_uuid(),
  flow_asset_id uuid not null references public.flow_assets(id) on delete restrict,
  reserve_account_id uuid not null references public.flow_reserve_accounts(id) on delete restrict,
  funding_entry_id uuid null references public.flow_funding_ledger(id) on delete restrict,
  reference_usd_value numeric not null check (reference_usd_value > 0),
  status text not null default 'active' check (status in ('active','released','reversed')),
  allocated_at timestamptz not null default now(),
  released_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists flow_backing_allocations_one_active_per_asset
  on public.flow_backing_allocations(flow_asset_id)
  where status='active';

create index if not exists flow_backing_allocations_reserve_idx
  on public.flow_backing_allocations(reserve_account_id, status);

alter table public.flow_backing_allocations enable row level security;
revoke all on public.flow_backing_allocations from anon, authenticated;

alter table public.flow_asset_movements drop constraint if exists flow_asset_movements_action_check;
alter table public.flow_asset_movements
  add constraint flow_asset_movements_action_check
  check (action in ('issued','backed','backing_pending','activated','transferred','refund','reversal'));

create or replace function public.flow_reserve_account_free_usd(p_account_id uuid)
returns numeric
language sql
security definer
set search_path='public'
as $$
with reserve_money as (
  select
    coalesce(sum(reference_usd_amount) filter (
      where status='confirmed'
        and custody_status='confirmed'
        and entry_type in ('funding','reserve_deposit')
    ), 0) as credits,
    coalesce(sum(reference_usd_amount) filter (
      where status='confirmed'
        and entry_type in ('refund','reversal','reserve_release')
        and custody_status in ('confirmed','released','reversed')
    ), 0) as debits
  from public.flow_funding_ledger
  where reserve_account_id=p_account_id
), allocations as (
  select coalesce(sum(reference_usd_value),0) as allocated
  from public.flow_backing_allocations
  where reserve_account_id=p_account_id and status='active'
)
select reserve_money.credits-reserve_money.debits-allocations.allocated
from reserve_money, allocations;
$$;

revoke all on function public.flow_reserve_account_free_usd(uuid) from public, anon, authenticated;

-- Historical spendable FLOW is not assumed to have custody simply because a
-- legacy payment/funding row exists. Preserve the asset and history, remove its
-- spendability from the wallet, and require an explicit reserve deposit before
-- reactivation.
do $$
declare r record;
begin
  for r in
    select a.owner_user_id, count(*)::integer as qty
    from public.flow_assets a
    where a.status in ('available','activated','transferred')
    group by a.owner_user_id
  loop
    if coalesce((select balance from public.flows_wallets where user_id=r.owner_user_id),0) < r.qty then
      raise exception 'No se puede reconciliar FLOW histórico: wallet menor que activos monetarios.';
    end if;

    perform public.adjust_flows_balance(
      r.owner_user_id,
      -r.qty,
      'admin_adjustment',
      'reserve_custody_migration',
      'reserve-custody-20260905',
      jsonb_build_object(
        'reason','Historical FLOW requires custody proof',
        'quantity',r.qty
      ),
      null
    );
  end loop;
end $$;

insert into public.flow_asset_movements(
  flow_asset_id, action, from_user_id, from_player_id, operation_id, metadata
)
select
  a.id,
  'backing_pending',
  a.owner_user_id,
  a.owner_player_id,
  a.backing_operation_id,
  jsonb_build_object(
    'reason','reserve_custody_required',
    'previousBackingOperationId',a.backing_operation_id
  )
from public.flow_assets a
where a.status in ('available','activated','transferred');

update public.flow_assets
set
  metadata = metadata || jsonb_build_object(
    'legacyBackingOperationId',backing_operation_id,
    'custodyMigrationAt',now()
  ),
  status='legacy_unverified',
  backing_operation_id=null,
  backed_at=null
where status in ('available','activated','transferred');

update public.flow_purchase_operations o
set
  backing_status='legacy_unverified',
  metadata=metadata || jsonb_build_object(
    'custodyMigrationAt',now(),
    'requiresReserveCustody',true
  ),
  updated_at=now()
where exists (
  select 1
  from public.flow_assets a
  where a.operation_id=o.id and a.status='legacy_unverified'
);

update public.flow_funding_ledger
set
  custody_status='not_in_reserve',
  reserve_account_id=null,
  custody_reference=null,
  custody_confirmed_at=null,
  reference_usd_amount=0,
  metadata=metadata || jsonb_build_object(
    'custodyMigrationAt',now(),
    'requiresReserveCustody',true
  )
where entry_type='funding';
