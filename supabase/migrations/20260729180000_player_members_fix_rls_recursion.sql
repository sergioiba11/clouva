-- The player_members SELECT policy referenced player_members from inside its
-- own USING clause (self-join to check "is this caller an owner/manager of
-- the same player") -- Postgres detects that as infinite recursion (42P17),
-- confirmed live via a real REST call that 500'd. Same class of bug this repo
-- already hit and fixed once for studio_members (see can_manage_studio) --
-- same fix: wrap the self-referential check in a SECURITY DEFINER function,
-- which breaks the same-statement recursion.

create function public.is_active_player_manager(p_player_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_user_id = auth.uid()
    and exists (
      select 1 from public.player_members m
      where m.player_id = p_player_id and m.user_id = p_user_id and m.status = 'active' and m.role in ('owner', 'manager')
    );
$$;

revoke execute on function public.is_active_player_manager(uuid, uuid) from public;
grant execute on function public.is_active_player_manager(uuid, uuid) to authenticated;

drop policy if exists player_members_select_self_or_player_admin_or_admin on public.player_members;

create policy player_members_select_self_or_player_admin_or_admin
  on public.player_members for select
  using (
    user_id = auth.uid()
    or public.is_active_player_manager(player_id, auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
