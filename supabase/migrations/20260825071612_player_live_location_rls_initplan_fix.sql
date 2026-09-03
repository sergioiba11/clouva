drop policy if exists player_live_locations_select_live_or_owner on public.player_live_locations;
drop policy if exists player_live_locations_insert_owner on public.player_live_locations;
drop policy if exists player_live_locations_update_owner on public.player_live_locations;

create policy player_live_locations_select_live_or_owner
  on public.player_live_locations
  for select
  using (
    (
      is_enabled = true
      and updated_at > now() - interval '2 minutes'
    )
    or exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid()) and pr.role = 'admin'
    )
  );

create policy player_live_locations_insert_owner
  on public.player_live_locations
  for insert
  with check (
    exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid()) and pr.role = 'admin'
    )
  );

create policy player_live_locations_update_owner
  on public.player_live_locations
  for update
  using (
    exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid()) and pr.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.players p
      where p.id = player_live_locations.player_id
        and p.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.profiles pr
      where pr.id = (select auth.uid()) and pr.role = 'admin'
    )
  );
