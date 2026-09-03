-- Trusted-map RLS helpers are internal to authenticated access and server-side service operations.
-- Supabase may grant newly-created public-schema routines to anon by default, so revoke it explicitly.

create or replace function public.trusted_map_is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (auth.role() = 'service_role' or p_user_id = auth.uid())
    and exists (
      select 1
      from public.trusted_map_groups g
      left join public.trusted_map_group_members m
        on m.group_id = g.id and m.user_id = p_user_id and m.status = 'accepted'
      where g.id = p_group_id and (g.owner_user_id = p_user_id or m.user_id is not null)
    );
$$;

create or replace function public.trusted_map_has_audience(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (auth.role() = 'service_role' or p_user_id = auth.uid())
    and (
      exists (
        select 1 from public.trusted_map_connections c
        where c.status = 'accepted' and (c.requester_user_id = p_user_id or c.recipient_user_id = p_user_id)
      )
      or exists (
        select 1
        from public.trusted_map_group_members me
        join public.trusted_map_group_members other
          on other.group_id = me.group_id and other.user_id <> p_user_id and other.status = 'accepted'
        where me.user_id = p_user_id and me.status = 'accepted'
      )
      or exists (
        select 1 from public.trusted_map_groups g
        join public.trusted_map_group_members other on other.group_id = g.id and other.status = 'accepted'
        where g.owner_user_id = p_user_id
      )
    );
$$;

revoke all on function public.trusted_map_is_group_member(uuid, uuid) from public;
revoke all on function public.trusted_map_is_group_member(uuid, uuid) from anon;
revoke all on function public.trusted_map_can_view_user(uuid) from public;
revoke all on function public.trusted_map_can_view_user(uuid) from anon;
revoke all on function public.trusted_map_has_audience(uuid) from public;
revoke all on function public.trusted_map_has_audience(uuid) from anon;

grant execute on function public.trusted_map_is_group_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.trusted_map_can_view_user(uuid) to authenticated, service_role;
grant execute on function public.trusted_map_has_audience(uuid) to authenticated, service_role;
