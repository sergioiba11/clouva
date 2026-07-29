-- The previous migration's `revoke select (phone) ... from anon` had no
-- effect: anon already held a blanket table-level SELECT grant (covering
-- every column, present and future) from Supabase's default setup, and a
-- column-specific REVOKE cannot narrow a table-level grant that was never
-- itself column-scoped. Confirmed for real: a raw anon REST call selecting
-- phone still returned it after the previous migration.
--
-- Fix: revoke the blanket table-level SELECT from anon, then grant SELECT
-- back on every column except phone.

revoke select on public.profiles from anon;

grant select (
  id, role, display_name, avatar_3d_url, full_name, email, avatar_url,
  clouva_id, is_vip, is_blocked, username, role_v2, created_at, updated_at,
  bio, accent_color, social_links, spotify_url, city
) on public.profiles to anon;
