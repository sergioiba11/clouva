create or replace function public.clouva_sync_knowledge_entity_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row jsonb := to_jsonb(new);
  v_entity_id uuid;
  v_owner_user_id uuid;
  v_studio_id uuid;
  v_project_id uuid;
  v_entity_type text;
  v_title text;
  v_data jsonb := '{}'::jsonb;
  v_source text := 'database';
  v_relation text;
  v_player_id uuid;
  v_target_id uuid;
  v_spot_id uuid;
begin
  case tg_table_name
    when 'players' then
      v_owner_user_id := new.owner_user_id;
      v_entity_type := 'player';
      v_title := new.display_name;
      v_data := jsonb_build_object(
        'username', new.username,
        'primary_role', v_row -> 'primary_role',
        'professional_categories', coalesce(v_row -> 'professional_categories', '[]'::jsonb),
        'disciplines', coalesce(v_row -> 'disciplines', '[]'::jsonb),
        'publication_status', new.publication_status
      );
    when 'studios' then
      v_owner_user_id := new.owner_id;
      v_studio_id := new.id;
      v_entity_type := 'studio';
      v_title := new.name;
      v_data := jsonb_build_object('slug', new.slug, 'city', new.city, 'country', new.country);
      v_relation := 'owns';
    when 'flow_projects' then
      v_owner_user_id := new.owner_id;
      v_project_id := new.id;
      v_entity_type := 'project';
      v_title := new.title;
      v_data := jsonb_build_object('status', new.status, 'priority', new.priority, 'notes', new.notes);
      v_relation := 'works_on';
    when 'creator_3d_assets' then
      v_owner_user_id := new.user_id;
      v_entity_type := 'asset_3d';
      v_title := new.name;
      v_data := jsonb_build_object('kind', new.kind, 'category', new.category, 'status', new.status);
      v_relation := 'owns';
    when 'flow_music_tracks' then
      v_owner_user_id := new.owner_id;
      v_entity_type := 'track';
      v_title := new.title;
      v_data := jsonb_build_object('status', new.status, 'producer', new.producer, 'release_target_date', new.release_target_date);
      v_relation := 'created';
    when 'flow_releases' then
      v_owner_user_id := new.owner_id;
      v_entity_type := 'release';
      v_title := new.title;
      v_data := jsonb_build_object('status', new.status, 'release_date', new.release_date);
      v_relation := 'created';
    when 'commerce_spots' then
      v_owner_user_id := coalesce(new.owner_user_id, new.created_by);
      v_studio_id := new.studio_id;
      v_entity_type := 'business';
      v_title := new.name;
      v_data := jsonb_build_object('slug', new.slug, 'business_type', new.business_type, 'business_categories', new.business_categories);
      v_relation := 'owns';
    when 'commerce_products' then
      v_owner_user_id := coalesce(new.owner_user_id, new.created_by);
      v_studio_id := new.studio_id;
      v_entity_type := case when new.product_type = 'service' then 'service' else 'product' end;
      v_title := new.name;
      v_data := jsonb_build_object('slug', new.slug, 'product_type', new.product_type, 'listing_kind', new.listing_kind);
      v_relation := 'created';
      v_spot_id := nullif(v_row ->> 'spot_id', '')::uuid;
    when 'agenda_events' then
      v_player_id := new.created_by_player_id;
      if v_player_id is not null then
        select p.owner_user_id into v_owner_user_id from public.players p where p.id = v_player_id;
      end if;
      if v_owner_user_id is null then return new; end if;
      v_entity_type := 'agenda_event';
      v_title := new.title;
      v_data := jsonb_build_object('event_type', new.event_type);
      v_source := 'calendar';
      v_relation := 'created';
    else
      return new;
  end case;

  if v_owner_user_id is null and v_studio_id is null then return new; end if;

  v_entity_id := public.clouva_upsert_knowledge_entity(
    v_entity_type,
    v_owner_user_id,
    v_studio_id,
    v_project_id,
    v_title,
    v_data,
    v_source,
    tg_table_name,
    new.id::text,
    case when v_studio_id is null then 'private' else 'studio' end,
    case when v_studio_id is null then 'private' else 'studio' end
  );

  if v_relation is not null then
    perform public.clouva_link_knowledge_owner(v_entity_id, v_owner_user_id, v_relation, v_studio_id);
  end if;

  if tg_table_name = 'commerce_products' and v_spot_id is not null then
    select e.id into v_target_id
    from public.ai_knowledge_entities e
    where e.canonical_source_table = 'commerce_spots'
      and e.canonical_source_id = v_spot_id::text
      and e.status = 'active'
    limit 1;
    if v_target_id is not null then
      insert into public.ai_knowledge_relations (
        source_entity_id, relation_type, target_entity_id, owner_user_id, studio_id,
        source, scope, visibility
      ) values (
        v_entity_id, 'belongs_to', v_target_id, v_owner_user_id, v_studio_id,
        'database', case when v_studio_id is null then 'private' else 'studio' end,
        case when v_studio_id is null then 'private' else 'studio' end
      ) on conflict (source_entity_id, relation_type, target_entity_id, source)
      do update set status = 'active', updated_at = now();
    end if;
  end if;

  return new;
end;
$function$;
