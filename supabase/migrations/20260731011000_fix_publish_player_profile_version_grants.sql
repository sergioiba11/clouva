-- publish_player_profile_version (20260730203000) only revoked from
-- `public`, not from `anon`/`authenticated` directly -- Supabase grants
-- EXECUTE on new public-schema functions to those roles by default, so
-- `revoke ... from public` alone doesn't remove it. Same class of bug as
-- the ai_image_budget functions fixed earlier (PR #251): any signed-in (or
-- even anonymous) user could call /rest/v1/rpc/publish_player_profile_version
-- directly with an arbitrary version_id, bypassing the ownership/VIP check
-- that only exists in the API route, not in this function itself.
revoke all on function public.publish_player_profile_version(uuid) from public, anon, authenticated;
grant execute on function public.publish_player_profile_version(uuid) to service_role;
