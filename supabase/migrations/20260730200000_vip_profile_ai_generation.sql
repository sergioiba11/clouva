-- CLOUVA AI Profile (VIP): job orchestration + versioned Player profiles.
-- Fase 5 of the identity-flow plan -- schema and access control only, no
-- generation logic yet. Reuses the existing ai_image_budgets ledger
-- (20260729233900_ai_image_budget_ledger.sql) and players/user_entitlements
-- model (20260729170000_players_entitlements_core.sql) rather than
-- duplicating either.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.vip_profile_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  entitlement_id uuid references public.user_entitlements(id),
  status text not null default 'queued' check (status in (
    'queued', 'preparing_identity', 'analyzing_identity', 'generating_copy',
    'generating_assets', 'assembling_profile', 'review_ready', 'published',
    'failed', 'blocked_budget', 'needs_user_input', 'cancelled'
  )),
  identity_brief jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  selected_template text,
  generated_copy jsonb not null default '{}'::jsonb,
  generated_assets jsonb not null default '[]'::jsonb,
  estimated_cost_usd numeric(10,4) not null default 0,
  actual_cost_usd numeric(10,4),
  attempts integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vip_profile_generation_jobs_user_idx on public.vip_profile_generation_jobs(user_id);
create index vip_profile_generation_jobs_player_idx on public.vip_profile_generation_jobs(player_id);
create index vip_profile_generation_jobs_status_idx on public.vip_profile_generation_jobs(status);
-- At most one job actively in flight per Player at a time -- the orchestrator
-- checks this before enqueuing (double-click / refresh safety).
create unique index vip_profile_generation_jobs_one_active_per_player
  on public.vip_profile_generation_jobs(player_id)
  where status not in ('review_ready', 'published', 'failed', 'blocked_budget', 'cancelled');

create table public.player_profile_versions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  generation_job_id uuid references public.vip_profile_generation_jobs(id) on delete set null,
  version_number integer not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),
  profile_level text not null check (profile_level in ('basic', 'vip')),
  template_key text,
  layout_config jsonb not null default '{}'::jsonb,
  copy_config jsonb not null default '{}'::jsonb,
  visual_config jsonb not null default '{}'::jsonb,
  asset_references jsonb not null default '[]'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (player_id, version_number)
);

create index player_profile_versions_player_idx on public.player_profile_versions(player_id);
create index player_profile_versions_job_idx on public.player_profile_versions(generation_job_id);
-- Enforces "solo una versión publicada por Player" at the data layer, not just
-- in application logic -- the publish action must un-publish the previous one
-- in the same transaction or this index rejects the insert/update.
create unique index player_profile_versions_one_published_per_player
  on public.player_profile_versions(player_id)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- updated_at trigger (jobs table only -- versions are immutable snapshots
-- once created; a new edit creates a new draft version instead of mutating
-- a past one, so it has no updated_at column by design)
-- ---------------------------------------------------------------------------

create or replace function public.touch_vip_profile_generation_jobs_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_vip_profile_generation_jobs_updated_at() from public;

create trigger vip_profile_generation_jobs_touch_updated_at
  before update on public.vip_profile_generation_jobs
  for each row execute function public.touch_vip_profile_generation_jobs_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.vip_profile_generation_jobs enable row level security;

-- Read-only from the client (owner/manager/editor of the Player, or admin).
-- All writes happen server-side with the service role as part of the
-- orchestration steps (prompts, budget reservation, Gemini calls) -- never a
-- direct client insert/update, same pattern as ai_image_generation_jobs.
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
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy vip_profile_generation_jobs_admin_write
  on public.vip_profile_generation_jobs for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

alter table public.player_profile_versions enable row level security;

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
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy player_profile_versions_admin_write
  on public.player_profile_versions for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
