-- Harden SECURITY DEFINER helpers that should not be callable anonymously.
-- Revoke PUBLIC first because PostgreSQL function EXECUTE is granted to PUBLIC by default,
-- then explicitly preserve authenticated/service_role access where the app may rely on it.

revoke execute on function public.can_manage_studio(uuid, uuid) from public, anon;
grant execute on function public.can_manage_studio(uuid, uuid) to authenticated, service_role;

revoke execute on function public.commerce_spot_can(uuid, uuid, text) from public, anon;
grant execute on function public.commerce_spot_can(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.commerce_spot_role_for_user(uuid, uuid) from public, anon;
grant execute on function public.commerce_spot_role_for_user(uuid, uuid) to authenticated, service_role;

revoke execute on function public.is_active_player_manager(uuid, uuid) from public, anon;
grant execute on function public.is_active_player_manager(uuid, uuid) to authenticated, service_role;

revoke execute on function public.is_active_studio_participant(uuid, uuid) from public, anon;
grant execute on function public.is_active_studio_participant(uuid, uuid) to authenticated, service_role;

-- Trigger functions are invoked by their triggers, not as public RPCs.
revoke execute on function public.normalize_commerce_listing_spot_owner() from public, anon, authenticated;
grant execute on function public.normalize_commerce_listing_spot_owner() to service_role;

revoke execute on function public.normalize_commerce_order_spot_seller() from public, anon, authenticated;
grant execute on function public.normalize_commerce_order_spot_seller() to service_role;

-- Pin search paths for the two functions reported by the database linter.
alter function public.generate_clouva_id() set search_path = '';
alter function public.order_state_key(public.orders) set search_path = '';