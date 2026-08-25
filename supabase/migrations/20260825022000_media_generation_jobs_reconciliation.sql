-- Reconcile the generic media job table already present remotely and add a
-- separate, conservative budget for confirmed Trébol image generations.

create table if not exists public.media_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 96),
  type text not null check (type in ('image', 'video')),
  source_mode text not null default 'text' check (source_mode in ('text', 'reference')),
  status text not null default 'queued' check (status in (
    'queued', 'generating', 'processing', 'saving', 'storage_failed',
    'completed', 'failed', 'cancelled'
  )),
  prompt text not null check (char_length(prompt) between 1 and 4000),
  negative_prompt text,
  model text not null,
  aspect_ratio text not null,
  quality text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds in (4, 6, 8)),
  reference_storage_path text,
  reference_url text,
  output_storage_path text,
  output_url text,
  mime_type text,
  operation_id text,
  provider_metadata jsonb not null default '{}'::jsonb,
  usage_metadata jsonb not null default '{}'::jsonb,
  estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  actual_cost_usd numeric check (actual_cost_usd is null or actual_cost_usd >= 0),
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists media_generation_jobs_user_created_idx
  on public.media_generation_jobs (user_id, created_at desc);
create index if not exists media_generation_jobs_active_idx
  on public.media_generation_jobs (user_id, status)
  where status in ('queued', 'generating', 'processing', 'saving');
create index if not exists media_generation_jobs_operation_idx
  on public.media_generation_jobs (operation_id)
  where operation_id is not null;

alter table public.media_generation_jobs enable row level security;
drop policy if exists media_generation_jobs_select_own_or_admin on public.media_generation_jobs;
create policy media_generation_jobs_select_own_or_admin
  on public.media_generation_jobs for select
  to authenticated
  using ((select auth.uid()) = user_id or (select private.is_clouva_admin()));

revoke all on public.media_generation_jobs from public, anon, authenticated;
grant select on public.media_generation_jobs to authenticated;
grant all on public.media_generation_jobs to service_role;

insert into public.ai_image_budgets (
  scope, currency, hard_limit_usd, normal_limit_usd, reserve_limit_usd,
  spent_usd, reserved_usd, status
) values ('trebol_media_2026', 'USD', 5, 4.5, 0.5, 0, 0, 'active')
on conflict (scope) do nothing;
