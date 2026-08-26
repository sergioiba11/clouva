-- Keep reservation arithmetic at the same numeric(10,4) precision as the
-- ledger columns. PostgreSQL otherwise rounds on reserve but can subtract the
-- original higher-precision estimate on finalize/release, leaving a phantom
-- 0.0001 reservation after a completed job.

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
  v_estimated numeric(10,4) := round(coalesce(p_estimated_cost_usd, 0), 4);
begin
  if p_estimated_cost_usd is null or v_estimated <= 0 then
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
  if v_budget.spent_usd + v_budget.reserved_usd + v_estimated > v_allowed_limit then
    return query select false, 'budget_exceeded', v_budget.spent_usd, v_budget.reserved_usd, v_budget.hard_limit_usd, v_budget.normal_limit_usd;
    return;
  end if;

  update public.ai_image_budgets as b
  set
    reserved_usd = b.reserved_usd + v_estimated,
    status = case
      when b.spent_usd + b.reserved_usd + v_estimated >= b.hard_limit_usd then 'blocked'
      when b.spent_usd + b.reserved_usd + v_estimated >= b.normal_limit_usd then 'reserve_only'
      when b.spent_usd + b.reserved_usd + v_estimated >= b.normal_limit_usd * 0.9 then 'near_limit'
      else b.status
    end
  where b.scope = p_scope
  returning b.* into v_budget;

  return query select true, 'reserved', v_budget.spent_usd, v_budget.reserved_usd, v_budget.hard_limit_usd, v_budget.normal_limit_usd;
end;
$$;

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
  v_estimated numeric(10,4) := round(coalesce(p_estimated_cost_usd, 0), 4);
  v_actual numeric(10,4) := round(coalesce(p_actual_cost_usd, 0), 4);
begin
  update public.ai_image_budgets as b
  set
    reserved_usd = greatest(0, b.reserved_usd - v_estimated),
    spent_usd = b.spent_usd + v_actual,
    status = case
      when b.spent_usd + v_actual + greatest(0, b.reserved_usd - v_estimated) >= b.hard_limit_usd then 'blocked'
      when b.spent_usd + v_actual + greatest(0, b.reserved_usd - v_estimated) >= b.normal_limit_usd then 'reserve_only'
      when b.spent_usd + v_actual + greatest(0, b.reserved_usd - v_estimated) >= b.normal_limit_usd * 0.9 then 'near_limit'
      when b.status = 'paused' then b.status
      else 'active'
    end
  where b.scope = p_scope;
end;
$$;

create or replace function public.release_ai_image_budget(
  p_scope text,
  p_estimated_cost_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estimated numeric(10,4) := round(coalesce(p_estimated_cost_usd, 0), 4);
begin
  update public.ai_image_budgets as b
  set
    reserved_usd = greatest(0, b.reserved_usd - v_estimated),
    status = case
      when b.spent_usd + greatest(0, b.reserved_usd - v_estimated) >= b.hard_limit_usd then 'blocked'
      when b.spent_usd + greatest(0, b.reserved_usd - v_estimated) >= b.normal_limit_usd then 'reserve_only'
      when b.spent_usd + greatest(0, b.reserved_usd - v_estimated) >= b.normal_limit_usd * 0.9 then 'near_limit'
      when b.status = 'paused' then b.status
      else 'active'
    end
  where b.scope = p_scope;
end;
$$;

revoke all on function public.reserve_ai_image_budget(text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.finalize_ai_image_budget(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.release_ai_image_budget(text, numeric) from public, anon, authenticated;
grant execute on function public.reserve_ai_image_budget(text, numeric, boolean) to service_role;
grant execute on function public.finalize_ai_image_budget(text, numeric, numeric) to service_role;
grant execute on function public.release_ai_image_budget(text, numeric) to service_role;

-- Repair only the observed sub-cent precision residue when no generation can
-- still own it. Never touch a live reservation or a material amount.
update public.ai_image_budgets as budget
set reserved_usd = 0,
    status = case when budget.status = 'paused' then budget.status else 'active' end
where budget.scope = 'trebol_media_2026'
  and budget.reserved_usd > 0
  and budget.reserved_usd <= 0.0001
  and not exists (
    select 1 from public.media_generation_jobs as media_job
    where media_job.type = 'image'
      and media_job.status in ('queued', 'generating', 'processing', 'saving')
  )
  and not exists (
    select 1 from public.ai_image_generation_jobs as image_job
    where image_job.scope = budget.scope
      and image_job.status in ('budget_reserved', 'generating')
  );
