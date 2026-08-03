-- Transitional, automatically-updatable alias for already-running Cloud Run
-- revisions while the new code deploys. This is not a second source of truth:
-- all reads/writes still hit public.studio_memberships. Remove the view after
-- every production revision references the canonical table name.
drop view if exists public.studio_fan_memberships;
create view public.studio_fan_memberships
with (security_invoker = true)
as
select * from public.studio_memberships;

grant select, insert, update, delete on public.studio_fan_memberships to authenticated;
grant all on public.studio_fan_memberships to service_role;
