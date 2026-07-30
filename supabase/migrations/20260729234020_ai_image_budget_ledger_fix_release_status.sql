-- release_ai_image_budget decremented reserved_usd but never recomputed
-- status, so a release could leave the ledger permanently stuck at
-- 'reserve_only'/'blocked' even after the reservation causing it was
-- fully released. Recompute status the same way finalize does.
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
  update public.ai_image_budgets as b
  set
    reserved_usd = greatest(0, b.reserved_usd - coalesce(p_estimated_cost_usd, 0)),
    status = case
      when b.spent_usd + greatest(0, b.reserved_usd - coalesce(p_estimated_cost_usd, 0)) >= b.hard_limit_usd then 'blocked'
      when b.spent_usd + greatest(0, b.reserved_usd - coalesce(p_estimated_cost_usd, 0)) >= b.normal_limit_usd then 'reserve_only'
      when b.spent_usd + greatest(0, b.reserved_usd - coalesce(p_estimated_cost_usd, 0)) >= b.normal_limit_usd * 0.9 then 'near_limit'
      when b.status in ('paused') then b.status
      else 'active'
    end
  where b.scope = p_scope;
end;
$$;

revoke all on function public.release_ai_image_budget(text, numeric) from public;
grant execute on function public.release_ai_image_budget(text, numeric) to service_role;
