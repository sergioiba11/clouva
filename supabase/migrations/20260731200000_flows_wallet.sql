-- Flows: CLOUVA's internal credit balance (Fase 8). NOT a cryptocurrency --
-- an integer credit balance, same spirit as ai_image_budgets' ledger but for
-- per-user spend instead of the shared Gemini budget.
--
-- Named flows_* (plural), deliberately distinct from the pre-existing flow_*
-- (singular) tables under app/mi-flow/* -- flow_flows is an unrelated
-- personal songwriting-notes CRUD (20260522070000_flow_clover_modules.sql).
-- Reusing that name would recreate the exact "two things called VIP" bug
-- already found and fixed in user_entitlements/profiles.is_vip this session.
--
-- flows_wallets holds the fast-read current balance; flows_wallet_ledger is
-- the immutable transaction history. Both only ever change together, through
-- adjust_flows_balance() -- "nunca modificar el saldo directamente sin
-- registrar una transacción" is enforced structurally (no client write
-- policy on either table), not just by convention.

create table public.flows_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.flows_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null check (transaction_type in (
    'purchase', 'reward', 'refund', 'ai_usage', 'avatar_purchase',
    'marketplace_purchase', 'admin_adjustment', 'promotional_credit'
  )),
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  source text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index flows_wallet_ledger_user_idx on public.flows_wallet_ledger(user_id, created_at desc);

-- Atomic credit/debit -- row-locks the wallet first so two concurrent spends
-- can't both read the same starting balance, same defensive pattern as
-- reserve_ai_image_budget / publish_player_profile_version.
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
set search_path = public
as $$
declare
  v_balance integer;
  v_new_balance integer;
  v_ledger public.flows_wallet_ledger%rowtype;
begin
  insert into public.flows_wallets (user_id, balance) values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance into v_balance from public.flows_wallets where user_id = p_user_id for update;

  v_new_balance := v_balance + p_amount;
  if v_new_balance < 0 then
    raise exception 'Saldo de Flows insuficiente.';
  end if;

  update public.flows_wallets set balance = v_new_balance, updated_at = now() where user_id = p_user_id;

  insert into public.flows_wallet_ledger (user_id, transaction_type, amount, balance_after, source, reference_id, metadata, created_by)
  values (p_user_id, p_transaction_type, p_amount, v_new_balance, p_source, p_reference_id, p_metadata, p_created_by)
  returning * into v_ledger;

  return v_ledger;
end;
$$;

revoke all on function public.adjust_flows_balance(uuid, integer, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.adjust_flows_balance(uuid, integer, text, text, text, jsonb, uuid) to service_role;

alter table public.flows_wallets enable row level security;

create policy flows_wallets_select_self_or_admin
  on public.flows_wallets for select
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.flows_wallet_ledger enable row level security;

create policy flows_wallet_ledger_select_self_or_admin
  on public.flows_wallet_ledger for select
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- No insert/update/delete policy on either table for anon/authenticated on
-- purpose -- every write goes through adjust_flows_balance() via the
-- service role, which bypasses RLS entirely. Client-side direct writes are
-- structurally impossible, not just discouraged.
