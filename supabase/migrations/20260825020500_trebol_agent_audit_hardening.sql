-- Forward-only correction for projects where trebol_agent_audit was applied
-- while broad legacy default privileges were still active. No data changes.

revoke all on public.ai_agent_runs from public, anon, authenticated, service_role;
revoke all on public.ai_tool_calls from public, anon, authenticated, service_role;
grant select, insert, update on public.ai_agent_runs to authenticated;
grant select, insert, update on public.ai_tool_calls to authenticated;
grant select, insert, update on public.ai_agent_runs to service_role;
grant select, insert, update on public.ai_tool_calls to service_role;

drop policy if exists ai_tool_calls_insert on public.ai_tool_calls;
create policy ai_tool_calls_insert
  on public.ai_tool_calls for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.ai_agent_runs as agent_run
      where agent_run.id = run_id
        and agent_run.conversation_id = ai_tool_calls.conversation_id
        and agent_run.user_id = (select auth.uid())
    )
  );

drop policy if exists ai_tool_calls_update on public.ai_tool_calls;
create policy ai_tool_calls_update
  on public.ai_tool_calls for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.ai_agent_runs as agent_run
      where agent_run.id = run_id
        and agent_run.conversation_id = ai_tool_calls.conversation_id
        and agent_run.user_id = (select auth.uid())
    )
  );
