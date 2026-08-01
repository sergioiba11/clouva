-- Diamante: CLOUVA's second, scarce/premium credit balance -- distinct from
-- Flows (flows_wallets/flows_wallet_ledger, 20260731200000), which is the
-- "easy" currency earned through activity/VIP. Diamante is meant to be hard
-- to get (real-money purchase or big achievements) and reserved for
-- exclusive items later.
--
-- Deliberately a parallel table, not a currency column added to
-- flows_wallets/flows_wallet_ledger: Flows already ships live and is wired
-- into the VIP payment flow (core/billing/service.ts) -- widening its
-- primary key to (user_id, currency) would touch working code for no
-- immediate benefit. Structure is an exact mirror of flows_wallet.sql.
--
-- No minting/spending rules are wired yet on purpose -- what actually grants
-- or consumes Diamante (real-money purchase? achievements? both?) is still
-- an open product decision. This migration only ships the wallet + ledger +
-- balance display, same as Flows' own current (backend-only, no store yet)
-- state.

create table public.diamond_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.diamond_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'purchase', 'reward', 'refund', 'achievement', 'admin_adjustment', 'promotional_credit'
  )),
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  source text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index diamond_wallet_ledger_user_idx on public.diamond_wallet_ledger(user_id, created_at desc);

-- Same atomic-adjust pattern as adjust_flows_balance().
create or replace function public.adjust_diamond_balance(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_source text default null,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null
)
returns public.diamond_wallet_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_new_balance integer;
  v_ledger public.diamond_wallet_ledger%rowtype;
begin
  insert into public.diamond_wallets (user_id, balance) values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.diamond_wallets where user_id = p_user_id for update;

  v_new_balance := v_balance + p_amount;
  if v_new_balance < 0 then
    raise exception 'Saldo de Diamante insuficiente.';
  end if;

  update public.diamond_wallets set balance = v_new_balance, updated_at = now() where user_id = p_user_id;

  insert into public.diamond_wallet_ledger (user_id, transaction_type, amount, balance_after, source, reference_id, metadata, created_by)
  values (p_user_id, p_transaction_type, p_amount, v_new_balance, p_source, p_reference_id, p_metadata, p_created_by)
  returning * into v_ledger;

  return v_ledger;
end;
$$;

revoke all on function public.adjust_diamond_balance(uuid, integer, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.adjust_diamond_balance(uuid, integer, text, text, text, jsonb, uuid) to service_role;

alter table public.diamond_wallets enable row level security;

create policy diamond_wallets_select_self_or_admin
  on public.diamond_wallets for select
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.diamond_wallet_ledger enable row level security;

create policy diamond_wallet_ledger_select_self_or_admin
  on public.diamond_wallet_ledger for select
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- No insert/update/delete policy for anon/authenticated on either table --
-- every write goes through adjust_diamond_balance() via the service role.
