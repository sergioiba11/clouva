begin;

create or replace function private.sync_space_member_from_studio_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_player_id uuid;
  v_user_id uuid;
  v_role text;
  v_status text;
begin
  v_user_id := case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
  select sp.id into v_space_id
  from public.spaces sp
  where sp.legacy_studio_id = (case when tg_op = 'DELETE' then old.studio_id else new.studio_id end)
  limit 1;
  if v_space_id is null then return coalesce(new, old); end if;

  select p.id into v_player_id from public.players p where p.owner_user_id=v_user_id limit 1;
  if v_player_id is null and tg_op <> 'DELETE' then
    v_player_id := private.ensure_player_for_user(v_user_id);
  end if;
  if v_player_id is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    update public.space_members
    set status='disabled', updated_at=now()
    where space_id=v_space_id and player_id=v_player_id and role <> 'owner';
    return old;
  end if;

  v_role := case new.role
    when 'owner' then 'owner'
    when 'admin' then 'admin'
    when 'manager' then 'manager'
    when 'editor' then 'catalog'
    when 'finance' then 'finance'
    when 'bookings' then 'sales'
    when 'support' then 'support'
    else 'viewer'
  end;
  v_status := case when new.status='active' then 'active' else 'disabled' end;

  insert into public.space_members(space_id,player_id,role,status)
  values(v_space_id,v_player_id,v_role,v_status)
  on conflict(space_id,player_id) do update set
    role=case when public.space_members.role='owner' then 'owner' else excluded.role end,
    status=case when public.space_members.role='owner' then 'active' else excluded.status end,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists spaces_sync_studio_member on public.studio_members;
create trigger spaces_sync_studio_member
after insert or update of profile_id,role,status or delete
on public.studio_members
for each row execute function private.sync_space_member_from_studio_member();

create or replace function private.sync_space_member_from_commerce_spot_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_player_id uuid;
  v_user_id uuid;
  v_status text;
begin
  v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  select sp.id into v_space_id
  from public.spaces sp
  where sp.legacy_commerce_spot_id = (case when tg_op = 'DELETE' then old.spot_id else new.spot_id end)
  limit 1;
  if v_space_id is null then return coalesce(new, old); end if;

  select p.id into v_player_id from public.players p where p.owner_user_id=v_user_id limit 1;
  if v_player_id is null and tg_op <> 'DELETE' then
    v_player_id := private.ensure_player_for_user(v_user_id);
  end if;
  if v_player_id is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    update public.space_members
    set status='disabled', updated_at=now()
    where space_id=v_space_id and player_id=v_player_id and role <> 'owner';
    return old;
  end if;

  v_status := case new.status when 'active' then 'active' when 'invited' then 'invited' else 'disabled' end;
  insert into public.space_members(space_id,player_id,role,status)
  values(v_space_id,v_player_id,new.role,v_status)
  on conflict(space_id,player_id) do update set
    role=case when public.space_members.role='owner' then 'owner' else excluded.role end,
    status=case when public.space_members.role='owner' then 'active' else excluded.status end,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists spaces_sync_commerce_spot_member on public.commerce_spot_members;
create trigger spaces_sync_commerce_spot_member
after insert or update of user_id,role,status or delete
on public.commerce_spot_members
for each row execute function private.sync_space_member_from_commerce_spot_member();

drop policy if exists commerce_products_write_owner_or_admin on public.commerce_products;
create policy commerce_products_write_owner_or_admin on public.commerce_products
for all to authenticated
using (
  exists(select 1 from public.profiles gp where gp.id=(select auth.uid()) and gp.role::text='admin')
  or (public.can_administer_spaces() and owner_type='user' and owner_user_id=(select auth.uid()))
  or (
    public.can_administer_spaces()
    and owner_type='player'
    and player_id is not null
    and (
      exists(select 1 from public.players p where p.id=commerce_products.player_id and p.owner_user_id=(select auth.uid()))
      or exists(
        select 1 from public.player_members pm
        where pm.player_id=commerce_products.player_id
          and pm.user_id=(select auth.uid())
          and pm.status='active'
          and pm.role in ('owner','manager','editor')
      )
    )
  )
  or (
    owner_type='studio'
    and studio_id is not null
    and public.can_manage_studio(studio_id,(select auth.uid()))
    and (
      exists(select 1 from public.studios s where s.id=commerce_products.studio_id and s.owner_id=(select auth.uid()))
      or exists(
        select 1 from public.studio_members sm
        where sm.studio_id=commerce_products.studio_id
          and sm.profile_id=(select auth.uid())
          and sm.status='active'
          and sm.role in ('owner','admin','manager','editor')
      )
    )
  )
  or (spot_id is not null and public.commerce_spot_can(spot_id,(select auth.uid()),'catalog'))
)
with check (
  exists(select 1 from public.profiles gp where gp.id=(select auth.uid()) and gp.role::text='admin')
  or (public.can_administer_spaces() and owner_type='user' and owner_user_id=(select auth.uid()))
  or (
    public.can_administer_spaces()
    and owner_type='player'
    and player_id is not null
    and (
      exists(select 1 from public.players p where p.id=commerce_products.player_id and p.owner_user_id=(select auth.uid()))
      or exists(
        select 1 from public.player_members pm
        where pm.player_id=commerce_products.player_id
          and pm.user_id=(select auth.uid())
          and pm.status='active'
          and pm.role in ('owner','manager','editor')
      )
    )
  )
  or (
    owner_type='studio'
    and studio_id is not null
    and public.can_manage_studio(studio_id,(select auth.uid()))
    and (
      exists(select 1 from public.studios s where s.id=commerce_products.studio_id and s.owner_id=(select auth.uid()))
      or exists(
        select 1 from public.studio_members sm
        where sm.studio_id=commerce_products.studio_id
          and sm.profile_id=(select auth.uid())
          and sm.status='active'
          and sm.role in ('owner','admin','manager','editor')
      )
    )
  )
  or (spot_id is not null and public.commerce_spot_can(spot_id,(select auth.uid()),'catalog'))
);

commit;
