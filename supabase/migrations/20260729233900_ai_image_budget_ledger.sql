-- Atomic budget ledger for Gemini-generated visual-system assets.
-- Nothing in the codebase tracked AI spend before this (audited: no
-- "budget"/"generation_job"/"usage_metadata" table existed). Modeled after
-- the row-lock pattern already used by consume_public_form_rate_limit.

create table if not exists public.ai_image_budgets (
  id uuid primary key default gen_random_uuid(),
  scope text not null unique,
  currency text not null default 'USD',
  hard_limit_usd numeric(10,2) not null,
  normal_limit_usd numeric(10,2) not null,
  reserve_limit_usd numeric(10,2) not null,
  spent_usd numeric(10,4) not null default 0,
  reserved_usd numeric(10,4) not null default 0,
  status text not null default 'active'
    check (status in ('active', 'near_limit', 'reserve_only', 'blocked', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_image_budgets_limits_check check (
    hard_limit_usd > 0
    and normal_limit_usd > 0
    and normal_limit_usd <= hard_limit_usd
    and reserve_limit_usd >= 0
    and normal_limit_usd + reserve_limit_usd = hard_limit_usd
  )
);

alter table public.ai_image_budgets enable row level security;

create table if not exists public.ai_image_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  scope text not null references public.ai_image_budgets(scope),
  purpose text not null,
  page text not null,
  asset_type text not null,
  prompt_hash text not null,
  input_hash text not null,
  idempotency_key text not null,
  model text not null,
  resolution text not null,
  estimated_cost_usd numeric(10,4) not null default 0,
  actual_cost_usd numeric(10,4),
  status text not null default 'planned'
    check (status in (
      'planned', 'budget_reserved', 'generating', 'completed',
      'failed', 'rejected', 'reused', 'blocked_budget'
    )),
  retry_count integer not null default 0,
  output_path text,
  error_code text,
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists ai_image_generation_jobs_idempotency_unique
  on public.ai_image_generation_jobs(idempotency_key);
create index if not exists ai_image_generation_jobs_reuse_idx
  on public.ai_image_generation_jobs(prompt_hash, input_hash, model, resolution, status);
create index if not exists ai_image_generation_jobs_scope_status_idx
  on public.ai_image_generation_jobs(scope, status);
create index if not exists ai_image_generation_jobs_page_idx
  on public.ai_image_generation_jobs(page, asset_type);

alter table public.ai_image_generation_jobs enable row level security;

-- Admins can read the ledger and job history for the "Presupuesto visual
-- Gemini" panel. All writes go through the SECURITY DEFINER functions below
-- (service role only) -- never a direct client insert/update.
create policy ai_image_budgets_admin_read
  on public.ai_image_budgets for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
create policy ai_image_generation_jobs_admin_read
  on public.ai_image_generation_jobs for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create or replace function public.touch_ai_image_budgets_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_ai_image_budgets_updated_at() from public;

create trigger ai_image_budgets_touch_updated_at
  before update on public.ai_image_budgets
  for each row execute function public.touch_ai_image_budgets_updated_at();

-- Reserve `p_estimated_cost_usd` against `p_scope` before calling Gemini.
-- Locks the budget row (`for update`) so concurrent requests serialize
-- instead of racing past the limit. `p_use_reserve` must be explicitly true
-- to dip into the protected final reserve_limit_usd slice.
create or replace function public.reserve_ai_image_budget(
  p_scope text,
  p_estimated_cost_usd numeric,
  p_use_reserve boolean default false
)
returns table(allowed boolean, reason text, spent_usd numeric, reserved_usd numeric, hard_limit_usd numeric, normal_limit_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.ai_image_budgets%rowtype;
  v_allowed_limit numeric;
begin
  if p_estimated_cost_usd is null or p_estimated_cost_usd <= 0 then
    return query select false, 'invalid_estimated_cost', null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  select * into v_budget
  from public.ai_image_budgets
  where scope = p_scope
  for update;

  if not found then
    return query select false, 'budget_not_found', null::numeric, null::numeric, null::numeric, null::numeric;
    return;
  end if;

  if v_budget.status in ('blocked', 'paused') then
    return query select false, v_budget.status, v_budget.spent_usd, v_budget.reserved_usd, v_budget.hard_limit_usd, v_budget.normal_limit_usd;
    return;
  end if;

  v_allowed_limit := case when p_use_reserve then v_budget.hard_limit_usd else v_budget.normal_limit_usd end;

  if v_budget.spent_usd + v_budget.reserved_usd + p_estimated_cost_usd > v_allowed_limit then
    return query select false, 'budget_exceeded', v_budget.spent_usd, v_budget.reserved_usd, v_budget.hard_limit_usd, v_budget.normal_limit_usd;
    return;
  end if;

  update public.ai_image_budgets
  set
    reserved_usd = reserved_usd + p_estimated_cost_usd,
    status = case
      when spent_usd + reserved_usd + p_estimated_cost_usd >= hard_limit_usd then 'blocked'
      when spent_usd + reserved_usd + p_estimated_cost_usd >= normal_limit_usd then 'reserve_only'
      when spent_usd + reserved_usd + p_estimated_cost_usd >= normal_limit_usd * 0.9 then 'near_limit'
      else status
    end
  where scope = p_scope
  returning * into v_budget;

  return query select true, 'reserved', v_budget.spent_usd, v_budget.reserved_usd, v_budget.hard_limit_usd, v_budget.normal_limit_usd;
end;
$$;

revoke all on function public.reserve_ai_image_budget(text, numeric, boolean) from public;
grant execute on function public.reserve_ai_image_budget(text, numeric, boolean) to service_role;

-- Move a reservation into actual spend once Gemini has responded. Releases
-- the unused difference between what was reserved and what was really
-- charged (or the full reservation, if p_actual_cost_usd is 0/null because
-- the call failed before any billable usage).
create or replace function public.finalize_ai_image_budget(
  p_scope text,
  p_estimated_cost_usd numeric,
  p_actual_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual numeric := coalesce(p_actual_cost_usd, 0);
begin
  update public.ai_image_budgets
  set
    reserved_usd = greatest(0, reserved_usd - coalesce(p_estimated_cost_usd, 0)),
    spent_usd = spent_usd + v_actual,
    status = case
      when spent_usd + v_actual >= hard_limit_usd then 'blocked'
      when spent_usd + v_actual >= normal_limit_usd then 'reserve_only'
      when spent_usd + v_actual >= normal_limit_usd * 0.9 then 'near_limit'
      else 'active'
    end
  where scope = p_scope;
end;
$$;

revoke all on function public.finalize_ai_image_budget(text, numeric, numeric) from public;
grant execute on function public.finalize_ai_image_budget(text, numeric, numeric) to service_role;

-- Release a reservation with zero charge (request never reached Gemini, or
-- failed before any billable usage).
create or replace function public.release_ai_image_budget(
  p_scope text,
  p_estimated_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_image_budgets
  set reserved_usd = greatest(0, reserved_usd - coalesce(p_estimated_cost_usd, 0))
  where scope = p_scope;
end;
$$;

revoke all on function public.release_ai_image_budget(text, numeric) from public;
grant execute on function public.release_ai_image_budget(text, numeric) to service_role;

insert into public.ai_image_budgets (scope, currency, hard_limit_usd, normal_limit_usd, reserve_limit_usd, spent_usd, reserved_usd, status)
values ('visual_redesign_2026', 'USD', 40, 36, 4, 0, 0, 'active')
on conflict (scope) do nothing;
