-- CLOUVA Security Hardening V1
-- Locks privileged profile fields at the PostgreSQL boundary, makes profiles private,
-- and documents/normalizes the intended SECURITY DEFINER execution surface.

begin;

-- Keep privilege-bearing fields deterministic when a profile is created.
alter table public.profiles alter column role set default 'customer'::public.app_role;
alter table public.profiles alter column role_v2 set default 'cliente'::public.user_role_v3;
alter table public.profiles alter column is_vip set default false;
alter table public.profiles alter column is_blocked set default false;

-- profiles is private account state. Public identity is served by the canonical
-- players/public identity layer, not by exposing every profile row.
drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles self upsert" on public.profiles;
drop policy if exists "profiles_self_insert" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profiles_self_select" on public.profiles;

create policy "profiles_self_select"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles_self_insert"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "profiles_self_update"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Remove broad client grants first. service_role/postgres are intentionally not
-- changed and remain the privileged server-side path.
revoke all privileges on table public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on table public.profiles from authenticated;

-- Signed-in users may only read their own row through RLS.
grant select on table public.profiles to authenticated;

-- Profile creation may set identity/profile fields, but privileged fields are
-- omitted and therefore receive the safe database defaults above.
grant insert (
  id,
  display_name,
  avatar_3d_url,
  full_name,
  phone,
  email,
  avatar_url,
  clouva_id,
  username,
  bio,
  accent_color,
  social_links,
  spotify_url,
  city,
  onboarding_status,
  onboarding_completed_at,
  country_code
) on public.profiles to authenticated;

-- A user can maintain their own editable profile attributes only. role,
-- role_v2, is_vip and is_blocked are deliberately absent.
grant update (
  display_name,
  avatar_3d_url,
  full_name,
  phone,
  email,
  avatar_url,
  username,
  bio,
  accent_color,
  social_links,
  spotify_url,
  city,
  onboarding_status,
  onboarding_completed_at,
  country_code
) on public.profiles to authenticated;

-- PUBLIC READ: intentionally callable without a session. These functions return
-- published/public state only and are used by public Player/Studio/UI surfaces.
revoke execute on function public.is_player_vip(uuid) from public;
grant execute on function public.is_player_vip(uuid) to anon, authenticated, service_role;

revoke execute on function public.is_studio_os_active(uuid) from public;
grant execute on function public.is_studio_os_active(uuid) to anon, authenticated, service_role;

revoke execute on function public.ui_get_published_page(text) from public;
grant execute on function public.ui_get_published_page(text) to anon, authenticated, service_role;

-- AUTHENTICATED / RLS HELPERS: these functions are part of existing RLS policy
-- expressions or self-service flows. They stay callable by authenticated users,
-- but anonymous/PUBLIC execution is explicitly removed.
revoke execute on function public.can_administer_spaces() from public, anon;
grant execute on function public.can_administer_spaces() to authenticated, service_role;

revoke execute on function public.can_manage_player(uuid) from public, anon;
grant execute on function public.can_manage_player(uuid) to authenticated, service_role;

revoke execute on function public.can_manage_studio(uuid) from public, anon;
grant execute on function public.can_manage_studio(uuid) to authenticated, service_role;

revoke execute on function public.can_manage_studio(uuid, uuid) from public, anon;
grant execute on function public.can_manage_studio(uuid, uuid) to authenticated, service_role;

revoke execute on function public.claim_studio_access(text) from public, anon;
grant execute on function public.claim_studio_access(text) to authenticated, service_role;

revoke execute on function public.commerce_spot_can(uuid, uuid, text) from public, anon;
grant execute on function public.commerce_spot_can(uuid, uuid, text) to authenticated, service_role;

revoke execute on function public.commerce_spot_role_for_user(uuid, uuid) from public, anon;
grant execute on function public.commerce_spot_role_for_user(uuid, uuid) to authenticated, service_role;

revoke execute on function public.current_user_controls_player(uuid) from public, anon;
grant execute on function public.current_user_controls_player(uuid) to authenticated, service_role;

revoke execute on function public.has_active_player_entitlement() from public, anon;
grant execute on function public.has_active_player_entitlement() to authenticated, service_role;

revoke execute on function public.has_active_vip_entitlement() from public, anon;
grant execute on function public.has_active_vip_entitlement() to authenticated, service_role;

revoke execute on function public.is_active_player_manager(uuid, uuid) from public, anon;
grant execute on function public.is_active_player_manager(uuid, uuid) to authenticated, service_role;

revoke execute on function public.is_active_studio_participant(uuid, uuid) from public, anon;
grant execute on function public.is_active_studio_participant(uuid, uuid) to authenticated, service_role;

revoke execute on function public.space_can(uuid, text) from public, anon;
grant execute on function public.space_can(uuid, text) to authenticated, service_role;

revoke execute on function public.space_role_for_current_user(uuid) from public, anon;
grant execute on function public.space_role_for_current_user(uuid) to authenticated, service_role;

revoke execute on function public.trusted_map_can_view_user(uuid) from public, anon;
grant execute on function public.trusted_map_can_view_user(uuid) to authenticated, service_role;

revoke execute on function public.trusted_map_has_audience(uuid) from public, anon;
grant execute on function public.trusted_map_has_audience(uuid) to authenticated, service_role;

revoke execute on function public.trusted_map_is_group_member(uuid, uuid) from public, anon;
grant execute on function public.trusted_map_is_group_member(uuid, uuid) to authenticated, service_role;

-- INTERNAL ONLY overload: policy/internal helpers may evaluate another user id,
-- but browser sessions must not invoke this overload directly.
revoke execute on function public.can_administer_spaces(uuid) from public, anon, authenticated;
grant execute on function public.can_administer_spaces(uuid) to service_role;

-- ADMIN ONLY RPC entry points. Authenticated execution is required so a caller
-- can reach the function, but each function performs its existing server-side
-- admin check before accessing privileged data or mutating state.
revoke execute on function public.clouva_control_is_admin() from public, anon;
grant execute on function public.clouva_control_is_admin() to authenticated, service_role;

revoke execute on function public.clouva_control_commerce_summary() from public, anon;
grant execute on function public.clouva_control_commerce_summary() to authenticated, service_role;

revoke execute on function public.clouva_control_processes(integer) from public, anon;
grant execute on function public.clouva_control_processes(integer) to authenticated, service_role;

revoke execute on function public.ui_save_page_draft(text, jsonb) from public, anon;
grant execute on function public.ui_save_page_draft(text, jsonb) to authenticated, service_role;

revoke execute on function public.ui_publish_page(text, text) from public, anon;
grant execute on function public.ui_publish_page(text, text) to authenticated, service_role;

revoke execute on function public.ui_restore_page_version(text, integer, text) from public, anon;
grant execute on function public.ui_restore_page_version(text, integer, text) to authenticated, service_role;

commit;
