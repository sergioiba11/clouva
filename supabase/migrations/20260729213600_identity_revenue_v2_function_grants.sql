-- Supabase's default privileges grant EXECUTE on new functions directly to
-- anon/authenticated/service_role, so "revoke from public" in the previous
-- migrations left anon able to call these RPCs. Same gotcha the Players stage
-- fixed in 20260729170200; re-applied here for the V2 functions.

revoke execute on function public.can_manage_studio(uuid) from anon;
revoke execute on function public.claim_studio_access(text) from anon;

-- Rate-limit consumption is a server-only primitive: nothing a browser calls
-- directly may spend someone else's bucket.
revoke execute on function public.consume_public_form_rate_limit(text, text, integer, integer) from anon, authenticated;

-- is_player_vip stays callable by anon on purpose: public profiles render the
-- VIP badge without a session and the function only returns a boolean.
