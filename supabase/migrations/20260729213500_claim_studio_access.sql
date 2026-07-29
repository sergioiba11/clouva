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
  v_player_id uuid;
  v_vip_active boolean := false;
begin
  if v_user_id is null then
    raise exception 'Sesión requerida';
  end if;

  select lower(email) into v_email
  from auth.users
  where id = v_user_id;

  select * into v_claim
  from public.studio_access_claims
  where token_hash = p_token_hash
    and status = 'pending'
    and expires_at > now()
  for update;

  if not found then
    raise exception 'La invitación venció, fue cancelada o ya fue utilizada';
  end if;

  if v_claim.invited_user_id is not null and v_claim.invited_user_id <> v_user_id then
    raise exception 'Esta invitación pertenece a otro usuario';
  end if;

  if v_claim.invited_email is not null and lower(v_claim.invited_email) <> v_email then
    raise exception 'Ingresá con el correo autorizado para reclamar esta invitación';
  end if;

  if v_claim.requires_vip then
    select exists (
      select 1
      from public.user_entitlements ue
      where ue.user_id = v_user_id
        and ue.tier = 'vip'
        and ue.status = 'active'
        and coalesce(ue.valid_from, ue.starts_at) <= now()
        and (
          coalesce(ue.valid_until, ue.expires_at) is null
          or coalesce(ue.valid_until, ue.expires_at) > now()
        )
    ) into v_vip_active;

    if not v_vip_active then
      raise exception 'Necesitás CLOUVA VIP activo para reclamar la administración';
    end if;
  end if;

  select * into v_studio
  from public.studios
  where id = v_claim.studio_id
  for update;

  if not found then
    raise exception 'El Estudio ya no existe';
  end if;

  insert into public.studio_members (
    studio_id, profile_id, role, status, joined_at
  ) values (
    v_claim.studio_id, v_user_id, v_claim.role, 'active', now()
  )
  on conflict (studio_id, profile_id)
  do update set
    role = excluded.role,
    status = 'active',
    joined_at = coalesce(public.studio_members.joined_at, now());

  select p.id into v_player_id
  from public.players p
  where p.owner_user_id = v_user_id
  order by p.created_at
  limit 1;

  if v_player_id is null then
    select pm.player_id into v_player_id
    from public.player_members pm
    where pm.user_id = v_user_id
      and pm.status = 'active'
      and pm.role in ('owner', 'manager', 'editor')
    order by pm.created_at
    limit 1;
  end if;

  if v_player_id is not null then
    insert into public.player_studios (
      player_id, studio_id, role, is_primary, is_visible,
      display_order, approved_by, approved_at
    ) values (
      v_player_id,
      v_claim.studio_id,
      case when v_claim.role = 'owner' then 'Fundador' else 'Miembro' end,
      false,
      true,
      999,
      v_user_id,
      now()
    )
    on conflict (player_id, studio_id)
    do update set
      is_visible = true,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at;
  end if;

  update public.studio_access_claims
  set status = 'claimed',
      invited_user_id = v_user_id,
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

revoke all on function public.claim_studio_access(text) from public;
grant execute on function public.claim_studio_access(text) to authenticated;
