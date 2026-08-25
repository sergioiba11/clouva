-- Distributed rate limit for issuing Gemini Live ephemeral tokens. The table
-- is never readable from a browser; only the server-side service role may call
-- the atomic SECURITY INVOKER function.

create table if not exists public.trebol_live_token_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.trebol_live_token_limits enable row level security;
revoke all on public.trebol_live_token_limits from public, anon, authenticated, service_role;
grant select, insert, update on public.trebol_live_token_limits to service_role;

drop policy if exists trebol_live_token_limits_deny_user_access on public.trebol_live_token_limits;
create policy trebol_live_token_limits_deny_user_access
  on public.trebol_live_token_limits
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create or replace function public.consume_trebol_live_token_limit(
  p_user_id uuid,
  p_window_seconds integer default 60,
  p_max_requests integer default 5
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.trebol_live_token_limits%rowtype;
  v_now timestamptz := statement_timestamp();
  v_window_seconds integer := greatest(10, least(p_window_seconds, 3600));
  v_max_requests integer := greatest(1, least(p_max_requests, 100));
begin
  insert into public.trebol_live_token_limits as limits (
    user_id,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_user_id,
    v_now,
    1,
    v_now
  )
  on conflict (user_id) do update
  set window_started_at = case
        when limits.window_started_at + make_interval(secs => v_window_seconds) <= v_now then v_now
        else limits.window_started_at
      end,
      request_count = case
        when limits.window_started_at + make_interval(secs => v_window_seconds) <= v_now then 1
        else limits.request_count + 1
      end,
      updated_at = v_now
  returning * into v_row;

  allowed := v_row.request_count <= v_max_requests;
  remaining := greatest(v_max_requests - v_row.request_count, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (
      v_row.window_started_at + make_interval(secs => v_window_seconds) - v_now
    )))::integer)
  end;
  return next;
end;
$$;

revoke all on function public.consume_trebol_live_token_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_trebol_live_token_limit(uuid, integer, integer) to service_role;
