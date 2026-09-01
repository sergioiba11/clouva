-- CLOUVA AI intelligence pipeline
--
-- Evolves project_events into a versioned domain-event/outbox contract without
-- turning project_memory into a copy of structured domain data. Player/profile
-- truth stays in canonical tables; these events record what happened and what
-- context was supplied to CLOUVA AI.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- project_events: versioned event/outbox contract
-- ---------------------------------------------------------------------------

alter table public.project_events
  add column if not exists schema_version integer not null default 1,
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists studio_id uuid references public.studios(id) on delete cascade,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists source text not null default 'application',
  add column if not exists scope text not null default 'private',
  add column if not exists visibility text not null default 'private',
  add column if not exists context_eligible boolean not null default true,
  add column if not exists knowledge_eligible boolean not null default false,
  add column if not exists training_eligible boolean not null default false,
  add column if not exists idempotency_key text,
  add column if not exists occurred_at timestamptz not null default now(),
  add column if not exists processing_status text not null default 'pending',
  add column if not exists processed_at timestamptz,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text;

alter table public.project_events drop constraint if exists project_events_schema_version_check;
alter table public.project_events
  add constraint project_events_schema_version_check check (schema_version >= 1);

alter table public.project_events drop constraint if exists project_events_scope_check;
alter table public.project_events
  add constraint project_events_scope_check check (scope in ('private', 'studio', 'platform', 'public'));

alter table public.project_events drop constraint if exists project_events_visibility_check;
alter table public.project_events
  add constraint project_events_visibility_check check (visibility in ('private', 'studio', 'platform', 'public'));

alter table public.project_events drop constraint if exists project_events_processing_status_check;
alter table public.project_events
  add constraint project_events_processing_status_check check (processing_status in ('pending', 'processing', 'processed', 'failed'));

alter table public.project_events drop constraint if exists project_events_attempts_check;
alter table public.project_events
  add constraint project_events_attempts_check check (attempts >= 0);

-- Existing rows are historical activity records. Keep them readable by the
-- Orchestrator, but do not replay them through the new ingestion worker.
update public.project_events
set actor_user_id = coalesce(actor_user_id, user_id),
    source = case when source = 'application' then 'legacy' else source end,
    occurred_at = coalesce(occurred_at, created_at),
    processing_status = 'processed',
    processed_at = coalesce(processed_at, created_at)
where entity_type is null
  and idempotency_key is null;

create unique index if not exists project_events_user_idempotency_idx
  on public.project_events(user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists project_events_ingestion_idx
  on public.project_events(processing_status, occurred_at)
  where processing_status in ('pending', 'failed');

create index if not exists project_events_entity_idx
  on public.project_events(entity_type, entity_id, occurred_at desc)
  where entity_type is not null and entity_id is not null;

create index if not exists project_events_studio_idx
  on public.project_events(studio_id, occurred_at desc)
  where studio_id is not null;

-- Users may read their own events (and Studio events for Studios they actively
-- participate in). They may still insert ordinary personal events used by the
-- existing CLOUVA AI flow, but cannot self-mark records as trainable, curated,
-- processed, or platform knowledge.
drop policy if exists "users manage own project events" on public.project_events;
drop policy if exists project_events_select on public.project_events;
drop policy if exists project_events_insert on public.project_events;
drop policy if exists project_events_update on public.project_events;
drop policy if exists project_events_delete on public.project_events;

create policy project_events_select
  on public.project_events for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      studio_id is not null
      and public.is_active_studio_participant(studio_id, (select auth.uid()))
    )
  );

create policy project_events_insert
  on public.project_events for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and coalesce(actor_user_id, user_id) = user_id
    and scope = 'private'
    and visibility = 'private'
    and knowledge_eligible = false
    and training_eligible = false
    and processing_status = 'pending'
    and processed_at is null
    and attempts = 0
  );

revoke update, delete on public.project_events from authenticated;
grant select, insert on public.project_events to authenticated;
grant select, insert, update, delete on public.project_events to service_role;

-- ---------------------------------------------------------------------------
-- Knowledge + Dataset Manager core
-- ---------------------------------------------------------------------------

create table if not exists public.ai_knowledge_facts (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique references public.project_events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  scope text not null check (scope in ('private', 'studio', 'platform', 'public')),
  subject_type text not null,
  subject_id text not null,
  predicate text not null,
  value jsonb not null default '{}'::jsonb,
  is_inferred boolean not null default false,
  confidence numeric(4,3) not null default 1.0 check (confidence >= 0 and confidence <= 1),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  status text not null default 'active' check (status in ('active', 'superseded', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_knowledge_facts_subject_idx
  on public.ai_knowledge_facts(scope, subject_type, subject_id, predicate, status);
create index if not exists ai_knowledge_facts_user_idx
  on public.ai_knowledge_facts(user_id, status, updated_at desc)
  where user_id is not null;
create index if not exists ai_knowledge_facts_studio_idx
  on public.ai_knowledge_facts(studio_id, status, updated_at desc)
  where studio_id is not null;

create table if not exists public.ai_dataset_candidates (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid not null unique references public.project_events(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  task_type text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  metadata jsonb not null default '{}'::jsonb,
  scope text not null check (scope in ('private', 'studio', 'platform', 'public')),
  training_eligible boolean not null default false,
  quality_status text not null default 'pending'
    check (quality_status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_dataset_candidates_review_idx
  on public.ai_dataset_candidates(quality_status, created_at desc);
create index if not exists ai_dataset_candidates_task_idx
  on public.ai_dataset_candidates(task_type, quality_status, created_at desc);

create table if not exists public.ai_datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  task_type text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.ai_datasets(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'frozen', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (dataset_id, version)
);

create table if not exists public.ai_dataset_examples (
  id uuid primary key default gen_random_uuid(),
  dataset_version_id uuid not null references public.ai_dataset_versions(id) on delete cascade,
  candidate_id uuid not null references public.ai_dataset_candidates(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (dataset_version_id, candidate_id)
);

alter table public.ai_knowledge_facts enable row level security;
alter table public.ai_dataset_candidates enable row level security;
alter table public.ai_datasets enable row level security;
alter table public.ai_dataset_versions enable row level security;
alter table public.ai_dataset_examples enable row level security;

-- These are internal intelligence assets, not user-editable product tables.
-- They are accessed through server-side/admin flows only for now.
revoke all on public.ai_knowledge_facts from public, anon, authenticated;
revoke all on public.ai_dataset_candidates from public, anon, authenticated;
revoke all on public.ai_datasets from public, anon, authenticated;
revoke all on public.ai_dataset_versions from public, anon, authenticated;
revoke all on public.ai_dataset_examples from public, anon, authenticated;

grant select, insert, update, delete on public.ai_knowledge_facts to service_role;
grant select, insert, update, delete on public.ai_dataset_candidates to service_role;
grant select, insert, update, delete on public.ai_datasets to service_role;
grant select, insert, update, delete on public.ai_dataset_versions to service_role;
grant select, insert, update, delete on public.ai_dataset_examples to service_role;

-- ---------------------------------------------------------------------------
-- Canonical event emitter
-- ---------------------------------------------------------------------------

create or replace function public.clouva_emit_project_event(
  p_user_id uuid,
  p_event_type text,
  p_component text,
  p_summary text,
  p_payload jsonb,
  p_entity_type text,
  p_entity_id text,
  p_source text,
  p_scope text,
  p_visibility text,
  p_context_eligible boolean,
  p_knowledge_eligible boolean,
  p_training_eligible boolean,
  p_idempotency_key text,
  p_studio_id uuid default null,
  p_schema_version integer default 1,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  insert into public.project_events (
    user_id,
    actor_user_id,
    project_key,
    event_type,
    schema_version,
    component,
    summary,
    payload,
    studio_id,
    entity_type,
    entity_id,
    source,
    scope,
    visibility,
    context_eligible,
    knowledge_eligible,
    training_eligible,
    idempotency_key,
    occurred_at,
    processing_status,
    attempts
  ) values (
    p_user_id,
    p_user_id,
    'clouva',
    p_event_type,
    p_schema_version,
    p_component,
    left(coalesce(p_summary, p_event_type), 1000),
    coalesce(p_payload, '{}'::jsonb),
    p_studio_id,
    p_entity_type,
    p_entity_id,
    p_source,
    p_scope,
    p_visibility,
    p_context_eligible,
    p_knowledge_eligible,
    p_training_eligible,
    p_idempotency_key,
    p_occurred_at,
    'pending',
    0
  )
  on conflict (user_id, idempotency_key) where idempotency_key is not null
  do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.clouva_emit_project_event(
  uuid,text,text,text,jsonb,text,text,text,text,text,boolean,boolean,boolean,text,uuid,integer,timestamptz
) from public, anon, authenticated;
grant execute on function public.clouva_emit_project_event(
  uuid,text,text,text,jsonb,text,text,text,text,text,boolean,boolean,boolean,text,uuid,integer,timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- Onboarding / Player domain events
-- ---------------------------------------------------------------------------

create or replace function public.clouva_profile_mode_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
begin
  if new.status <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'active' and old.activated_at is not distinct from new.activated_at
     and old.metadata is not distinct from new.metadata then
    return new;
  end if;

  v_source := coalesce(new.metadata ->> 'source', 'profile_modes');

  perform public.clouva_emit_project_event(
    new.user_id,
    'profile.mode.activated.v1',
    'identity',
    format('Modo activo del usuario: %s.', new.mode),
    jsonb_build_object('mode', new.mode, 'source', v_source),
    'profile_mode',
    new.mode,
    v_source,
    'private',
    'private',
    true,
    false,
    false,
    format('profile-mode:%s:%s:active', new.user_id, new.mode),
    null,
    1,
    coalesce(new.activated_at, now())
  );

  return new;
end;
$$;

create or replace function public.clouva_player_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_categories jsonb;
  v_disciplines jsonb;
  v_primary_role text;
  v_categories_text text;
  v_identity_hash text;
  v_identity_changed boolean := false;
begin
  if new.owner_user_id is null then
    return new;
  end if;

  v_row := to_jsonb(new);
  v_old := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_categories := coalesce(v_row -> 'professional_categories', '[]'::jsonb);
  v_disciplines := coalesce(v_row -> 'disciplines', '[]'::jsonb);
  v_primary_role := nullif(trim(coalesce(v_row ->> 'primary_role', '')), '');

  if jsonb_typeof(v_categories) = 'array' then
    select string_agg(value, ', ' order by ordinality)
      into v_categories_text
      from jsonb_array_elements_text(v_categories) with ordinality as category(value, ordinality);
  end if;

  if tg_op = 'INSERT' then
    perform public.clouva_emit_project_event(
      new.owner_user_id,
      'player.created.v1',
      'player',
      format('Player creado: %s.', coalesce(new.display_name, 'Player')),
      jsonb_build_object('player_id', new.id, 'publication_status', new.publication_status),
      'player',
      new.id::text,
      'players',
      'private',
      'private',
      true,
      false,
      false,
      format('player-created:%s', new.id),
      null,
      1,
      coalesce(new.created_at, now())
    );
    v_identity_changed := v_primary_role is not null
      or v_categories <> '[]'::jsonb
      or v_disciplines <> '[]'::jsonb;
  else
    v_identity_changed :=
      coalesce(v_old -> 'professional_categories', '[]'::jsonb) is distinct from v_categories
      or coalesce(v_old -> 'disciplines', '[]'::jsonb) is distinct from v_disciplines
      or nullif(trim(coalesce(v_old ->> 'primary_role', '')), '') is distinct from v_primary_role;
  end if;

  if v_identity_changed then
    v_identity_hash := encode(
      digest(
        concat_ws('|',
          new.id::text,
          coalesce(v_primary_role, ''),
          v_categories::text,
          v_disciplines::text
        ),
        'sha256'
      ),
      'hex'
    );

    perform public.clouva_emit_project_event(
      new.owner_user_id,
      'player.identity.updated.v1',
      'player',
      concat(
        'Identidad profesional actual del Player. Rol principal: ',
        coalesce(v_primary_role, 'sin definir'),
        '. Categorías: ',
        coalesce(nullif(v_categories_text, ''), 'sin categorías'),
        '.'
      ),
      jsonb_build_object(
        'player_id', new.id,
        'changed_fields', jsonb_build_array('professional_categories', 'disciplines', 'primary_role')
      ),
      'player',
      new.id::text,
      'players',
      'private',
      'private',
      true,
      false,
      false,
      format('player-identity:%s:%s', new.id, v_identity_hash),
      null,
      1,
      coalesce(new.updated_at, now())
    );
  end if;

  if tg_op = 'UPDATE' and old.is_published is distinct from new.is_published then
    perform public.clouva_emit_project_event(
      new.owner_user_id,
      case when new.is_published then 'player.published.v1' else 'player.unpublished.v1' end,
      'player',
      case when new.is_published then 'El Player fue publicado.' else 'El Player fue despublicado.' end,
      jsonb_build_object('player_id', new.id, 'publication_status', new.publication_status),
      'player',
      new.id::text,
      'players',
      'private',
      'private',
      true,
      false,
      false,
      format('player-publication:%s:%s:%s', new.id, new.is_published, coalesce(new.updated_at, now())::text),
      null,
      1,
      coalesce(new.updated_at, now())
    );
  end if;

  return new;
end;
$$;

drop trigger if exists clouva_profile_mode_event on public.profile_modes;
create trigger clouva_profile_mode_event
  after insert or update of status, activated_at, metadata
  on public.profile_modes
  for each row execute function public.clouva_profile_mode_event_trigger();

drop trigger if exists clouva_player_event on public.players;
create trigger clouva_player_event
  after insert or update
  on public.players
  for each row execute function public.clouva_player_event_trigger();

-- ---------------------------------------------------------------------------
-- Context snapshot supplied to CLOUVA AI
-- ---------------------------------------------------------------------------
-- The current Orchestrator already reads recent project_events immediately
-- after persisting the user's message. This trigger resolves a compact snapshot
-- from canonical profile_modes/players at that exact moment, so the next model
-- call knows the user's current CLOUVA identity without copying it into
-- project_memory and without requiring a second AI or a parallel chat route.

create or replace function public.clouva_ai_context_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modes jsonb := '[]'::jsonb;
  v_modes_text text;
  v_player public.players%rowtype;
  v_player_found boolean := false;
  v_player_json jsonb := '{}'::jsonb;
  v_categories jsonb := '[]'::jsonb;
  v_categories_text text;
  v_summary text;
begin
  if new.role <> 'user' then
    return new;
  end if;

  select coalesce(jsonb_agg(pm.mode order by pm.activated_at), '[]'::jsonb)
    into v_modes
    from public.profile_modes pm
    where pm.user_id = new.user_id
      and pm.status = 'active';

  select string_agg(value, ', ' order by ordinality)
    into v_modes_text
    from jsonb_array_elements_text(v_modes) with ordinality as mode(value, ordinality);

  select p.* into v_player
  from public.players p
  where p.owner_user_id = new.user_id
  order by p.created_at asc
  limit 1;

  v_player_found := found;

  if not v_player_found then
    select p.* into v_player
    from public.player_members pm
    join public.players p on p.id = pm.player_id
    where pm.user_id = new.user_id
      and pm.status = 'active'
      and pm.role in ('owner', 'manager', 'editor')
    order by pm.created_at asc
    limit 1;
    v_player_found := found;
  end if;

  if v_player_found then
    v_player_json := to_jsonb(v_player);
    v_categories := coalesce(v_player_json -> 'professional_categories', '[]'::jsonb);
    if jsonb_typeof(v_categories) = 'array' then
      select string_agg(value, ', ' order by ordinality)
        into v_categories_text
        from jsonb_array_elements_text(v_categories) with ordinality as category(value, ordinality);
    end if;
  end if;

  v_summary := concat(
    'Contexto personal canónico actual. Modos activos: ',
    coalesce(nullif(v_modes_text, ''), 'ninguno'),
    '. ',
    case
      when v_player_found then concat(
        'Player: ', coalesce(v_player.display_name, 'sin nombre'),
        '. Rol principal: ', coalesce(nullif(trim(coalesce(v_player_json ->> 'primary_role', '')), ''), 'sin definir'),
        '. Categorías: ', coalesce(nullif(v_categories_text, ''), 'sin categorías'),
        '. Publicado: ', case when v_player.is_published then 'sí' else 'no' end, '.'
      )
      else 'No hay un Player editable resuelto para este usuario.'
    end
  );

  perform public.clouva_emit_project_event(
    new.user_id,
    'ai.context.resolved.v1',
    'clouva-ai',
    v_summary,
    jsonb_build_object(
      'source_message_id', new.id,
      'modes', v_modes,
      'player', case when v_player_found then jsonb_build_object(
        'id', v_player.id,
        'display_name', v_player.display_name,
        'primary_role', v_player_json -> 'primary_role',
        'professional_categories', v_categories,
        'disciplines', coalesce(v_player_json -> 'disciplines', '[]'::jsonb),
        'is_published', v_player.is_published
      ) else null end
    ),
    'ai_message',
    new.id::text,
    'canonical_context',
    'private',
    'private',
    true,
    false,
    false,
    format('ai-context:%s', new.id),
    null,
    1,
    new.created_at
  );

  return new;
end;
$$;

drop trigger if exists clouva_ai_context_snapshot on public.ai_messages;
create trigger clouva_ai_context_snapshot
  after insert on public.ai_messages
  for each row
  when (new.role = 'user')
  execute function public.clouva_ai_context_snapshot_trigger();

-- Existing users do not need fabricated historical events: the context
-- snapshot is resolved from canonical tables on their next CLOUVA AI message.

-- Trigger functions are internal implementation details.
revoke all on function public.clouva_profile_mode_event_trigger() from public, anon, authenticated;
revoke all on function public.clouva_player_event_trigger() from public, anon, authenticated;
revoke all on function public.clouva_ai_context_snapshot_trigger() from public, anon, authenticated;
