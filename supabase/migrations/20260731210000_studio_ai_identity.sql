-- Generalizes the VIP AI Profile pipeline (20260730200000_vip_profile_ai_generation.sql,
-- 20260730203000_publish_player_profile_version.sql) to also target a
-- Studio ("lo mismo para el estudio, logo, material visual"), reusing the
-- same jobs/versions tables and publish function instead of standing up a
-- parallel system -- both tables currently have 0 real rows, so this is a
-- same-day generalization, not a risky live-data migration.

alter table public.studios
  add column if not exists tagline text,
  add column if not exists short_bio text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists share_title text,
  add column if not exists share_description text,
  add column if not exists og_image_url text,
  add column if not exists accent_color text,
  add column if not exists palette text[];

alter table public.vip_profile_generation_jobs
  alter column player_id drop not null,
  add column studio_id uuid references public.studios(id) on delete cascade,
  add constraint vip_profile_generation_jobs_subject_shape check (
    (player_id is not null and studio_id is null) or (player_id is null and studio_id is not null)
  );

create index vip_profile_generation_jobs_studio_idx on public.vip_profile_generation_jobs(studio_id);

drop index if exists vip_profile_generation_jobs_one_active_per_player;
create unique index vip_profile_generation_jobs_one_active_per_subject
  on public.vip_profile_generation_jobs(coalesce(player_id, studio_id))
  where status not in ('review_ready', 'published', 'failed', 'blocked_budget', 'cancelled');

alter table public.player_profile_versions
  alter column player_id drop not null,
  add column studio_id uuid references public.studios(id) on delete cascade,
  add constraint player_profile_versions_subject_shape check (
    (player_id is not null and studio_id is null) or (player_id is null and studio_id is not null)
  );

create index player_profile_versions_studio_idx on public.player_profile_versions(studio_id);

alter table public.player_profile_versions drop constraint if exists player_profile_versions_player_id_version_number_key;
create unique index player_profile_versions_subject_version_unique
  on public.player_profile_versions(coalesce(player_id, studio_id), version_number);

drop index if exists player_profile_versions_one_published_per_player;
create unique index player_profile_versions_one_published_per_subject
  on public.player_profile_versions(coalesce(player_id, studio_id))
  where status = 'published';

-- ---------------------------------------------------------------------------
-- RLS -- purely additive (extra OR clause for Studio managers), the existing
-- Player clauses are untouched.
-- ---------------------------------------------------------------------------

drop policy if exists vip_profile_generation_jobs_select_owner_or_admin on public.vip_profile_generation_jobs;
create policy vip_profile_generation_jobs_select_owner_or_admin
  on public.vip_profile_generation_jobs for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.player_members m
      where m.player_id = vip_profile_generation_jobs.player_id
        and m.user_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'manager', 'editor')
    )
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = vip_profile_generation_jobs.studio_id
        and m.profile_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'admin', 'manager', 'editor')
    )
    or exists (select 1 from public.studios s where s.id = vip_profile_generation_jobs.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

drop policy if exists player_profile_versions_select_public_or_member on public.player_profile_versions;
create policy player_profile_versions_select_public_or_member
  on public.player_profile_versions for select
  using (
    status = 'published'
    or exists (
      select 1 from public.player_members m
      where m.player_id = player_profile_versions.player_id
        and m.user_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'manager', 'editor')
    )
    or exists (select 1 from public.players pl where pl.id = player_profile_versions.player_id and pl.owner_user_id = auth.uid())
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = player_profile_versions.studio_id
        and m.profile_id = auth.uid() and m.status = 'active'
        and m.role in ('owner', 'admin', 'manager', 'editor')
    )
    or exists (select 1 from public.studios s where s.id = player_profile_versions.studio_id and s.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------------
-- publish_player_profile_version now branches on which subject the version
-- belongs to and syncs the approved draft onto players OR studios --
-- identical "publish = draft becomes the real profile" rule for both.
-- ---------------------------------------------------------------------------

create or replace function public.publish_player_profile_version(p_version_id uuid)
returns public.player_profile_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_studio_id uuid;
  v_status text;
  v_result public.player_profile_versions%rowtype;
  v_cover_url text;
  v_logo_url text;
  v_palette text[];
begin
  select player_id, studio_id, status into v_player_id, v_studio_id, v_status
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
  where coalesce(player_id, studio_id) = coalesce(v_player_id, v_studio_id)
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

  if v_player_id is not null then
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
  else
    update public.studios
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
    where id = v_studio_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.publish_player_profile_version(uuid) from public, anon, authenticated;
grant execute on function public.publish_player_profile_version(uuid) to service_role;
