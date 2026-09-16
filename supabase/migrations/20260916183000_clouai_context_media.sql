-- CLOUVA AI multimedia: persistent visual context + Google Cloud generation metadata.
-- Reuses media_generation_jobs as the canonical job ledger instead of creating a parallel generator.

create table if not exists public.clouai_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  instructions text not null default '',
  tags text[] not null default '{}',
  summary_json jsonb not null default '{}'::jsonb,
  summary_state text not null default 'stale' check (summary_state in ('stale','ready','failed')),
  summary_model text,
  summary_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clouai_context_assets (
  id uuid primary key default gen_random_uuid(),
  context_id uuid not null references public.clouai_contexts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'image',
  name text not null,
  storage_path text not null,
  public_url text,
  mime_type text not null,
  width integer,
  height integer,
  byte_size bigint,
  position integer not null default 0,
  priority integer not null default 0,
  is_primary boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (context_id, storage_path)
);

create table if not exists public.clouai_generation_outputs (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.media_generation_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  output_type text not null check (output_type in ('image','video','thumbnail')),
  storage_path text not null,
  public_url text,
  mime_type text,
  width integer,
  height integer,
  duration_seconds integer,
  library_bucket text,
  library_path text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.media_generation_jobs
  add column if not exists provider text not null default 'google-cloud',
  add column if not exists conversation_id uuid references public.ai_conversations(id) on delete set null,
  add column if not exists enriched_prompt text,
  add column if not exists context_ids uuid[] not null default '{}',
  add column if not exists active_reference_ids uuid[] not null default '{}',
  add column if not exists settings_json jsonb not null default '{}'::jsonb,
  add column if not exists audio_enabled boolean not null default false,
  add column if not exists quantity integer not null default 1,
  add column if not exists resolution text;

alter table public.media_generation_jobs drop constraint if exists media_generation_jobs_status_check;
alter table public.media_generation_jobs add constraint media_generation_jobs_status_check
  check (status in ('queued','preparing_context','submitted','generating','processing','saving','storage_failed','completed','failed','cancelled'));

alter table public.media_generation_jobs drop constraint if exists media_generation_jobs_quantity_check;
alter table public.media_generation_jobs add constraint media_generation_jobs_quantity_check check (quantity between 1 and 4);

create index if not exists clouai_contexts_user_updated_idx on public.clouai_contexts(user_id, updated_at desc);
create index if not exists clouai_context_assets_context_position_idx on public.clouai_context_assets(context_id, is_primary desc, priority desc, position asc, created_at asc);
create index if not exists clouai_generation_outputs_generation_idx on public.clouai_generation_outputs(generation_id, created_at asc);
create index if not exists media_generation_jobs_context_ids_gin on public.media_generation_jobs using gin(context_ids);

alter table public.clouai_contexts enable row level security;
alter table public.clouai_context_assets enable row level security;
alter table public.clouai_generation_outputs enable row level security;

drop policy if exists clouai_contexts_select_own on public.clouai_contexts;
create policy clouai_contexts_select_own on public.clouai_contexts for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists clouai_contexts_insert_own on public.clouai_contexts;
create policy clouai_contexts_insert_own on public.clouai_contexts for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists clouai_contexts_update_own on public.clouai_contexts;
create policy clouai_contexts_update_own on public.clouai_contexts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists clouai_contexts_delete_own on public.clouai_contexts;
create policy clouai_contexts_delete_own on public.clouai_contexts for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists clouai_context_assets_select_own on public.clouai_context_assets;
create policy clouai_context_assets_select_own on public.clouai_context_assets for select to authenticated
  using ((select auth.uid()) = user_id and exists (
    select 1 from public.clouai_contexts c where c.id = context_id and c.user_id = (select auth.uid())
  ));
drop policy if exists clouai_context_assets_insert_own on public.clouai_context_assets;
create policy clouai_context_assets_insert_own on public.clouai_context_assets for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.clouai_contexts c where c.id = context_id and c.user_id = (select auth.uid())
  ));
drop policy if exists clouai_context_assets_update_own on public.clouai_context_assets;
create policy clouai_context_assets_update_own on public.clouai_context_assets for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists clouai_context_assets_delete_own on public.clouai_context_assets;
create policy clouai_context_assets_delete_own on public.clouai_context_assets for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists clouai_generation_outputs_select_own on public.clouai_generation_outputs;
create policy clouai_generation_outputs_select_own on public.clouai_generation_outputs for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.clouai_contexts is 'Persistent CLOUVA AI context packs; manual instructions are authoritative over generated summaries.';
comment on column public.media_generation_jobs.active_reference_ids is 'Exact context asset IDs sent to the provider for reproducibility; the full context remains represented by context_ids and enriched_prompt.';
