-- Canonicalize Studio logos that were already public before Brand Engine became
-- the source of truth. This does not upload/copy any bytes: the existing public
-- URL is referenced by a logical legacy-raster brand version.
--
-- The migration is intentionally generic (no Studio ids/names) and only treats
-- studios.logo_url as official because that field is already the public Studio
-- identity source used by production.

do $$
declare
  studio_row record;
  v_brand_asset_id uuid;
  v_official_version_id uuid;
begin
  for studio_row in
    select id, name, owner_id, logo_url
    from public.studios
    where nullif(btrim(logo_url), '') is not null
  loop
    v_brand_asset_id := null;
    v_official_version_id := null;

    select ba.id
      into v_brand_asset_id
    from public.brand_assets ba
    where ba.owner_type = 'studio'
      and ba.owner_id = studio_row.id
      and ba.status = 'active'
    order by ba.created_at asc
    limit 1;

    if v_brand_asset_id is null then
      insert into public.brand_assets (
        owner_type,
        owner_id,
        name,
        status,
        created_by
      ) values (
        'studio',
        studio_row.id,
        coalesce(nullif(btrim(studio_row.name), ''), 'Studio'),
        'active',
        studio_row.owner_id
      )
      returning id into v_brand_asset_id;
    end if;

    -- Reuse a previously canonicalized version if the same logical logo is
    -- already present. Rejected/generated candidates are deliberately ignored:
    -- the public Studio logo gets its own legacy import record so rejection
    -- history is never rewritten.
    select bav.id
      into v_official_version_id
    from public.brand_asset_versions bav
    where bav.brand_asset_id = v_brand_asset_id
      and bav.primary_logo_url = studio_row.logo_url
      and bav.status = 'published'
    order by bav.created_at desc
    limit 1;

    if v_official_version_id is null then
      insert into public.brand_asset_versions (
        brand_asset_id,
        source_type,
        primary_logo_url,
        original_asset_url,
        cleaned_asset_url,
        status,
        import_mode,
        source_kind,
        source_note
      ) values (
        v_brand_asset_id,
        'uploaded_logo',
        studio_row.logo_url,
        studio_row.logo_url,
        studio_row.logo_url,
        'published',
        'legacy_raster_import',
        'own_logo_file',
        'Migrated from the Studio public logo without duplicating physical storage.'
      )
      returning id into v_official_version_id;
    end if;

    -- Brand Engine keeps a single active/published version per logical brand
    -- asset. Older versions remain preserved as approved/rejected/draft history.
    update public.brand_asset_versions bav
       set status = 'approved'
     where bav.brand_asset_id = v_brand_asset_id
       and bav.id <> v_official_version_id
       and bav.status = 'published';

    update public.brand_assets ba
       set active_version_id = v_official_version_id
     where ba.id = v_brand_asset_id
       and ba.active_version_id is distinct from v_official_version_id;

    -- Link only the currently published Studio identity when its own canonical
    -- references prove it uses exactly this logo. Historical archived versions
    -- are left untouched.
    update public.player_profile_versions ppv
       set brand_asset_version_id = v_official_version_id
     where ppv.studio_id = studio_row.id
       and ppv.status = 'published'
       and ppv.brand_asset_version_id is null
       and exists (
         select 1
         from jsonb_array_elements(coalesce(ppv.asset_references, '[]'::jsonb)) ref
         where ref->>'kind' = 'logo'
           and ref->>'url' = studio_row.logo_url
       );
  end loop;
end
$$;
