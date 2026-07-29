-- Close two RPC-exposure findings from the security advisor right after the
-- previous migration: has_active_player_entitlement(uuid) let ANY caller
-- (including anon) probe an arbitrary user_id's VIP/Player status via
-- /rest/v1/rpc/has_active_player_entitlement -- an enumeration leak. Switch it
-- to a zero-arg version scoped to auth.uid() so RPC callers can only ever
-- learn about themselves (which they can already do via the
-- user_entitlements SELECT policy anyway). The trigger function doesn't need
-- direct RPC exposure at all -- trigger firing doesn't require EXECUTE grants
-- on the trigger function for the invoking role, so revoking is safe.

drop policy if exists players_insert_entitled_owner_or_admin on public.players;
drop policy if exists studios_insert_entitled on public.studios;
drop function if exists public.has_active_player_entitlement(uuid);

create function public.has_active_player_entitlement()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_entitlements
    where user_id = auth.uid()
      and status = 'active'
      and tier in ('player', 'vip')
      and (expires_at is null or expires_at > now())
  );
$$;

revoke execute on function public.has_active_player_entitlement() from anon;
revoke execute on function public.enforce_players_protected_fields() from anon, authenticated;

create policy players_insert_entitled_owner_or_admin
  on public.players for insert
  with check (
    (owner_user_id = auth.uid() and public.has_active_player_entitlement())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy studios_insert_entitled
  on public.studios for insert
  with check (
    owner_id = auth.uid()
    and public.has_active_player_entitlement()
  );
