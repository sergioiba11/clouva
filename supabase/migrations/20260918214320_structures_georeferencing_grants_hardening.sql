-- Harden grants created by legacy/default public-schema privileges.
-- RLS is still the row-level authorization layer; this removes table-level powers
-- that the browser role does not need (TRUNCATE/REFERENCES/TRIGGER).

revoke all on table public.structure_spatial_features from anon, authenticated, service_role;
grant select, insert, update, delete on table public.structure_spatial_features to authenticated, service_role;
