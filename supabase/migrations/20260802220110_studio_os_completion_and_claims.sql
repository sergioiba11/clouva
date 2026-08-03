-- Complete pending joins after Player creation, activate Studio OS after payment,
-- and claim private management invitations without personal VIP.

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

revoke all on function public.complete_pending_studio_joins(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_studio_os(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_pending_studio_joins(uuid, uuid) to service_role;
grant execute on function public.activate_studio_os(uuid, uuid, timestamptz) to service_role;
revoke all on function public.claim_studio_access(text) from public, anon;
grant execute on function public.claim_studio_access(text) to authenticated, service_role;
