-- Schema repairs required by the Identity & Revenue V2 server contracts.
-- Runs immediately after the core tables are created and before claim functions.

alter table public.studio_applications
  add column if not exists contact_email text;

create index if not exists studio_applications_contact_email_idx
  on public.studio_applications(studio_id, lower(contact_email), status)
  where contact_email is not null;

alter table public.player_studios
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.admin_audit_log
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'studio_access_claims_role_check'
      and conrelid = 'public.studio_access_claims'::regclass
  ) then
    alter table public.studio_access_claims
      add constraint studio_access_claims_role_check
      check (role in ('owner', 'admin', 'manager', 'editor'));
  end if;
end
$$;
