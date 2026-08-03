-- Studio OS permission boundary and transactional Studio creation.

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

revoke all on function public.create_studio_os_draft(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_studio_os_draft(uuid, text, text, text, text) to service_role;
