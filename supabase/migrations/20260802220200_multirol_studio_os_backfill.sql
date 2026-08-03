-- CLOUVA multirol + Studio OS: deterministic data backfill.

-- Existing identities and managers receive modes without changing their public
-- professional categories or global authorization role.
insert into public.profile_modes (user_id, mode, status)
select owner_user_id, 'player', 'active'
from public.players
where owner_user_id is not null
on conflict (user_id, mode) do nothing;

insert into public.profile_modes (user_id, mode, status)
select owner_id, 'studio_owner', 'active'
from public.studios
on conflict (user_id, mode) do nothing;

insert into public.profile_modes (user_id, mode, status)
select distinct profile_id, 'studio_manager', 'active'
from public.studio_members
where status = 'active'
  and role in ('owner', 'admin', 'manager', 'editor', 'finance', 'bookings', 'support')
on conflict (user_id, mode) do nothing;

-- The owner is always explicit in the private permission roster.
insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
select id, owner_id, 'owner', 'active', coalesce(created_at, now())
from public.studios
on conflict (studio_id, profile_id) do update
set role = 'owner', status = 'active';

-- Existing default free plans become Artista. Paid plans receive their own
-- public label instead of inheriting the free default.
update public.studio_membership_plans
set name = case when is_free and name = 'Miembro' then 'Artista' else name end,
    description = case
      when is_free and (description is null or description ilike '%comunidad%')
        then 'Sumate gratis como Artista del Estudio.'
      else description
    end,
    public_role_key = case when is_free then 'artist' else lower(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g')) end,
    public_role_label = case when is_free then 'Artista' else name end,
    area_key = case when is_free then 'artistic' else 'creative' end,
    area_label = case when is_free then 'Artística' else 'Creativa' end,
    join_policy = case when is_free then 'automatic' else join_policy end,
    requires_approval = case when is_free then false else requires_approval end,
    display_badge = coalesce(display_badge, upper(case when is_free then 'ARTISTA' else name end)),
    updated_at = now();

-- Snapshot the plan role/area into every existing membership.
update public.studio_memberships sm
set public_role_key = coalesce(sm.public_role_key, mp.public_role_key),
    public_role_label = coalesce(sm.public_role_label, mp.public_role_label),
    area_key = coalesce(sm.area_key, mp.area_key),
    area_label = coalesce(sm.area_label, mp.area_label),
    updated_at = now()
from public.studio_membership_plans mp
where mp.id = sm.plan_id;

-- Resolve only the Player owned by the membership user. A manager relationship
-- with somebody else's Player must never be used as their public identity.
update public.studio_memberships sm
set player_id = p.id,
    updated_at = now()
from public.players p
where p.owner_user_id = sm.user_id
  and sm.player_id is null;

-- Materialize active memberships into the public Player ↔ Studio directory.
insert into public.player_studios (
  player_id, studio_id, role, area_key, area_label, source_membership_id,
  is_primary, is_visible, status, joined_at
)
select sm.player_id, sm.studio_id, coalesce(sm.public_role_label, 'Miembro'),
       sm.area_key, sm.area_label, sm.id,
       false, true, 'active', sm.joined_at
from public.studio_memberships sm
where sm.status = 'active' and sm.player_id is not null
on conflict (player_id, studio_id) do update
set role = excluded.role,
    area_key = excluded.area_key,
    area_label = excluded.area_label,
    source_membership_id = excluded.source_membership_id,
    is_visible = true,
    status = 'active',
    left_at = null,
    updated_at = now();

-- Real initial Studio correction. Global Player identity remains untouched:
-- Bless keeps Rapero/Artista in his Player and becomes Fundador only inside 223.
do $$
declare
  v_studio_id uuid;
  v_bless_player uuid;
  v_bless_user uuid;
  v_clouva_player uuid;
  v_clouva_user uuid;
begin
  select id into v_studio_id from public.studios where slug = '223-social-club';
  select id, owner_user_id into v_bless_player, v_bless_user
    from public.players where slug = '0800bless';
  select id, owner_user_id into v_clouva_player, v_clouva_user
    from public.players where slug = 'clouva';

  if v_studio_id is not null and v_bless_user is not null then
    update public.studios
    set owner_id = v_bless_user,
        studio_os_status = 'legacy_active',
        studio_os_activated_at = coalesce(studio_os_activated_at, now()),
        updated_at = now()
    where id = v_studio_id;

    insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
    values (v_studio_id, v_bless_user, 'owner', 'active', now())
    on conflict (studio_id, profile_id) do update
    set role = 'owner', status = 'active';

    insert into public.profile_modes (user_id, mode, status)
    values (v_bless_user, 'studio_owner', 'active')
    on conflict (user_id, mode) do update set status = 'active', updated_at = now();
  end if;

  if v_studio_id is not null and v_bless_player is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      v_bless_player, v_studio_id, 'Fundador', 'direction', 'Dirección',
      true, true, 'active', now(), null
    )
    on conflict (player_id, studio_id) do update
    set role = 'Fundador', area_key = 'direction', area_label = 'Dirección',
        is_primary = true, is_visible = true, status = 'active',
        left_at = null, updated_at = now();
  end if;

  if v_studio_id is not null and v_clouva_user is not null then
    insert into public.studio_members (studio_id, profile_id, role, status, joined_at)
    values (v_studio_id, v_clouva_user, 'admin', 'active', now())
    on conflict (studio_id, profile_id) do update
    set role = 'admin', status = 'active';

    insert into public.profile_modes (user_id, mode, status)
    values (v_clouva_user, 'studio_manager', 'active')
    on conflict (user_id, mode) do update set status = 'active', updated_at = now();
  end if;

  if v_studio_id is not null and v_clouva_player is not null then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      v_clouva_player, v_studio_id, 'Socio', 'business', 'Business',
      false, true, 'active', now(), null
    )
    on conflict (player_id, studio_id) do update
    set role = 'Socio', area_key = 'business', area_label = 'Business',
        is_primary = false, is_visible = true, status = 'active',
        left_at = null, updated_at = now();
  end if;
end $$;
