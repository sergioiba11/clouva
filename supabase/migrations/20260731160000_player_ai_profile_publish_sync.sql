-- The VIP AI Profile pipeline (20260730200000_vip_profile_ai_generation.sql)
-- lets an owner review and "publish" a generated draft, but publish only
-- flipped player_profile_versions.status -- the public page (resolvePlayerAlias
-- in lib/server/public-identity-data.ts) reads straight off public.players and
-- never joins player_profile_versions, so a published draft was invisible to
-- anyone visiting the actual page. This adds the missing columns for the
-- generated logo/palette and makes publish copy the approved draft onto the
-- live players row -- publishing IS the moment the AI draft becomes the real
-- profile, so overwriting the manual fields here is intentional, not
-- accidental data loss.

alter table public.players
  add column if not exists logo_url text,
  add column if not exists palette text[];

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
  v_cover_url text;
  v_logo_url text;
  v_palette text[];
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

  select item->>'url' into v_cover_url
  from jsonb_array_elements(v_result.asset_references) item
  where item->>'kind' = 'cover'
  limit 1;

  select item->>'url' into v_logo_url
  from jsonb_array_elements(v_result.asset_references) item
  where item->>'kind' = 'logo'
  limit 1;

  select array_agg(value) into v_palette
  from jsonb_array_elements_text(coalesce(v_result.visual_config->'palette', '[]'::jsonb)) value;

  update public.players
  set
    cover_url = coalesce(v_cover_url, cover_url),
    logo_url = coalesce(v_logo_url, logo_url),
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

  return v_result;
end;
$$;

-- Same lockdown as 20260731011000: CREATE OR REPLACE keeps prior grants in
-- Postgres, but restate them explicitly so this migration is correct on its
-- own even if run against a fresh database.
revoke all on function public.publish_player_profile_version(uuid) from public, anon, authenticated;
grant execute on function public.publish_player_profile_version(uuid) to service_role;
