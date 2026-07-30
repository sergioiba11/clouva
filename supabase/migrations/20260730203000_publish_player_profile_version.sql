-- Atomically archives whatever was published for this Player (if anything)
-- and publishes p_version_id, so player_profile_versions_one_published_per_player
-- (20260730200000_vip_profile_ai_generation.sql) is never violated by two
-- concurrent publish requests racing each other. Row-locks the target
-- version first, same defensive pattern as reserve_ai_image_budget.
create or replace function public.publish_player_profile_version(p_version_id uuid)
returns public.player_profile_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_status text;
  v_result public.player_profile_versions%rowtype;
begin
  select player_id, status into v_player_id, v_status
  from public.player_profile_versions
  where id = p_version_id
  for update;

  if not found then
    raise exception 'La versión no existe.';
  end if;
  if v_status = 'archived' then
    raise exception 'No se puede publicar una versión archivada.';
  end if;

  update public.player_profile_versions
  set status = 'archived'
  where player_id = v_player_id
    and status = 'published'
    and id != p_version_id;

  update public.player_profile_versions
  set status = 'published', published_at = now()
  where id = p_version_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.publish_player_profile_version(uuid) from public;
grant execute on function public.publish_player_profile_version(uuid) to service_role;
