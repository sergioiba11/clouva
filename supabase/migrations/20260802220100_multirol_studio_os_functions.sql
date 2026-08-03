-- CLOUVA multirol + Studio OS: canonical permission and transaction functions.

create or replace function public.is_studio_os_active(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.studios s
    where s.id = p_studio_id
      and s.studio_os_status in ('active', 'grace', 'legacy_active')
      and (s.studio_os_expires_at is null or s.studio_os_expires_at > now())
  );
$$;

create or replace function public.can_manage_studio(p_studio_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and public.is_studio_os_active(p_studio_id)
    and (
      exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = auth.uid())
      or exists (
        select 1 from public.studio_members sm
        where sm.studio_id = p_studio_id
          and sm.profile_id = auth.uid()
          and sm.status = 'active'
          and sm.role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
      )
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    );
$$;

create or replace function public.can_manage_studio(p_studio_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and p_user_id = auth.uid()
    and public.is_studio_os_active(p_studio_id)
    and (
      exists (select 1 from public.studios s where s.id = p_studio_id and s.owner_id = p_user_id)
      or exists (
        select 1 from public.studio_members sm
        where sm.studio_id = p_studio_id
          and sm.profile_id = p_user_id
          and sm.status = 'active'
          and sm.role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
      )
      or exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin')
    );
$$;

create or replace function public.create_studio_os_draft(
  p_user_id uuid,
  p_name text,
  p_slug text,
  p_city text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_studio public.studios%rowtype;
  v_player_id uuid;
begin
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'La cuenta no tiene un perfil CLOUVA válido';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'El nombre del Estudio es obligatorio';
  end if;

  v_base_slug := lower(regexp_replace(coalesce(nullif(btrim(p_slug), ''), btrim(p_name)), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug = '' then v_base_slug := 'estudio'; end if;
  v_slug := v_base_slug;
  while exists (select 1 from public.studios where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix::text;
  end loop;

  insert into public.studios (
    owner_id, name, slug, city, description,
    is_published, publication_status, studio_os_status
  ) values (
    p_user_id, btrim(p_name), v_slug, nullif(btrim(p_city), ''), nullif(btrim(p_description), ''),
    false, 'draft', 'pending'
  ) returning * into v_studio;

  insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
  values (v_studio.id, p_user_id, 'owner', 'active', now())
  on conflict (studio_id, profile_id) do update
  set role = 'owner', status = 'active', joined_at = coalesce(public.studio_members.joined_at, now());

  select id into v_player_id
  from public.players
  where owner_user_id = p_user_id
  order by created_at
  limit 1;

  if v_player_id is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label,
      is_primary, is_visible, status, joined_at
    ) values (
      v_player_id, v_studio.id, 'Fundador', 'direction', 'Dirección',
      false, false, 'pending', now()
    )
    on conflict (player_id, studio_id) do update
    set role = 'Fundador', area_key = 'direction', area_label = 'Dirección',
        status = 'pending', is_visible = false, left_at = null, updated_at = now();
  end if;

  insert into public.studio_membership_plans (
    studio_id, name, slug, description, is_free, price, billing_interval,
    benefits, display_order, public_role_key, public_role_label,
    area_key, area_label, join_policy, requires_approval, display_badge, created_by
  ) values (
    v_studio.id, 'Artista', 'artista', 'Sumate gratis como Artista del Estudio.',
    true, null, null,
    '["Aparecer como Artista del Estudio","Recibir novedades y oportunidades"]'::jsonb,
    0, 'artist', 'Artista', 'artistic', 'Artística', 'automatic', false, 'ARTISTA', p_user_id
  );

  insert into public.profile_modes (user_id, mode, status)
  values (p_user_id, 'studio_owner', 'active')
  on conflict (user_id, mode) do update
  set status = 'active', activated_at = now(), updated_at = now();

  return jsonb_build_object(
    'id', v_studio.id,
    'slug', v_studio.slug,
    'name', v_studio.name,
    'studioOsStatus', v_studio.studio_os_status
  );
end;
$$;

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

  select sm.*, mp.is_free
  into v_existing, v_existing_is_free
  from public.studio_memberships sm
  left join public.studio_membership_plans mp on mp.id = sm.plan_id
  where sm.studio_id = p_studio_id and sm.user_id = p_user_id
  limit 1;

  -- Clicking the free CTA again must never downgrade an active paid role.
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
      v_player_id, p_studio_id, v_plan.public_role_label, v_plan.area_key, v_plan.area_label, v_membership.id,
      false, true, 'active', now(), null
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

create or replace function public.complete_pending_studio_joins(p_user_id uuid, p_player_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.studio_memberships%rowtype;
  v_count integer := 0;
begin
  if not exists (select 1 from public.players where id = p_player_id and owner_user_id = p_user_id) then
    raise exception 'El Player no pertenece a la cuenta';
  end if;

  for v_membership in
    select * from public.studio_memberships
    where user_id = p_user_id and status = 'active'
  loop
    update public.studio_memberships
    set player_id = p_player_id, updated_at = now()
    where id = v_membership.id;

    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label, source_membership_id,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      p_player_id, v_membership.studio_id, coalesce(v_membership.public_role_label, 'Miembro'),
      v_membership.area_key, v_membership.area_label, v_membership.id,
      false, true, 'active', coalesce(v_membership.joined_at, now()), null
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

    update public.pending_studio_joins
    set status = 'completed', completed_at = now()
    where user_id = p_user_id and studio_id = v_membership.studio_id and status = 'pending';
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.activate_studio_os(
  p_studio_id uuid,
  p_subscription_id uuid,
  p_period_end timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.studios
  set studio_os_status = 'active',
      studio_os_subscription_id = p_subscription_id,
      studio_os_activated_at = coalesce(studio_os_activated_at, now()),
      studio_os_expires_at = p_period_end,
      is_published = true,
      publication_status = 'published',
      updated_at = now()
  where id = p_studio_id;

  if not found then raise exception 'El Estudio no existe'; end if;

  update public.player_studios
  set status = 'active', is_visible = true, updated_at = now()
  where studio_id = p_studio_id and role = 'Fundador';
end;
$$;

-- Claiming an invitation grants an internal Studio permission only. It does not
-- grant a global VIP entitlement or invent a public Player role.
create or replace function public.claim_studio_access(p_token_hash text)
returns table(studio_id uuid, studio_slug text, studio_name text, claimed_role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_claim public.studio_access_claims%rowtype;
  v_studio public.studios%rowtype;
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;

  select lower(email) into v_email from auth.users where id = v_user_id;
  select * into v_claim
  from public.studio_access_claims
  where token_hash = p_token_hash
    and status = 'pending'
    and expires_at > now()
  for update;
  if not found then raise exception 'La invitación venció, fue cancelada o ya fue utilizada'; end if;

  if v_claim.invited_user_id is not null and v_claim.invited_user_id <> v_user_id then
    raise exception 'Esta invitación pertenece a otro usuario';
  end if;
  if v_claim.invited_email is not null and lower(v_claim.invited_email) <> v_email then
    raise exception 'Ingresá con el correo autorizado para reclamar esta invitación';
  end if;

  select * into v_studio from public.studios where id = v_claim.studio_id for update;
  if not found then raise exception 'El Estudio ya no existe'; end if;

  insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
  values (v_claim.studio_id, v_user_id, v_claim.role, 'active', now())
  on conflict (studio_id, profile_id) do update
  set role = excluded.role,
      status = 'active',
      joined_at = coalesce(public.studio_members.joined_at, now());

  insert into public.profile_modes (user_id, mode, status)
  values (v_user_id, 'studio_manager', 'active')
  on conflict (user_id, mode) do update
  set status = 'active', activated_at = now(), updated_at = now();

  update public.studio_access_claims
  set status = 'claimed',
      invited_user_id = v_user_id,
      requires_vip = false,
      claimed_at = now(),
      updated_at = now()
  where id = v_claim.id;

  insert into public.admin_audit_log (
    admin_user_id, action, entity_type, entity_id, reason, metadata
  ) values (
    v_user_id,
    'studio.access.claimed',
    'studio',
    v_claim.studio_id,
    'Invitación de administración reclamada',
    jsonb_build_object('claim_id', v_claim.id, 'role', v_claim.role)
  );

  return query select v_studio.id, v_studio.slug, v_studio.name, v_claim.role;
end;
$$;

-- Sensitive mutations are server-only. The invitation claim remains available
-- to authenticated users because it validates auth.uid(), token, email and lock.
revoke all on function public.create_studio_os_draft(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.activate_studio_membership(uuid, uuid, uuid, text, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.complete_pending_studio_joins(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_studio_os(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_studio_os_draft(uuid, text, text, text, text) to service_role;
grant execute on function public.activate_studio_membership(uuid, uuid, uuid, text, uuid, boolean, text) to service_role;
grant execute on function public.complete_pending_studio_joins(uuid, uuid) to service_role;
grant execute on function public.activate_studio_os(uuid, uuid, timestamptz) to service_role;
revoke all on function public.claim_studio_access(text) from public, anon;
grant execute on function public.claim_studio_access(text) to authenticated, service_role;
