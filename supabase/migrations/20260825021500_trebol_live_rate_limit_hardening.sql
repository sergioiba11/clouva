-- Make the service-only access model explicit to RLS tooling. The service
-- role bypasses RLS; authenticated users have neither table grants nor a
-- permissive policy.

drop policy if exists trebol_live_token_limits_deny_user_access on public.trebol_live_token_limits;
create policy trebol_live_token_limits_deny_user_access
  on public.trebol_live_token_limits
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);
