create or replace function public.claim_existing_instagram_player(
  p_user_id uuid,
  p_player_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_player public.players%rowtype;
  current_player public.players%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta operación requiere el service role'
      using errcode = '42501';
  end if;

  select *
  into target_player
  from public.players
  where id = p_player_id
  for update;

  if not found then
    raise exception 'No encontramos el Player existente.'
      using errcode = 'P0002';
  end if;

  if target_player.owner_user_id is not null
     and target_player.owner_user_id <> p_user_id then
    raise exception 'Ese Player ya pertenece a otra cuenta.'
      using errcode = '23505';
  end if;

  if target_player.owner_user_id is null
     and target_player.claim_status <> 'unclaimed' then
    raise exception 'Ese Player no está disponible para ser asociado.'
      using errcode = '23514';
  end if;

  select *
  into current_player
  from public.players
  where owner_user_id = p_user_id
    and id <> p_player_id
  for update;

  if found then
    if current_player.is_published
       or current_player.publication_status <> 'draft'
       or current_player.username is not null then
      raise exception 'La cuenta ya tiene otro Player con identidad propia; no se puede reemplazar automáticamente.'
        using errcode = '23514';
    end if;

    if exists (
      select 1 from public.player_members pm
      where pm.player_id = current_player.id
        and not (
          pm.user_id = p_user_id
          and pm.role = 'owner'
          and pm.status = 'active'
        )
    )
    or exists (select 1 from public.player_media where player_id = current_player.id)
    or exists (select 1 from public.player_studios where player_id = current_player.id)
    or exists (select 1 from public.player_invitations where player_id = current_player.id)
    or exists (select 1 from public.player_profile_versions where player_id = current_player.id)
    or exists (select 1 from public.vip_profile_generation_jobs where player_id = current_player.id)
    or exists (select 1 from public.commerce_products where player_id = current_player.id)
    or exists (select 1 from public.commerce_orders where seller_player_id = current_player.id)
    or exists (select 1 from public.studio_applications where player_id = current_player.id) then
      raise exception 'El Player actual contiene información vinculada y no se puede reemplazar automáticamente.'
        using errcode = '23514';
    end if;

    update public.players
    set professional_categories = case
          when coalesce(cardinality(target_player.professional_categories), 0) = 0
            then current_player.professional_categories
          else target_player.professional_categories
        end,
        disciplines = case
          when coalesce(cardinality(target_player.disciplines), 0) = 0
            then current_player.disciplines
          else target_player.disciplines
        end,
        primary_role = coalesce(target_player.primary_role, current_player.primary_role),
        updated_at = now()
    where id = target_player.id;

    delete from public.public_slug_aliases
    where entity_type = 'player'
      and entity_id = current_player.id;

    delete from public.players
    where id = current_player.id;
  end if;

  update public.players
  set owner_user_id = p_user_id,
      claim_status = 'claimed',
      claimed_at = coalesce(claimed_at, now()),
      updated_at = now()
  where id = target_player.id;

  insert into public.player_members (
    player_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    target_player.id,
    p_user_id,
    'owner',
    'active',
    now()
  )
  on conflict (player_id, user_id) do update
  set role = 'owner',
      status = 'active',
      joined_at = coalesce(public.player_members.joined_at, excluded.joined_at),
      updated_at = now();

  return target_player.id;
end;
$$;

revoke all on function public.claim_existing_instagram_player(uuid, uuid) from public;
revoke all on function public.claim_existing_instagram_player(uuid, uuid) from anon;
revoke all on function public.claim_existing_instagram_player(uuid, uuid) from authenticated;
grant execute on function public.claim_existing_instagram_player(uuid, uuid) to service_role;

comment on function public.claim_existing_instagram_player(uuid, uuid) is
'Atomically replaces an empty onboarding draft with an existing unclaimed Player verified through Instagram OAuth, preserving the canonical Player id, slug and username.';
