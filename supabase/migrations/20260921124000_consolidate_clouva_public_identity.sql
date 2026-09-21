-- Consolidate the public CLOUVA artist identity without deleting account data.
-- The empty legacy Player remains in the database but is removed from public
-- discovery. Its old public alias becomes a redirect alias to /clouva.

do $$
declare
  canonical_id uuid;
  duplicate_id uuid;
  duplicate_is_empty boolean := false;
begin
  select id into canonical_id
  from public.players
  where lower(slug) = 'clouva'
  limit 1;

  if canonical_id is not null then
    insert into public.public_slug_aliases (alias, entity_type, entity_id, is_primary, redirect_to_primary)
    values ('clouva', 'player', canonical_id, true, true)
    on conflict (normalized_alias) do update
      set entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          is_primary = true,
          redirect_to_primary = true,
          updated_at = now();
  end if;

  select id into duplicate_id
  from public.players
  where lower(slug) = 'clouva-nlb'
  limit 1;

  if canonical_id is not null and duplicate_id is not null and canonical_id <> duplicate_id then
    select
      not exists (select 1 from public.player_media where player_id = duplicate_id)
      and not exists (select 1 from public.player_studios where player_id = duplicate_id)
      and not exists (select 1 from public.player_music_connections where player_id = duplicate_id)
      and not exists (select 1 from public.player_profile_versions where player_id = duplicate_id)
    into duplicate_is_empty;

    if duplicate_is_empty then
      update public.players
      set is_published = false,
          publication_status = 'unpublished',
          privacy_status = 'unlisted',
          updated_at = now()
      where id = duplicate_id;

      insert into public.public_slug_aliases (alias, entity_type, entity_id, is_primary, redirect_to_primary)
      values ('clouva-nlb', 'player', canonical_id, false, true)
      on conflict (normalized_alias) do update
        set entity_type = excluded.entity_type,
            entity_id = excluded.entity_id,
            is_primary = false,
            redirect_to_primary = true,
            updated_at = now();
    end if;
  end if;
end
$$;
