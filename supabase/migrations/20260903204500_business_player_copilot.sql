-- Business Player / Business AI operating layer.
-- Extends Mi Spot, Commerce Core and the existing CLOUVA AI knowledge graph.
-- It intentionally does not create a second chat/memory architecture.

create extension if not exists pgcrypto;

create table if not exists public.business_requests (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  request_type text not null default 'sourcing'
    check (request_type in ('sourcing','procurement','listing','logistics','operations','vehicle')),
  status text not null default 'draft'
    check (status in ('draft','analyzed','searching','candidates_ready','candidate_selected','in_progress','completed','cancelled')),
  title text not null,
  input_text text,
  reference_image_path text,
  intent jsonb not null default '{}'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  sourcing_result jsonb not null default '{}'::jsonb,
  decision_context jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_requests_spot_idx
  on public.business_requests(spot_id, updated_at desc);
create index if not exists business_requests_creator_idx
  on public.business_requests(created_by, updated_at desc);
create index if not exists business_requests_status_idx
  on public.business_requests(spot_id, status, updated_at desc);

create table if not exists public.business_sourcing_candidates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.business_requests(id) on delete cascade,
  rank integer not null default 0,
  status text not null default 'candidate'
    check (status in ('candidate','selected','rejected')),
  supplier_name text,
  offer_title text not null,
  source_title text,
  source_url text,
  price_amount numeric(18,4),
  currency text,
  moq integer,
  shipping_summary text,
  match_reason text,
  risks text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_sourcing_candidates_request_idx
  on public.business_sourcing_candidates(request_id, rank asc, created_at asc);

create table if not exists public.business_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.business_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists business_request_events_request_idx
  on public.business_request_events(request_id, created_at desc);

alter table public.business_requests enable row level security;
alter table public.business_sourcing_candidates enable row level security;
alter table public.business_request_events enable row level security;

-- These rows are exposed only through authenticated server routes that call
-- requireSpotAccess(). Keeping direct table access closed avoids duplicating
-- the canonical Spot role/capability rules in RLS.
revoke all on public.business_requests from public, anon, authenticated;
revoke all on public.business_sourcing_candidates from public, anon, authenticated;
revoke all on public.business_request_events from public, anon, authenticated;
grant select, insert, update, delete on public.business_requests to service_role;
grant select, insert, update, delete on public.business_sourcing_candidates to service_role;
grant select, insert, update, delete on public.business_request_events to service_role;

-- Private reference images. The server issues short-lived signed URLs; there
-- is no public bucket and no browser-direct write path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-reference-images',
  'business-reference-images',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

-- Business requests become canonical knowledge entities. This makes accepted
-- sourcing decisions and completed operations available to CLOUVA AI through
-- the existing resolver instead of introducing another memory store.
create or replace function public.clouva_sync_business_request_knowledge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
  v_studio_id uuid;
  v_entity_id uuid;
  v_spot_entity_id uuid;
  v_scope text;
begin
  select coalesce(s.owner_user_id, s.created_by), s.studio_id
    into v_owner_user_id, v_studio_id
  from public.commerce_spots s
  where s.id=new.spot_id;

  if v_owner_user_id is null then
    v_owner_user_id := new.created_by;
  end if;
  v_scope := case when v_studio_id is null then 'private' else 'studio' end;

  v_entity_id := public.clouva_upsert_knowledge_entity(
    'business_request',
    v_owner_user_id,
    v_studio_id,
    null,
    new.title,
    jsonb_build_object(
      'spot_id',new.spot_id,
      'request_type',new.request_type,
      'status',new.status,
      'intent',new.intent,
      'plan',new.plan,
      'decision_context',new.decision_context,
      'updated_at',new.updated_at
    ),
    'database',
    'business_requests',
    new.id::text,
    v_scope,
    v_scope
  );

  perform public.clouva_link_knowledge_owner(v_entity_id, v_owner_user_id, 'works_on', v_studio_id);

  select e.id into v_spot_entity_id
  from public.ai_knowledge_entities e
  where e.canonical_source_table='commerce_spots'
    and e.canonical_source_id=new.spot_id::text
    and e.status='active'
  limit 1;

  if v_spot_entity_id is not null then
    insert into public.ai_knowledge_relations (
      source_entity_id, relation_type, target_entity_id, owner_user_id,
      studio_id, source, scope, visibility, status, is_inferred, confidence, updated_at
    ) values (
      v_entity_id, 'belongs_to', v_spot_entity_id, v_owner_user_id,
      v_studio_id, 'database', v_scope, v_scope, 'active', false, 1.0, now()
    )
    on conflict (source_entity_id, relation_type, target_entity_id, source)
    do update set status='active', updated_at=now();
  end if;

  return new;
end;
$$;

create or replace function public.clouva_archive_business_request_knowledge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_knowledge_entities
  set status='archived', updated_at=now()
  where canonical_source_table='business_requests'
    and canonical_source_id=old.id::text;
  return old;
end;
$$;

drop trigger if exists business_request_knowledge_sync on public.business_requests;
create trigger business_request_knowledge_sync
after insert or update on public.business_requests
for each row execute function public.clouva_sync_business_request_knowledge();

drop trigger if exists business_request_knowledge_archive on public.business_requests;
create trigger business_request_knowledge_archive
after delete on public.business_requests
for each row execute function public.clouva_archive_business_request_knowledge();

insert into public.ai_knowledge_procedures (
  procedure_key,title,summary,steps,triggers,source,scope,visibility,status,metadata
) values (
  'business_sourcing',
  'Conseguir un producto para un negocio',
  'Flujo canónico de Business Player para convertir una foto, mensaje o pedido en una compra operable dentro del Spot.',
  '[{"order":1,"key":"brief","label":"Pedido"},{"order":2,"key":"understand","label":"Entender producto"},{"order":3,"key":"source","label":"Buscar opciones"},{"order":4,"key":"compare","label":"Comparar"},{"order":5,"key":"decision","label":"Elegir"},{"order":6,"key":"purchase","label":"Compra"},{"order":7,"key":"logistics","label":"Envío"},{"order":8,"key":"inventory","label":"Recepción / inventario"},{"order":9,"key":"listing","label":"Publicación / venta"}]'::jsonb,
  array['conseguir producto','buscar proveedor','buscar ropa','comprar stock','mayorista','sourcing','reventa'],
  'system','platform','platform','active',
  jsonb_build_object('domain','business','surface','mi_spot','executor','business_player')
)
on conflict (procedure_key,owner_user_id,studio_id) do update
set title=excluded.title,
    summary=excluded.summary,
    steps=excluded.steps,
    triggers=excluded.triggers,
    metadata=excluded.metadata,
    status='active',
    updated_at=now();
