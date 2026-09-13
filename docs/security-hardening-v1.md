# CLOUVA Security Hardening V1

This document records the authorization boundary introduced by Security Hardening V1. It does not create a second permission model; it narrows the existing Supabase/Postgres surface.

## Canonical authorization boundary

1. Supabase Auth authenticates the user.
2. Browser clients use the publishable/anon key only.
3. RLS owns row visibility for client-side database access.
4. Privileged API routes validate the bearer token with `auth.getUser()`.
5. Administrative API routes resolve the immutable database role server-side.
6. `service_role` remains server-only and is used only after the caller has been authorized.

`user_metadata` is not an authorization source.

## `profiles`

`public.profiles` is private account state. Public Player identity is served by the existing `players`/public-identity layer.

Authenticated users can:

- SELECT only their own profile row.
- INSERT only their own profile row using safe database defaults for privileged state.
- UPDATE only explicitly granted personal/profile columns on their own row.

Authenticated users cannot write:

- `role`
- `role_v2`
- `is_vip`
- `is_blocked`

Administrative changes to these fields must go through an authorized server/service-role path.

## SECURITY DEFINER classification

### PUBLIC READ

These functions intentionally expose published/public booleans or published UI state. Anonymous execution is retained:

- `is_player_vip(uuid)`
- `is_studio_os_active(uuid)`
- `ui_get_published_page(text)`

### AUTHENTICATED / RLS HELPERS

These functions are existing self-service or RLS helpers. Anonymous/PUBLIC execution is revoked; authenticated execution is retained because current RLS policies depend on it:

- `can_administer_spaces()`
- `can_manage_player(uuid)`
- `can_manage_studio(uuid)`
- `can_manage_studio(uuid, uuid)`
- `claim_studio_access(text)`
- `commerce_spot_can(uuid, uuid, text)`
- `commerce_spot_role_for_user(uuid, uuid)`
- `current_user_controls_player(uuid)`
- `has_active_player_entitlement()`
- `has_active_vip_entitlement()`
- `is_active_player_manager(uuid, uuid)`
- `is_active_studio_participant(uuid, uuid)`
- `space_can(uuid, text)`
- `space_role_for_current_user(uuid)`
- `trusted_map_can_view_user(uuid)`
- `trusted_map_has_audience(uuid)`
- `trusted_map_is_group_member(uuid, uuid)`

The overload `can_administer_spaces(uuid)` is internal-only and remains service-role-only.

### ADMIN ONLY ENTRY POINTS

Authenticated callers may invoke these RPC entry points, but each function performs its existing database admin check before privileged data is returned or changed. Anonymous/PUBLIC execution is revoked:

- `clouva_control_is_admin()`
- `clouva_control_commerce_summary()`
- `clouva_control_processes(integer)`
- `ui_save_page_draft(text, jsonb)`
- `ui_publish_page(text, text)`
- `ui_restore_page_version(text, integer, text)`

The important property is that the role consulted by these checks is no longer writable by ordinary authenticated clients.

## Account blocking

`requireUser()` remains the authenticated API choke point and checks `profiles.is_blocked` through the service-role client. Security Hardening V1 removes browser write access to `is_blocked`, so a blocked account cannot clear its own block flag.

## Public repository / secrets

The repository may remain public. Secret values must live only in deployment/CI secret stores or server runtime configuration. `.env.example` remains versioned, while private `.env` variants are ignored.

## Web boundary

The Next.js response layer applies CSP, HSTS, MIME sniffing protection, frame protection, referrer policy, OAuth-compatible opener policy and a Permissions Policy while preserving the current Google/Supabase/media integration model.
