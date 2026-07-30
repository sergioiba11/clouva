-- reserve_ai_image_budget's RETURNS TABLE(...) creates implicit OUT
-- parameters named spent_usd/reserved_usd/hard_limit_usd/normal_limit_usd,
-- which collided with the identically-named table columns inside the
-- UPDATE ... SET statement (Postgres picked the OUT param, not the column).
-- Alias the target table and qualify every RHS/WHERE/RETURNING reference.
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
  from public.ai_image_budgets b
  where b.scope = p_scope
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

  update public.ai_image_budgets as b
  set
    reserved_usd = b.reserved_usd + p_estimated_cost_usd,
    status = case
      when b.spent_usd + b.reserved_usd + p_estimated_cost_usd >= b.hard_limit_usd then 'blocked'
      when b.spent_usd + b.reserved_usd + p_estimated_cost_usd >= b.normal_limit_usd then 'reserve_only'
      when b.spent_usd + b.reserved_usd + p_estimated_cost_usd >= b.normal_limit_usd * 0.9 then 'near_limit'
      else b.status
    end
  where b.scope = p_scope
  returning b.* into v_budget;

  return query select true, 'reserved', v_budget.spent_usd, v_budget.reserved_usd, v_budget.hard_limit_usd, v_budget.normal_limit_usd;
end;
$$;

revoke all on function public.reserve_ai_image_budget(text, numeric, boolean) from public;
grant execute on function public.reserve_ai_image_budget(text, numeric, boolean) to service_role;
