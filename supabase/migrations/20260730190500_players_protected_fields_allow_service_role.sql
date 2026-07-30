-- The players_protected_fields_guard trigger (see 20260729170000_players_entitlements_core.sql)
-- only recognized profiles.role = 'admin' as privileged, checked via auth.uid().
-- Service-role connections (used by legitimate server-side flows, e.g. the
-- Instagram self-claim import at app/api/integrations/instagram/import/route.ts)
-- have no auth.uid(), so the trigger blocked them too -- not just end users
-- self-approving their own claim/verification, which is what it's meant to stop.
-- auth.role() = 'service_role' is the standard Supabase way to recognize a
-- service-role connection; regular authenticated users always see 'authenticated'
-- there, so this does not weaken the protection against a user self-approving
-- their own Player via a client-side call.
create or replace function public.enforce_players_protected_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_admin boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') into is_admin;
  if is_admin then
    return new;
  end if;

  if new.owner_user_id is distinct from old.owner_user_id
    or new.is_verified is distinct from old.is_verified
    or new.claim_status is distinct from old.claim_status
    or new.claimed_at is distinct from old.claimed_at
    or new.approved_by is distinct from old.approved_by then
    raise exception 'Solo un admin puede modificar propiedad, verificación o estado de claim de un Player';
  end if;

  return new;
end;
$$;
