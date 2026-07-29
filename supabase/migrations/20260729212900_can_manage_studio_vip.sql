-- One-argument, caller-scoped studio administration check used by Identity V2.
-- The existing two-argument helper remains intact for backwards compatibility.
-- This migration intentionally uses the pre-existing starts_at/expires_at fields;
-- valid_from/valid_until are added by the next migration.
create or replace function public.can_manage_studio(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.user_entitlements ue
      where ue.user_id = auth.uid()
        and ue.tier = 'vip'
        and ue.status = 'active'
        and ue.starts_at <= now()
        and (ue.expires_at is null or ue.expires_at > now())
    )
    and (
      exists (
        select 1 from public.studios s
        where s.id = p_studio_id and s.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.studio_members sm
        where sm.studio_id = p_studio_id
          and sm.profile_id = auth.uid()
          and sm.status = 'active'
          and sm.role in ('owner', 'admin', 'manager', 'editor')
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'
      )
    );
$$;

revoke all on function public.can_manage_studio(uuid) from public;
grant execute on function public.can_manage_studio(uuid) to authenticated;
