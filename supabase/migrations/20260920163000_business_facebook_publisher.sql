begin;

create table if not exists public.facebook_connections (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'not_connected'
    check (status in ('not_connected','connected','attention_required','expired')),
  facebook_user_id text,
  facebook_name text,
  access_token_ciphertext text,
  access_token_iv text,
  access_token_auth_tag text,
  token_key_version text,
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (spot_id, user_id)
);

create table if not exists public.facebook_destinations (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('marketplace','group','page')),
  facebook_url text,
  facebook_id text,
  enabled boolean not null default true,
  last_published_at timestamptz,
  cooldown_minutes integer not null default 0 check (cooldown_minutes >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists facebook_destinations_identity_unique
  on public.facebook_destinations(
    spot_id,
    user_id,
    type,
    coalesce(facebook_id, ''),
    coalesce(facebook_url, '')
  );

create index if not exists facebook_destinations_spot_enabled_idx
  on public.facebook_destinations(spot_id, user_id, enabled, type);

create table if not exists public.facebook_page_credentials (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  destination_id uuid not null references public.facebook_destinations(id) on delete cascade,
  page_id text not null,
  page_name text,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_auth_tag text not null,
  token_key_version text not null,
  tasks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (destination_id, user_id)
);

create table if not exists public.publication_variants (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  name text not null,
  title text,
  description text,
  price_override numeric,
  currency text,
  primary_image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  content_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publication_variants_product_idx
  on public.publication_variants(product_id, user_id, active, updated_at desc);

create table if not exists public.facebook_product_destinations (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  destination_id uuid not null references public.facebook_destinations(id) on delete cascade,
  publication_variant_id uuid references public.publication_variants(id) on delete set null,
  enabled boolean not null default true,
  custom_text text,
  primary_image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, destination_id)
);

create index if not exists facebook_product_destinations_product_idx
  on public.facebook_product_destinations(spot_id, user_id, product_id, enabled);

create table if not exists public.publication_batches (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft','queued','running','paused','completed','partial','failed','cancelled')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  total_jobs integer not null default 0,
  published_jobs integer not null default 0,
  failed_jobs integer not null default 0,
  attention_jobs integer not null default 0,
  skipped_jobs integer not null default 0,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, spot_id, idempotency_key)
);

create index if not exists publication_batches_spot_status_idx
  on public.publication_batches(spot_id, user_id, status, created_at desc);

create table if not exists public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.publication_batches(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  publication_variant_id uuid references public.publication_variants(id) on delete set null,
  destination_id uuid not null references public.facebook_destinations(id) on delete cascade,
  channel text not null check (channel in ('facebook_marketplace','facebook_group','facebook_page')),
  status text not null default 'queued'
    check (status in ('queued','opening','filling','uploading_media','waiting_confirmation','publishing','published','retrying','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  published_url text,
  external_id text,
  error_code text,
  error_message text,
  content_hash text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publication_jobs_batch_status_idx
  on public.publication_jobs(batch_id, status, scheduled_at, created_at);

create index if not exists publication_jobs_dedupe_lookup_idx
  on public.publication_jobs(product_id, destination_id, content_hash, status, completed_at desc);

create table if not exists public.publication_audit_log (
  id bigint generated always as identity primary key,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid references public.publication_batches(id) on delete set null,
  job_id uuid references public.publication_jobs(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists publication_audit_log_spot_idx
  on public.publication_audit_log(spot_id, user_id, created_at desc);

alter table public.facebook_connections enable row level security;
alter table public.facebook_destinations enable row level security;
alter table public.facebook_page_credentials enable row level security;
alter table public.publication_variants enable row level security;
alter table public.facebook_product_destinations enable row level security;
alter table public.publication_batches enable row level security;
alter table public.publication_jobs enable row level security;
alter table public.publication_audit_log enable row level security;

grant select on public.facebook_connections to authenticated;
grant select on public.facebook_destinations to authenticated;
grant select on public.publication_variants to authenticated;
grant select on public.facebook_product_destinations to authenticated;
grant select on public.publication_batches to authenticated;
grant select on public.publication_jobs to authenticated;
grant select on public.publication_audit_log to authenticated;

drop policy if exists facebook_connections_owner_select on public.facebook_connections;
create policy facebook_connections_owner_select on public.facebook_connections
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists facebook_destinations_owner_select on public.facebook_destinations;
create policy facebook_destinations_owner_select on public.facebook_destinations
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists publication_variants_owner_select on public.publication_variants;
create policy publication_variants_owner_select on public.publication_variants
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists facebook_product_destinations_owner_select on public.facebook_product_destinations;
create policy facebook_product_destinations_owner_select on public.facebook_product_destinations
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists publication_batches_owner_select on public.publication_batches;
create policy publication_batches_owner_select on public.publication_batches
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists publication_jobs_owner_select on public.publication_jobs;
create policy publication_jobs_owner_select on public.publication_jobs
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists publication_audit_log_owner_select on public.publication_audit_log;
create policy publication_audit_log_owner_select on public.publication_audit_log
for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.claim_next_publication_job(p_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_batch public.publication_batches%rowtype;
  v_job public.publication_jobs%rowtype;
begin
  select * into v_batch
  from public.publication_batches
  where id = p_batch_id
  for update;

  if not found then
    return null;
  end if;

  if v_batch.status in ('paused','cancelled','completed','failed') then
    return null;
  end if;

  update public.publication_batches
  set
    status = 'running',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = p_batch_id;

  select * into v_job
  from public.publication_jobs
  where batch_id = p_batch_id
    and status in ('queued','retrying')
    and scheduled_at <= now()
  order by scheduled_at, created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.publication_jobs
  set
    status = 'opening',
    attempts = attempts + 1,
    started_at = coalesce(started_at, now()),
    error_code = null,
    error_message = null,
    updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return to_jsonb(v_job);
end;
$function$;

revoke all on function public.claim_next_publication_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_next_publication_job(uuid) to service_role;

do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'publication_batches'
  ) then
    alter publication supabase_realtime add table public.publication_batches;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'publication_jobs'
  ) then
    alter publication supabase_realtime add table public.publication_jobs;
  end if;
end
$do$;

commit;
