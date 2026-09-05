begin;

-- A shop/business hosted inside another Space keeps its own ownership and data,
-- but operational roles from the host may manage it. This is inheritance of
-- capability, not ownership: owner/admin/manager of the host becomes manager
-- of the hosted child.
create or replace function private.space_role_for_user(p_space_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if p_space_id is null or p_user_id is null then return null; end if;
  if private.user_is_global_admin(p_user_id) then return 'admin'; end if;

  -- Direct membership always wins.
  select sm.role into v_role
  from public.space_members sm
  where sm.space_id=p_space_id and sm.status='active'
    and private.user_controls_player(p_user_id,sm.player_id)
  order by case sm.role
    when 'owner' then 1 when 'admin' then 2 when 'manager' then 3
    when 'finance' then 4 when 'sales' then 5 when 'catalog' then 6
    when 'inventory' then 7 when 'content' then 8 when 'support' then 9 else 10 end
  limit 1;
  if v_role is not null then return v_role; end if;

  -- Child `hosted_at` parent, or parent `contains` child.
  select case
    when sm.role in ('owner','admin','manager') then 'manager'
    when sm.role in ('finance','sales','catalog','inventory','content','support','viewer') then sm.role
    else null
  end
  into v_role
  from public.space_relationships rel
  join public.space_members sm
    on sm.status='active'
   and (
     (rel.relationship_type='hosted_at' and rel.source_space_id=p_space_id and sm.space_id=rel.target_space_id)
     or
     (rel.relationship_type='contains' and rel.target_space_id=p_space_id and sm.space_id=rel.source_space_id)
   )
  where rel.status='active'
    and rel.relationship_type in ('hosted_at','contains')
    and private.user_controls_player(p_user_id,sm.player_id)
  order by case sm.role
    when 'owner' then 1 when 'admin' then 2 when 'manager' then 3
    when 'finance' then 4 when 'sales' then 5 when 'catalog' then 6
    when 'inventory' then 7 when 'content' then 8 when 'support' then 9 else 10 end
  limit 1;

  return v_role;
end;
$$;

-- Inventory movements remain attributable to a real Player. If the actor is
-- managing a hosted child through the host Space, attribute the action to the
-- Player membership they control in that host.
create or replace function private.space_player_for_user(p_space_id uuid, p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with direct_membership as (
    select sm.player_id, 0 as inherited, case sm.role
      when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end as priority
    from public.space_members sm
    where sm.space_id = p_space_id
      and sm.status = 'active'
      and private.user_controls_player(p_user_id, sm.player_id)
  ), inherited_membership as (
    select sm.player_id, 1 as inherited, case sm.role
      when 'owner' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end as priority
    from public.space_relationships rel
    join public.space_members sm
      on sm.status='active'
     and (
       (rel.relationship_type='hosted_at' and rel.source_space_id=p_space_id and sm.space_id=rel.target_space_id)
       or
       (rel.relationship_type='contains' and rel.target_space_id=p_space_id and sm.space_id=rel.source_space_id)
     )
    where rel.status='active'
      and rel.relationship_type in ('hosted_at','contains')
      and private.user_controls_player(p_user_id, sm.player_id)
      and sm.role in ('owner','admin','manager','inventory','sales','catalog','finance','content','support')
  )
  select player_id
  from (
    select * from direct_membership
    union all
    select * from inherited_membership
  ) candidates
  order by inherited, priority
  limit 1;
$$;

-- The mature Commerce Manager resolves permissions through this function.
-- Add the same Space relationship fallback so hosted stores reuse the exact
-- Studio commerce engine instead of creating another manager or duplicating
-- memberships just to grant operational access.
create or replace function public.commerce_spot_role_for_user(p_spot_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_role text;
  v_space_id uuid;
begin
  if p_spot_id is null or p_user_id is null then return null; end if;

  if exists (
    select 1 from public.profiles profile
    where profile.id = p_user_id and profile.role::text = 'admin'
  ) then
    return 'admin';
  end if;

  select * into v_spot from public.commerce_spots where id = p_spot_id;
  if not found then return null; end if;

  if v_spot.owner_type = 'user' and v_spot.owner_user_id = p_user_id then
    return 'owner';
  end if;

  select member.role into v_role
  from public.commerce_spot_members member
  where member.spot_id = p_spot_id
    and member.user_id = p_user_id
    and member.status = 'active'
  limit 1;
  if v_role is not null then return v_role; end if;

  if v_spot.owner_type = 'studio' and v_spot.studio_id is not null then
    if exists (
      select 1 from public.studios studio
      where studio.id = v_spot.studio_id and studio.owner_id = p_user_id
    ) then
      return 'owner';
    end if;

    select case member.role
      when 'owner' then 'owner'
      when 'admin' then 'admin'
      when 'manager' then 'manager'
      when 'editor' then 'catalog'
      when 'finance' then 'finance'
      when 'bookings' then 'sales'
      when 'support' then 'support'
      else 'viewer'
    end
    into v_role
    from public.studio_members member
    where member.studio_id = v_spot.studio_id
      and member.profile_id = p_user_id
      and member.status = 'active'
    limit 1;
    if v_role is not null then return v_role; end if;
  end if;

  select space.id into v_space_id
  from public.spaces space
  where space.legacy_commerce_spot_id = p_spot_id
  limit 1;

  if v_space_id is not null then
    v_role := private.space_role_for_user(v_space_id, p_user_id);
    if v_role is not null then return v_role; end if;
  end if;

  return null;
end;
$$;

commit;
