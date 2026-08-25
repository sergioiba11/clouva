-- Shared Trébol text/Live execution audit. Audio, credentials and ephemeral
-- Gemini tokens are deliberately excluded from these tables.

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  mode text not null check (mode in ('text', 'live')),
  model text not null,
  status text not null default 'running'
    check (status in ('running', 'waiting_confirmation', 'completed', 'failed', 'cancelled')),
  context_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ai_agent_runs_user_created_idx
  on public.ai_agent_runs (user_id, started_at desc);
create index if not exists ai_agent_runs_conversation_created_idx
  on public.ai_agent_runs (conversation_id, started_at desc);

alter table public.ai_agent_runs enable row level security;

drop policy if exists ai_agent_runs_select on public.ai_agent_runs;
create policy ai_agent_runs_select
  on public.ai_agent_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists ai_agent_runs_insert on public.ai_agent_runs;
create policy ai_agent_runs_insert
  on public.ai_agent_runs for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.ai_conversations as conversation
      where conversation.id = conversation_id
        and (
          (conversation.studio_id is null and conversation.user_id = (select auth.uid()))
          or (
            conversation.studio_id is not null
            and public.is_active_studio_participant(
              conversation.studio_id,
              (select auth.uid())
            )
          )
        )
    )
  );

drop policy if exists ai_agent_runs_update on public.ai_agent_runs;
create policy ai_agent_runs_update
  on public.ai_agent_runs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.ai_conversations as conversation
      where conversation.id = conversation_id
        and (
          (conversation.studio_id is null and conversation.user_id = (select auth.uid()))
          or (
            conversation.studio_id is not null
            and public.is_active_studio_participant(
              conversation.studio_id,
              (select auth.uid())
            )
          )
        )
    )
  );

create table if not exists public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_agent_runs(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  function_name text not null,
  target text not null,
  tool_name text not null,
  risk text not null check (risk in ('read', 'write', 'destructive', 'sensitive')),
  status text not null
    check (status in ('requested', 'executed', 'pending_confirmation', 'cancelled', 'failed')),
  arguments jsonb not null default '{}'::jsonb,
  confirmation jsonb,
  result jsonb,
  error_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ai_tool_calls_run_requested_idx
  on public.ai_tool_calls (run_id, requested_at);
create index if not exists ai_tool_calls_user_requested_idx
  on public.ai_tool_calls (user_id, requested_at desc);
create index if not exists ai_tool_calls_conversation_requested_idx
  on public.ai_tool_calls (conversation_id, requested_at desc);

alter table public.ai_tool_calls enable row level security;

drop policy if exists ai_tool_calls_select on public.ai_tool_calls;
create policy ai_tool_calls_select
  on public.ai_tool_calls for select
  to authenticated
  using ((select auth.uid()) = user_id);

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

revoke all on public.ai_agent_runs from public, anon, authenticated, service_role;
revoke all on public.ai_tool_calls from public, anon, authenticated, service_role;
grant select, insert, update on public.ai_agent_runs to authenticated;
grant select, insert, update on public.ai_tool_calls to authenticated;
grant select, insert, update on public.ai_agent_runs to service_role;
grant select, insert, update on public.ai_tool_calls to service_role;
