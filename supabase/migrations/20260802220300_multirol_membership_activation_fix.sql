-- Corrected final definition for membership activation. Kept separate so the
-- transactional contract is easy to review and regression-test.
create or replace function public.activate_studio_membership(
  p_user_id uuid,
  p_studio_id uuid,
  p_plan_id uuid,
  p_source text default 'direct',
  p_subscription_id uuid default null,
  p_force_active boolean default false,
  p_return_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.studio_membership_plans%rowtype;
  v_existing public.studio_memberships%rowtype;
  v_existing_is_free boolean;
  v_membership public.studio_memberships%rowtype;
  v_player_id uuid;
  v_status text;
begin
  if p_user_id is null then raise exception 'Falta el usuario'; end if;

  select * into v_plan
  from public.studio_membership_plans
  where id = p_plan_id
    and studio_id = p_studio_id
    and is_active = true;
  if not found then raise exception 'El plan no está disponible'; end if;

  if v_plan.join_policy = 'invitation_only' and not p_force_active then
    raise exception 'Este plan requiere una invitación';
  end if;

  select sm, mp.is_free
  into v_existing, v_existing_is_free
  from public.studio_memberships sm
  left join public.studio_membership_plans mp on mp.id = sm.plan_id
  where sm.studio_id = p_studio_id and sm.user_id = p_user_id
  limit 1;

  if v_existing.id is not null
     and v_existing.status = 'active'
     and coalesce(v_existing_is_free, true) = false
     and v_plan.is_free = true
     and not p_force_active then
    return jsonb_build_object(
      'membershipId', v_existing.id,
      'status', v_existing.status,
      'playerId', v_existing.player_id,
      'needsPlayer', v_existing.player_id is null,
      'publicRole', coalesce(v_existing.public_role_label, 'Miembro'),
      'area', v_existing.area_label,
      'reused', true
    );
  end if;

  v_status := case
    when p_force_active then 'active'
    when v_plan.requires_approval or v_plan.join_policy = 'approval' then 'pending'
    else 'active'
  end;

  select id into v_player_id
  from public.players
  where owner_user_id = p_user_id
  order by created_at
  limit 1;

  insert into public.studio_memberships (
    studio_id, user_id, player_id, plan_id, status, source, subscription_id,
    public_role_key, public_role_label, area_key, area_label,
    approved_by, approved_at, joined_at, updated_at
  ) values (
    p_studio_id, p_user_id, v_player_id, v_plan.id, v_status,
    coalesce(nullif(p_source, ''), 'direct'), p_subscription_id,
    v_plan.public_role_key, v_plan.public_role_label, v_plan.area_key, v_plan.area_label,
    case when p_force_active then p_user_id else null end,
    case when p_force_active then now() else null end,
    now(), now()
  )
  on conflict (studio_id, user_id) do update
  set player_id = coalesce(excluded.player_id, public.studio_memberships.player_id),
      plan_id = excluded.plan_id,
      status = excluded.status,
      source = excluded.source,
      subscription_id = coalesce(excluded.subscription_id, public.studio_memberships.subscription_id),
      public_role_key = excluded.public_role_key,
      public_role_label = excluded.public_role_label,
      area_key = excluded.area_key,
      area_label = excluded.area_label,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      joined_at = case
        when public.studio_memberships.status <> 'active' and excluded.status = 'active' then now()
        else public.studio_memberships.joined_at
      end,
      updated_at = now()
  returning * into v_membership;

  if v_status = 'active' and v_player_id is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label, source_membership_id,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      v_player_id, p_studio_id, v_plan.public_role_label, v_plan.area_key, v_plan.area_label,
      v_membership.id, false, true, 'active', now(), null
    )
    on conflict (player_id, studio_id) do update
    set role = excluded.role,
        area_key = excluded.area_key,
        area_label = excluded.area_label,
        source_membership_id = excluded.source_membership_id,
        is_visible = true,
        status = 'active',
        left_at = null,
        updated_at = now();

    delete from public.pending_studio_joins
    where user_id = p_user_id and studio_id = p_studio_id;
  elsif v_status = 'active' then
    insert into public.pending_studio_joins (
      user_id, studio_id, plan_id, membership_id, return_path, status
    ) values (
      p_user_id, p_studio_id, v_plan.id, v_membership.id, p_return_path, 'pending'
    )
    on conflict (user_id, studio_id) do update
    set plan_id = excluded.plan_id,
        membership_id = excluded.membership_id,
        return_path = coalesce(excluded.return_path, public.pending_studio_joins.return_path),
        status = 'pending',
        completed_at = null;
  end if;

  return jsonb_build_object(
    'membershipId', v_membership.id,
    'status', v_status,
    'playerId', v_player_id,
    'needsPlayer', v_player_id is null,
    'publicRole', v_plan.public_role_label,
    'area', v_plan.area_label,
    'reused', v_existing.id is not null
  );
end;
$$;

revoke all on function public.activate_studio_membership(uuid, uuid, uuid, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.activate_studio_membership(uuid, uuid, uuid, text, uuid, boolean, text) to service_role;
