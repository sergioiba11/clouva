-- The original write policies on studios/studio_members/community_events/
-- community_projects cross-referenced each other via inline `exists`
-- subqueries (a policy on studio_members querying studio_members itself to
-- check for an admin row, and studios<->studio_members querying each other),
-- which Postgres RLS cannot evaluate: "infinite recursion detected in policy
-- for relation studio_members" (42P17), confirmed with a real insert/update
-- test. Standard fix: a SECURITY DEFINER helper function, whose internal
-- queries run as the function owner (the table owner) and therefore bypass
-- RLS entirely, breaking the cycle.

create or replace function public.can_manage_studio(p_studio_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = p_user_id)
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = p_studio_id and m.profile_id = p_user_id and m.role = 'admin' and m.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin');
$$;

drop policy if exists studios_update_owner_or_admin on public.studios;
create policy studios_update_owner_or_admin
  on public.studios for update
  using (public.can_manage_studio(id, auth.uid()))
  with check (public.can_manage_studio(id, auth.uid()));

drop policy if exists studio_members_write on public.studio_members;
create policy studio_members_write
  on public.studio_members for all
  using (public.can_manage_studio(studio_id, auth.uid()))
  with check (public.can_manage_studio(studio_id, auth.uid()));

drop policy if exists community_events_write on public.community_events;
create policy community_events_write
  on public.community_events for all
  using (
    owner_profile_id = auth.uid()
    or (studio_id is not null and public.can_manage_studio(studio_id, auth.uid()))
  )
  with check (
    owner_profile_id = auth.uid()
    or (studio_id is not null and public.can_manage_studio(studio_id, auth.uid()))
  );

drop policy if exists community_projects_write on public.community_projects;
create policy community_projects_write
  on public.community_projects for all
  using (
    owner_profile_id = auth.uid()
    or (studio_id is not null and public.can_manage_studio(studio_id, auth.uid()))
  )
  with check (
    owner_profile_id = auth.uid()
    or (studio_id is not null and public.can_manage_studio(studio_id, auth.uid()))
  );
