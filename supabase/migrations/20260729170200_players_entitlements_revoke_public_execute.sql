-- Postgres grants EXECUTE to the PUBLIC pseudo-role by default on function
-- creation -- revoking from the anon/authenticated roles directly (previous
-- migration) doesn't remove access while PUBLIC still has it, since those
-- roles inherit through PUBLIC. Revoke from PUBLIC explicitly, then re-grant
-- only what's actually needed: authenticated needs EXECUTE on
-- has_active_player_entitlement so the players/studios insert policies can
-- evaluate it; nothing needs direct RPC access to the trigger function at all.
revoke execute on function public.has_active_player_entitlement() from public;
revoke execute on function public.enforce_players_protected_fields() from public;

grant execute on function public.has_active_player_entitlement() to authenticated;
