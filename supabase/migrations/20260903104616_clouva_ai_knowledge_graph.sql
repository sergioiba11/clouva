-- CLOUVA AI persistent knowledge graph + contextual retrieval
-- Extends the existing intelligence pipeline without replacing project_memory,
-- project_events, canonical domain tables, or the Tool Router.

create extension if not exists pgcrypto;

create table if not exists public.ai_knowledge_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  owner_user_id uuid references auth.users(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  project_id uuid references public.flow_projects(id) on delete set null,
  title text not null,
  data jsonb not null default '{}'::jsonb,
  source text not null default 'database'
    check (source in ('user','database','system','tool','github','calendar','external_api','ai_inferred')),
  canonical_source_table text,
  canonical_source_id text,
  scope text not null default 'private'
    check (scope in ('private','studio','platform','public')),
  visibility text not null default 'private'
    check (visibility in ('private','studio','platform','public')),
  status text not null default 'active'
    check (status in ('active','archived')),
  is_inferred boolean not null default false,
  confidence numeric(4,3) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_source_table, canonical_source_id)
);

create index if not exists ai_knowledge_entities_owner_idx
  on public.ai_knowledge_entities(owner_user_id, status, updated_at desc)
  where owner_user_id is not null;
create index if not exists ai_knowledge_entities_studio_idx
  on public.ai_knowledge_entities(studio_id, status, updated_at desc)
  where studio_id is not null;
create index if not exists ai_knowledge_entities_project_idx
  on public.ai_knowledge_entities(project_id, status, updated_at desc)
  where project_id is not null;
create index if not exists ai_knowledge_entities_type_idx
  on public.ai_knowledge_entities(entity_type, status, updated_at desc);

create table if not exists public.ai_knowledge_relations (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references public.ai_knowledge_entities(id) on delete cascade,
  relation_type text not null,
  target_entity_id uuid not null references public.ai_knowledge_entities(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'database'
    check (source in ('user','database','system','tool','github','calendar','external_api','ai_inferred')),
  scope text not null default 'private'
    check (scope in ('private','studio','platform','public')),
  visibility text not null default 'private'
    check (visibility in ('private','studio','platform','public')),
  status text not null default 'active'
    check (status in ('active','archived')),
  is_inferred boolean not null default false,
  confidence numeric(4,3) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_entity_id, relation_type, target_entity_id, source)
);

create index if not exists ai_knowledge_relations_source_idx
  on public.ai_knowledge_relations(source_entity_id, status);
create index if not exists ai_knowledge_relations_target_idx
  on public.ai_knowledge_relations(target_entity_id, status);
create index if not exists ai_knowledge_relations_owner_idx
  on public.ai_knowledge_relations(owner_user_id, status, updated_at desc)
  where owner_user_id is not null;
create index if not exists ai_knowledge_relations_studio_idx
  on public.ai_knowledge_relations(studio_id, status, updated_at desc)
  where studio_id is not null;

create table if not exists public.ai_knowledge_procedures (
  id uuid primary key default gen_random_uuid(),
  procedure_key text not null,
  title text not null,
  summary text not null,
  steps jsonb not null default '[]'::jsonb,
  triggers text[] not null default '{}'::text[],
  owner_user_id uuid references auth.users(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  source text not null default 'system'
    check (source in ('user','database','system','tool','github','calendar','external_api','ai_inferred')),
  scope text not null default 'platform'
    check (scope in ('private','studio','platform','public')),
  visibility text not null default 'platform'
    check (visibility in ('private','studio','platform','public')),
  status text not null default 'active'
    check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (procedure_key, owner_user_id, studio_id)
);

create index if not exists ai_knowledge_procedures_scope_idx
  on public.ai_knowledge_procedures(scope, status, updated_at desc);

create table if not exists public.ai_core_knowledge (
  id uuid primary key default gen_random_uuid(),
  knowledge_key text not null unique,
  category text not null,
  title text not null,
  content text not null,
  data jsonb not null default '{}'::jsonb,
  source text not null default 'system'
    check (source in ('user','database','system','tool','github','calendar','external_api','ai_inferred')),
  status text not null default 'active'
    check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_knowledge_entities enable row level security;
alter table public.ai_knowledge_relations enable row level security;
alter table public.ai_knowledge_procedures enable row level security;
alter table public.ai_core_knowledge enable row level security;

-- Internal storage: authenticated access is only through the filtered resolver.
revoke all on public.ai_knowledge_entities from public, anon, authenticated;
revoke all on public.ai_knowledge_relations from public, anon, authenticated;
revoke all on public.ai_knowledge_procedures from public, anon, authenticated;
revoke all on public.ai_core_knowledge from public, anon, authenticated;
grant select, insert, update, delete on public.ai_knowledge_entities to service_role;
grant select, insert, update, delete on public.ai_knowledge_relations to service_role;
grant select, insert, update, delete on public.ai_knowledge_procedures to service_role;
grant select, insert, update, delete on public.ai_core_knowledge to service_role;

create or replace function public.clouva_upsert_knowledge_entity(
  p_entity_type text,
  p_owner_user_id uuid,
  p_studio_id uuid,
  p_project_id uuid,
  p_title text,
  p_data jsonb,
  p_source text,
  p_source_table text,
  p_source_id text,
  p_scope text,
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_source_table is null or p_source_id is null then
    raise exception 'Canonical source is required';
  end if;

  insert into public.ai_knowledge_entities (
    entity_type, owner_user_id, studio_id, project_id, title, data, source,
    canonical_source_table, canonical_source_id, scope, visibility,
    is_inferred, confidence, status, updated_at
  ) values (
    p_entity_type, p_owner_user_id, p_studio_id, p_project_id,
    left(coalesce(nullif(trim(p_title), ''), p_entity_type), 500),
    coalesce(p_data, '{}'::jsonb), p_source, p_source_table, p_source_id,
    p_scope, p_visibility, false, 1.0, 'active', now()
  )
  on conflict (canonical_source_table, canonical_source_id)
  do update set
    entity_type=excluded.entity_type,
    owner_user_id=excluded.owner_user_id,
    studio_id=excluded.studio_id,
    project_id=excluded.project_id,
    title=excluded.title,
    data=excluded.data,
    source=excluded.source,
    scope=excluded.scope,
    visibility=excluded.visibility,
    is_inferred=false,
    confidence=1.0,
    status='active',
    updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.clouva_link_knowledge_owner(
  p_entity_id uuid,
  p_owner_user_id uuid,
  p_relation_type text,
  p_studio_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_entity_id uuid;
  v_scope text := case when p_studio_id is null then 'private' else 'studio' end;
  v_visibility text := case when p_studio_id is null then 'private' else 'studio' end;
begin
  if p_owner_user_id is null or p_entity_id is null then return; end if;
  select e.id into v_player_entity_id
  from public.ai_knowledge_entities e
  where e.canonical_source_table='players'
    and e.owner_user_id=p_owner_user_id
    and e.status='active'
  order by e.created_at asc limit 1;
  if v_player_entity_id is null or v_player_entity_id=p_entity_id then return; end if;

  insert into public.ai_knowledge_relations (
    source_entity_id,relation_type,target_entity_id,owner_user_id,studio_id,
    source,scope,visibility,status,is_inferred,confidence,updated_at
  ) values (
    v_player_entity_id,p_relation_type,p_entity_id,p_owner_user_id,p_studio_id,
    'database',v_scope,v_visibility,'active',false,1.0,now()
  )
  on conflict (source_entity_id,relation_type,target_entity_id,source)
  do update set owner_user_id=excluded.owner_user_id,
                studio_id=excluded.studio_id,
                scope=excluded.scope,
                visibility=excluded.visibility,
                status='active',
                updated_at=now();
end;
$$;

create or replace function public.clouva_sync_knowledge_entity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
begin
  case tg_table_name
    when 'players' then
      v_owner_user_id := new.owner_user_id;
      v_entity_type := 'player';
      v_title := new.display_name;
      v_data := jsonb_build_object(
        'username',new.username,
        'primary_role',v_row->'primary_role',
        'professional_categories',coalesce(v_row->'professional_categories','[]'::jsonb),
        'disciplines',coalesce(v_row->'disciplines','[]'::jsonb),
        'publication_status',new.publication_status);
    when 'studios' then
      v_owner_user_id := new.owner_id;
      v_studio_id := new.id;
      v_entity_type := 'studio';
      v_title := new.name;
      v_data := jsonb_build_object('slug',new.slug,'city',new.city,'country',new.country);
      v_relation := 'owns';
    when 'flow_projects' then
      v_owner_user_id := new.owner_id;
      v_project_id := new.id;
      v_entity_type := 'project';
      v_title := new.title;
      v_data := jsonb_build_object('status',new.status,'priority',new.priority,'notes',new.notes);
      v_relation := 'works_on';
    when 'creator_3d_assets' then
      v_owner_user_id := new.user_id;
      v_entity_type := 'asset_3d';
      v_title := new.name;
      v_data := jsonb_build_object('kind',new.kind,'category',new.category,'status',new.status);
      v_relation := 'owns';
    when 'flow_music_tracks' then
      v_owner_user_id := new.owner_id;
      v_entity_type := 'track';
      v_title := new.title;
      v_data := jsonb_build_object('status',new.status,'producer',new.producer,'release_target_date',new.release_target_date);
      v_relation := 'created';
    when 'flow_releases' then
      v_owner_user_id := new.owner_id;
      v_entity_type := 'release';
      v_title := new.title;
      v_data := jsonb_build_object('status',new.status,'release_date',new.release_date);
      v_relation := 'created';
    when 'commerce_spots' then
      v_owner_user_id := coalesce(new.owner_user_id,new.created_by);
      v_studio_id := new.studio_id;
      v_entity_type := 'business';
      v_title := new.name;
      v_data := jsonb_build_object('slug',new.slug,'business_type',new.business_type,'business_categories',new.business_categories);
      v_relation := 'owns';
    when 'commerce_products' then
      v_owner_user_id := coalesce(new.owner_user_id,new.created_by);
      v_studio_id := new.studio_id;
      v_entity_type := case when new.product_type='service' then 'service' else 'product' end;
      v_title := new.name;
      v_data := jsonb_build_object('slug',new.slug,'product_type',new.product_type,'listing_kind',new.listing_kind);
      v_relation := 'created';
    when 'agenda_events' then
      v_player_id := new.created_by_player_id;
      if v_player_id is not null then
        select p.owner_user_id into v_owner_user_id from public.players p where p.id=v_player_id;
      end if;
      if v_owner_user_id is null then return new; end if;
      v_entity_type := 'agenda_event';
      v_title := new.title;
      v_data := jsonb_build_object('event_type',new.event_type);
      v_source := 'calendar';
      v_relation := 'created';
    else
      return new;
  end case;

  if v_owner_user_id is null and v_studio_id is null then return new; end if;

  v_entity_id := public.clouva_upsert_knowledge_entity(
    v_entity_type,v_owner_user_id,v_studio_id,v_project_id,v_title,v_data,v_source,
    tg_table_name,new.id::text,
    case when v_studio_id is null then 'private' else 'studio' end,
    case when v_studio_id is null then 'private' else 'studio' end);

  if v_relation is not null then
    perform public.clouva_link_knowledge_owner(v_entity_id,v_owner_user_id,v_relation,v_studio_id);
  end if;

  if tg_table_name='commerce_products' and new.spot_id is not null then
    select e.id into v_target_id
    from public.ai_knowledge_entities e
    where e.canonical_source_table='commerce_spots'
      and e.canonical_source_id=new.spot_id::text
      and e.status='active'
    limit 1;
    if v_target_id is not null then
      insert into public.ai_knowledge_relations (
        source_entity_id,relation_type,target_entity_id,owner_user_id,studio_id,
        source,scope,visibility
      ) values (
        v_entity_id,'belongs_to',v_target_id,v_owner_user_id,v_studio_id,
        'database',case when v_studio_id is null then 'private' else 'studio' end,
        case when v_studio_id is null then 'private' else 'studio' end
      ) on conflict (source_entity_id,relation_type,target_entity_id,source)
      do update set status='active',updated_at=now();
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.clouva_archive_knowledge_entity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_knowledge_entities
  set status='archived',updated_at=now()
  where canonical_source_table=tg_table_name and canonical_source_id=old.id::text;
  return old;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'players','studios','flow_projects','creator_3d_assets','flow_music_tracks',
    'flow_releases','commerce_spots','commerce_products','agenda_events'
  ] loop
    execute format('drop trigger if exists clouva_knowledge_sync on public.%I',v_table);
    execute format('create trigger clouva_knowledge_sync after insert or update on public.%I for each row execute function public.clouva_sync_knowledge_entity_trigger()',v_table);
    execute format('drop trigger if exists clouva_knowledge_archive on public.%I',v_table);
    execute format('create trigger clouva_knowledge_archive after delete on public.%I for each row execute function public.clouva_archive_knowledge_entity_trigger()',v_table);
  end loop;
end;
$$;

-- Backfill the canonical sources that already exist. This creates references,
-- not fabricated historical events.
do $$
declare r record; v_id uuid;
begin
  for r in select * from public.players loop
    v_id := public.clouva_upsert_knowledge_entity(
      'player',r.owner_user_id,null,null,r.display_name,
      jsonb_build_object('username',r.username,'primary_role',to_jsonb(r)->'primary_role','professional_categories',coalesce(to_jsonb(r)->'professional_categories','[]'::jsonb),'disciplines',coalesce(to_jsonb(r)->'disciplines','[]'::jsonb),'publication_status',r.publication_status),
      'database','players',r.id::text,'private','private');
  end loop;
  for r in select * from public.studios loop
    v_id := public.clouva_upsert_knowledge_entity('studio',r.owner_id,r.id,null,r.name,jsonb_build_object('slug',r.slug,'city',r.city,'country',r.country),'database','studios',r.id::text,'studio','studio');
    perform public.clouva_link_knowledge_owner(v_id,r.owner_id,'owns',r.id);
  end loop;
  for r in select * from public.flow_projects loop
    v_id := public.clouva_upsert_knowledge_entity('project',r.owner_id,null,r.id,r.title,jsonb_build_object('status',r.status,'priority',r.priority,'notes',r.notes),'database','flow_projects',r.id::text,'private','private');
    perform public.clouva_link_knowledge_owner(v_id,r.owner_id,'works_on',null);
  end loop;
  for r in select * from public.creator_3d_assets loop
    v_id := public.clouva_upsert_knowledge_entity('asset_3d',r.user_id,null,null,r.name,jsonb_build_object('kind',r.kind,'category',r.category,'status',r.status),'database','creator_3d_assets',r.id::text,'private','private');
    perform public.clouva_link_knowledge_owner(v_id,r.user_id,'owns',null);
  end loop;
  for r in select * from public.flow_music_tracks loop
    v_id := public.clouva_upsert_knowledge_entity('track',r.owner_id,null,null,r.title,jsonb_build_object('status',r.status,'producer',r.producer,'release_target_date',r.release_target_date),'database','flow_music_tracks',r.id::text,'private','private');
    perform public.clouva_link_knowledge_owner(v_id,r.owner_id,'created',null);
  end loop;
  for r in select * from public.flow_releases loop
    v_id := public.clouva_upsert_knowledge_entity('release',r.owner_id,null,null,r.title,jsonb_build_object('status',r.status,'release_date',r.release_date),'database','flow_releases',r.id::text,'private','private');
    perform public.clouva_link_knowledge_owner(v_id,r.owner_id,'created',null);
  end loop;
  for r in select * from public.commerce_spots loop
    v_id := public.clouva_upsert_knowledge_entity('business',coalesce(r.owner_user_id,r.created_by),r.studio_id,null,r.name,jsonb_build_object('slug',r.slug,'business_type',r.business_type,'business_categories',r.business_categories),'database','commerce_spots',r.id::text,case when r.studio_id is null then 'private' else 'studio' end,case when r.studio_id is null then 'private' else 'studio' end);
    perform public.clouva_link_knowledge_owner(v_id,coalesce(r.owner_user_id,r.created_by),'owns',r.studio_id);
  end loop;
  for r in select * from public.commerce_products loop
    v_id := public.clouva_upsert_knowledge_entity(case when r.product_type='service' then 'service' else 'product' end,coalesce(r.owner_user_id,r.created_by),r.studio_id,null,r.name,jsonb_build_object('slug',r.slug,'product_type',r.product_type,'listing_kind',r.listing_kind),'database','commerce_products',r.id::text,case when r.studio_id is null then 'private' else 'studio' end,case when r.studio_id is null then 'private' else 'studio' end);
    perform public.clouva_link_knowledge_owner(v_id,coalesce(r.owner_user_id,r.created_by),'created',r.studio_id);
  end loop;
end;
$$;

insert into public.ai_knowledge_procedures (
  procedure_key,title,summary,steps,triggers,source,scope,visibility,status,metadata
) values
(
  'publish_track','Publicar una canción',
  'Flujo canónico para llevar una canción desde el master hasta publicación y campaña.',
  '[{"order":1,"key":"master","label":"Master"},{"order":2,"key":"metadata","label":"Metadata"},{"order":3,"key":"cover","label":"Portada"},{"order":4,"key":"distribution","label":"Distribución"},{"order":5,"key":"player","label":"Player"},{"order":6,"key":"content","label":"Contenido"},{"order":7,"key":"campaign","label":"Campaña"},{"order":8,"key":"agenda","label":"Agenda"}]'::jsonb,
  array['publicar canción','publicar tema','lanzar tema','release','distribuir música'],
  'system','platform','platform','active',jsonb_build_object('domain','music')
),
(
  'create_3d_asset','Crear objeto 3D',
  'Flujo canónico de CLOUVA Creator para convertir un concepto en un asset utilizable e imprimible.',
  '[{"order":1,"key":"concept","label":"Concepto"},{"order":2,"key":"model","label":"Modelo"},{"order":3,"key":"dimensions","label":"Dimensiones"},{"order":4,"key":"parts","label":"Piezas"},{"order":5,"key":"meshy_blender","label":"Meshy / Blender"},{"order":6,"key":"formats","label":"GLB / STL"},{"order":7,"key":"creator","label":"Creator"},{"order":8,"key":"inventory","label":"Inventario"}]'::jsonb,
  array['crear objeto 3d','imprimir 3d','pica','meshy','blender','stl','glb'],
  'system','platform','platform','active',jsonb_build_object('domain','creator')
)
on conflict (procedure_key,owner_user_id,studio_id) do update
set title=excluded.title,summary=excluded.summary,steps=excluded.steps,
    triggers=excluded.triggers,metadata=excluded.metadata,status='active',updated_at=now();

insert into public.ai_core_knowledge (knowledge_key,category,title,content,data,source,status,version)
values
('product_map','architecture','Mapa canónico de CLOUVA','HOME conecta PLAYER, MI FLOW y CREATOR. PLAYER representa identidad y perfil público. MI FLOW concentra dinero y billetera. CREATOR crea avatar 3D, ropa y accesorios. MARKET conecta productos y servicios con PLAYER/SPOT. MI SPOT concentra negocio y herramientas; ADMIN aparece cuando corresponde.',jsonb_build_object('nodes',array['HOME','PLAYER','MI FLOW','CREATOR','MARKET','MI SPOT','ADMIN']),'system','active',1),
('knowledge_architecture','architecture','Arquitectura de conocimiento CLOUVA AI','Conversation history, memoria aprobada, entidades/relaciones, procedimientos y datos vivos son capas distintas. Los datos estructurados mantienen su fuente canónica. Las inferencias de IA no reemplazan silenciosamente datos canónicos.',jsonb_build_object('layers',array['core','player','project','entities','relations','procedures','live_data','tools']),'system','active',1),
('knowledge_source_truth','rules','Source of truth','Memory guarda conocimiento persistente aprobado; entidades enlazan fuentes canónicas; Live Data consulta el estado actual; Tools ejecutan acciones. Nunca convertir saldo, stock, órdenes o estados externos actuales en memoria duradera.',jsonb_build_object('canonical_sources',array['database','tool','github','calendar','external_api']),'system','active',1)
on conflict (knowledge_key) do update
set category=excluded.category,title=excluded.title,content=excluded.content,data=excluded.data,
    source=excluded.source,status='active',version=excluded.version,updated_at=now();

create or replace function public.clouva_resolve_knowledge_context(
  p_user_id uuid,
  p_query text,
  p_studio_id uuid default null,
  p_limit integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit,8),1),12);
  v_tokens text[] := '{}'::text[];
  v_entities jsonb := '[]'::jsonb;
  v_relations jsonb := '[]'::jsonb;
  v_procedures jsonb := '[]'::jsonb;
  v_core jsonb := '[]'::jsonb;
  v_live jsonb := '{}'::jsonb;
  v_entity_ids uuid[] := '{}'::uuid[];
  v_prompt text := '';
  v_studio_allowed boolean := false;
begin
  if p_user_id is null then raise exception 'user_id required'; end if;
  if v_auth_uid is not null and v_auth_uid<>p_user_id then
    raise exception 'Knowledge context access denied' using errcode='42501';
  end if;
  if p_studio_id is not null then
    v_studio_allowed := public.is_active_studio_participant(p_studio_id,p_user_id)
      or public.can_manage_studio(p_studio_id,p_user_id);
    if not v_studio_allowed then
      raise exception 'Studio knowledge context access denied' using errcode='42501';
    end if;
  end if;

  select coalesce(array_agg(distinct token),'{}'::text[]) into v_tokens
  from (
    select lower(word) as token
    from regexp_split_to_table(coalesce(p_query,''),'[^[:alnum:]áéíóúüñ]+') as word
    where length(word)>=3
      and lower(word)<>all(array['para','como','con','del','las','los','una','uno','que','por','esto','esta','ese','esa','hay','quiero','seguimos','seguir','sobre'])
  ) q;

  with ranked as (
    select e.*,
      coalesce((select count(*) from unnest(v_tokens) t where lower(e.title||' '||e.data::text||' '||e.entity_type) like '%'||t||'%'),0) as score
    from public.ai_knowledge_entities e
    where e.status='active'
      and (e.owner_user_id=p_user_id
        or (p_studio_id is not null and e.studio_id=p_studio_id and v_studio_allowed)
        or e.scope in ('platform','public'))
      and (cardinality(v_tokens)=0
        or exists (select 1 from unnest(v_tokens) t where lower(e.title||' '||e.data::text||' '||e.entity_type) like '%'||t||'%'))
    order by score desc,e.updated_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'type',entity_type,'title',title,'projectId',project_id,
      'source',source,'sourceTable',canonical_source_table,'sourceId',canonical_source_id,'data',data
    ) order by score desc,updated_at desc),'[]'::jsonb),
    coalesce(array_agg(id),'{}'::uuid[])
  into v_entities,v_entity_ids from ranked;

  if cardinality(v_entity_ids)>0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'relation',r.relation_type,
      'sourceId',r.source_entity_id,'sourceTitle',se.title,'sourceType',se.entity_type,
      'targetId',r.target_entity_id,'targetTitle',te.title,'targetType',te.entity_type,
      'source',r.source,'metadata',r.metadata
    ) order by r.updated_at desc),'[]'::jsonb)
    into v_relations
    from public.ai_knowledge_relations r
    join public.ai_knowledge_entities se on se.id=r.source_entity_id
    join public.ai_knowledge_entities te on te.id=r.target_entity_id
    where r.status='active'
      and (r.source_entity_id=any(v_entity_ids) or r.target_entity_id=any(v_entity_ids))
      and (r.owner_user_id=p_user_id
        or (p_studio_id is not null and r.studio_id=p_studio_id and v_studio_allowed)
        or r.scope in ('platform','public'));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'key',p.procedure_key,'title',p.title,'summary',p.summary,
    'steps',p.steps,'source',p.source
  ) order by p.updated_at desc),'[]'::jsonb)
  into v_procedures
  from public.ai_knowledge_procedures p
  where p.status='active'
    and (p.scope in ('platform','public') or p.owner_user_id=p_user_id
      or (p_studio_id is not null and p.studio_id=p_studio_id and v_studio_allowed))
    and (cardinality(v_tokens)=0
      or exists (select 1 from unnest(v_tokens) t where lower(p.title||' '||p.summary||' '||array_to_string(p.triggers,' ')||' '||p.steps::text) like '%'||t||'%'))
  limit v_limit;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'key',c.knowledge_key,'category',c.category,'title',c.title,
    'content',c.content,'data',c.data,'source',c.source,'version',c.version
  ) order by c.updated_at desc),'[]'::jsonb)
  into v_core
  from public.ai_core_knowledge c
  where c.status='active'
    and (cardinality(v_tokens)=0
      or exists (select 1 from unnest(v_tokens) t where lower(c.title||' '||c.content||' '||c.category||' '||c.data::text) like '%'||t||'%'))
  limit v_limit;

  -- Live Data comes directly from canonical tables only when the query asks.
  if exists (select 1 from unnest(v_tokens) t where t=any(array['agenda','evento','eventos','horario','horarios','sesion','sesión','turno','turnos'])) then
    v_live := v_live||jsonb_build_object('agenda',coalesce((
      select jsonb_agg(x order by x.start_at)
      from (
        select ae.id,ae.title,ae.event_type,ae.start_at,ae.end_at,ae.status,ae.location_text
        from public.agenda_events ae
        join public.players p on p.id=ae.created_by_player_id
        where p.owner_user_id=p_user_id and ae.end_at>=now()-interval '1 day'
        order by ae.start_at asc limit v_limit
      ) x
    ),'[]'::jsonb));
  end if;

  if exists (select 1 from unnest(v_tokens) t where t=any(array['producto','productos','stock','inventario','tienda','market','spot'])) then
    v_live := v_live||jsonb_build_object('commerce',coalesce((
      select jsonb_agg(x order by x.updated_at desc)
      from (
        select cp.id,cp.name,cp.product_type,cp.status,cp.stock,cp.price,cp.currency,cp.spot_id,cp.updated_at
        from public.commerce_products cp
        where cp.owner_user_id=p_user_id
           or (p_studio_id is not null and cp.studio_id=p_studio_id and v_studio_allowed)
        order by cp.updated_at desc limit v_limit
      ) x
    ),'[]'::jsonb));
  end if;

  v_prompt := concat_ws(' ',
    case when jsonb_array_length(v_entities)>0 then 'Entidades: '||(select string_agg(format('%s (%s)',x->>'title',x->>'type'),', ') from jsonb_array_elements(v_entities) x)||'.' end,
    case when jsonb_array_length(v_relations)>0 then 'Relaciones: '||(select string_agg(format('%s → %s → %s',x->>'sourceTitle',x->>'relation',x->>'targetTitle'),'; ') from jsonb_array_elements(v_relations) x)||'.' end,
    case when jsonb_array_length(v_procedures)>0 then 'Procedimientos: '||(select string_agg(x->>'title',', ') from jsonb_array_elements(v_procedures) x)||'.' end,
    case when jsonb_array_length(v_core)>0 then 'CLOUVA Core: '||(select string_agg(x->>'title',', ') from jsonb_array_elements(v_core) x)||'.' end,
    case when v_live<>'{}'::jsonb then 'Live Data consultado desde fuentes canónicas.' end);

  return jsonb_build_object(
    'query',left(coalesce(p_query,''),500),
    'scopes',jsonb_build_array('core','player','project','entities','relations','procedures','live_data'),
    'entities',v_entities,'relations',v_relations,'procedures',v_procedures,'core',v_core,
    'liveData',v_live,'prompt',left(coalesce(v_prompt,''),2400));
end;
$$;

revoke all on function public.clouva_resolve_knowledge_context(uuid,text,uuid,integer) from public,anon;
grant execute on function public.clouva_resolve_knowledge_context(uuid,text,uuid,integer) to authenticated,service_role;

create or replace function public.clouva_ai_knowledge_context_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_studio_id uuid;
  v_context jsonb;
  v_prompt text;
begin
  if new.role<>'user' then return new; end if;
  select c.studio_id into v_studio_id
  from public.ai_conversations c
  where c.id=new.conversation_id and c.user_id=new.user_id;

  v_context := public.clouva_resolve_knowledge_context(new.user_id,new.content,v_studio_id,8);
  v_prompt := nullif(trim(coalesce(v_context->>'prompt','')),'');
  if v_prompt is null then return new; end if;

  perform public.clouva_emit_project_event(
    new.user_id,'ai.knowledge.context.v1','clouva-ai',
    'Conocimiento relevante: '||v_prompt,
    jsonb_build_object('source_message_id',new.id,'context',v_context),
    'ai_message',new.id::text,'knowledge_retrieval',
    case when v_studio_id is null then 'private' else 'studio' end,
    case when v_studio_id is null then 'private' else 'studio' end,
    true,false,false,format('ai-knowledge-context:%s',new.id),v_studio_id,1,new.created_at);
  return new;
end;
$$;

drop trigger if exists clouva_ai_knowledge_context on public.ai_messages;
create trigger clouva_ai_knowledge_context
  after insert on public.ai_messages
  for each row when (new.role='user')
  execute function public.clouva_ai_knowledge_context_trigger();

revoke all on function public.clouva_upsert_knowledge_entity(text,uuid,uuid,uuid,text,jsonb,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.clouva_link_knowledge_owner(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.clouva_sync_knowledge_entity_trigger() from public,anon,authenticated;
revoke all on function public.clouva_archive_knowledge_entity_trigger() from public,anon,authenticated;
revoke all on function public.clouva_ai_knowledge_context_trigger() from public,anon,authenticated;
grant execute on function public.clouva_upsert_knowledge_entity(text,uuid,uuid,uuid,text,jsonb,text,text,text,text,text) to service_role;
grant execute on function public.clouva_link_knowledge_owner(uuid,uuid,text,uuid) to service_role;
