create or replace function public.publish_player_profile_version(
  p_version_id uuid,
  p_publish_logo_too boolean default false
)
returns public.player_profile_versions
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player_id uuid;
  v_studio_id uuid;
  v_status text;
  v_version_number integer;
  v_latest_published_number integer;
  v_result public.player_profile_versions%rowtype;
  v_asset_references jsonb;
  v_layout_config jsonb;
  v_layout_kind text;
  v_logo_url text;
  v_cover_url text;
  v_current_logo_url text;
  v_slot_logo_url text;
  v_slot_cover_url text;
  v_logo_slot_used boolean := false;
  v_cover_slot_used boolean := false;
  v_palette text[];
begin
  select player_id, studio_id, status, version_number, asset_references, layout_config
  into v_player_id, v_studio_id, v_status, v_version_number, v_asset_references, v_layout_config
  from public.player_profile_versions
  where id = p_version_id
  for update;

  if not found then
    raise exception 'La versión no existe.';
  end if;

  if v_status = 'archived' then
    raise exception 'No se puede publicar una versión archivada.';
  end if;

  if v_status <> 'published' then
    select max(version_number)
    into v_latest_published_number
    from public.player_profile_versions
    where coalesce(player_id, studio_id) = coalesce(v_player_id, v_studio_id)
      and status = 'published'
      and id <> p_version_id;

    if v_latest_published_number is not null
      and v_version_number <= v_latest_published_number then
      raise exception 'La propuesta v% es anterior a la versión publicada v%. Creá una nueva versión antes de publicar.',
        v_version_number, v_latest_published_number;
    end if;
  end if;

  v_layout_kind := coalesce(v_layout_config->>'layout_kind', 'template');
  v_slot_logo_url := v_layout_config->'image_slots'->>'logo';
  v_slot_cover_url := v_layout_config->'image_slots'->>'cover';

  if v_layout_config is not null then
    v_logo_slot_used :=
      jsonb_path_exists(v_layout_config, '$.**.imageSlot ? (@ == "logo")')
      or jsonb_path_exists(v_layout_config, '$.**.image_slot ? (@ == "logo")')
      or jsonb_path_exists(v_layout_config, '$.**.imageSlotKey ? (@ == "logo")')
      or jsonb_path_exists(v_layout_config, '$.**.image_slot_key ? (@ == "logo")');
    v_cover_slot_used :=
      jsonb_path_exists(v_layout_config, '$.**.imageSlot ? (@ == "cover")')
      or jsonb_path_exists(v_layout_config, '$.**.image_slot ? (@ == "cover")')
      or jsonb_path_exists(v_layout_config, '$.**.imageSlotKey ? (@ == "cover")')
      or jsonb_path_exists(v_layout_config, '$.**.image_slot_key ? (@ == "cover")');
  end if;

  -- Precise layouts must prove that a slot is actually referenced by the
  -- renderer. Template/legacy layouts historically consume conventional
  -- image_slots implicitly, so those remain compatible.
  if v_slot_logo_url is not null and (v_layout_kind <> 'precise' or v_logo_slot_used) then
    v_logo_url := v_slot_logo_url;
  elsif not (coalesce(v_layout_config, '{}'::jsonb) ? 'image_slots') then
    select item->>'url'
    into v_logo_url
    from jsonb_array_elements(coalesce(v_asset_references, '[]'::jsonb)) item
    where item->>'kind' = 'logo'
    limit 1;
  end if;

  if v_slot_cover_url is not null and (v_layout_kind <> 'precise' or v_cover_slot_used) then
    v_cover_url := v_slot_cover_url;
  elsif not (coalesce(v_layout_config, '{}'::jsonb) ? 'image_slots') then
    select item->>'url'
    into v_cover_url
    from jsonb_array_elements(coalesce(v_asset_references, '[]'::jsonb)) item
    where item->>'kind' = 'cover'
    limit 1;
  end if;

  if v_player_id is not null then
    select logo_url into v_current_logo_url
    from public.players
    where id = v_player_id
    for update;
  else
    select logo_url into v_current_logo_url
    from public.studios
    where id = v_studio_id
    for update;
  end if;

  if v_logo_url is not null
    and v_logo_url is distinct from v_current_logo_url
    and not p_publish_logo_too then
    raise exception 'Esta identidad incluye un nuevo logo. Confirmá su publicación como identidad oficial antes de publicar la versión.';
  end if;

  update public.player_profile_versions
  set status = 'archived'
  where coalesce(player_id, studio_id) = coalesce(v_player_id, v_studio_id)
    and status = 'published'
    and id != p_version_id;

  update public.player_profile_versions
  set status = 'published', published_at = now()
  where id = p_version_id
  returning * into v_result;

  select array_agg(value) into v_palette
  from jsonb_array_elements_text(coalesce(v_result.visual_config->'palette', '[]'::jsonb)) value;

  if v_player_id is not null then
    update public.players
    set
      cover_url = coalesce(v_cover_url, cover_url),
      palette = coalesce(v_palette, palette),
      accent_color = coalesce(v_palette[1], accent_color),
      tagline = coalesce(v_result.copy_config->>'tagline', tagline),
      short_bio = coalesce(v_result.copy_config->>'short_bio', short_bio),
      seo_title = coalesce(v_result.copy_config->>'seo_title', seo_title),
      seo_description = coalesce(v_result.copy_config->>'seo_description', seo_description),
      share_title = coalesce(v_result.copy_config->>'share_title', share_title),
      share_description = coalesce(v_result.copy_config->>'share_description', share_description),
      og_image_url = coalesce(v_cover_url, og_image_url)
    where id = v_player_id;
  else
    update public.studios
    set
      cover_url = coalesce(v_cover_url, cover_url),
      palette = coalesce(v_palette, palette),
      accent_color = coalesce(v_palette[1], accent_color),
      tagline = coalesce(v_result.copy_config->>'tagline', tagline),
      short_bio = coalesce(v_result.copy_config->>'short_bio', short_bio),
      seo_title = coalesce(v_result.copy_config->>'seo_title', seo_title),
      seo_description = coalesce(v_result.copy_config->>'seo_description', seo_description),
      share_title = coalesce(v_result.copy_config->>'share_title', share_title),
      share_description = coalesce(v_result.copy_config->>'share_description', share_description),
      og_image_url = coalesce(v_cover_url, og_image_url)
    where id = v_studio_id;
  end if;

  if p_publish_logo_too
    and v_logo_url is not null
    and v_logo_url is distinct from v_current_logo_url then
    if v_result.brand_asset_version_id is not null then
      perform public.publish_brand_asset_version(v_result.brand_asset_version_id);
    elsif v_player_id is not null then
      update public.players set logo_url = v_logo_url where id = v_player_id;
    else
      update public.studios set logo_url = v_logo_url where id = v_studio_id;
    end if;
  end if;

  return v_result;
end;
$function$;
