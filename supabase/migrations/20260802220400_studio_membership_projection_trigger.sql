-- Keep the public Player ↔ Studio projection synchronized even when a paid
-- membership expires, is cancelled, rejected or later approved.
create or replace function public.sync_studio_membership_public_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.player_id is null then
    return new;
  end if;

  if new.status = 'active' then
    insert into public.player_studios (
      player_id, studio_id, role, area_key, area_label, source_membership_id,
      is_primary, is_visible, status, joined_at, left_at
    ) values (
      new.player_id,
      new.studio_id,
      coalesce(new.public_role_label, 'Miembro'),
      new.area_key,
      new.area_label,
      new.id,
      false,
      true,
      'active',
      coalesce(new.joined_at, now()),
      null
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
  else
    update public.player_studios
    set is_visible = false,
        status = 'inactive',
        left_at = coalesce(left_at, now()),
        updated_at = now()
    where player_id = new.player_id
      and studio_id = new.studio_id
      and source_membership_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists studio_memberships_public_projection_sync on public.studio_memberships;
create trigger studio_memberships_public_projection_sync
after insert or update of status, player_id, public_role_label, area_key, area_label
on public.studio_memberships
for each row execute function public.sync_studio_membership_public_projection();

revoke all on function public.sync_studio_membership_public_projection() from public, anon, authenticated;
grant execute on function public.sync_studio_membership_public_projection() to service_role;
