begin;

alter table public.commerce_product_publications
  drop constraint if exists commerce_product_publications_source_check;

alter table public.commerce_product_publications
  add constraint commerce_product_publications_source_check
  check (source in ('manual','auto_owner','auto_space','facebook_publisher'));

create table if not exists public.commerce_facebook_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'not_connected',
  facebook_user_id text,
  display_name text,
  encrypted_access_token jsonb,
  token_expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  last_verified_at timestamptz,
  attention_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_facebook_connections_status_check
    check (status in ('not_connected','connected','requires_attention','expired')),
  constraint commerce_facebook_connections_user_unique unique (user_id)
);

create table if not exists public.facebook_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  name text not null,
  type text not null,
  facebook_url text,
  facebook_id text,
  enabled boolean not null default true,
  last_published_at timestamptz,
  cooldown_minutes integer not null default 1440,
  notes text,
  encrypted_access_token jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facebook_destinations_type_check check (type in ('marketplace','group','page')),
  constraint facebook_destinations_cooldown_check check (cooldown_minutes between 0 and 43200)
);

create unique index if not exists facebook_destinations_identity_unique
  on public.facebook_destinations(
    user_id,
    spot_id,
    type,
    coalesce(facebook_id, ''),
    coalesce(facebook_url, '')
  );

create index if not exists facebook_destinations_spot_idx
  on public.facebook_destinations(user_id, spot_id, enabled, type);

create table if not exists public.publication_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  name text not null,
  title text,
  description text,
  price_override numeric,
  category text,
  condition text,
  location_text text,
  primary_image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_variants_price_check check (price_override is null or price_override >= 0)
);

create index if not exists publication_variants_product_idx
  on public.publication_variants(user_id, spot_id, product_id, active, updated_at desc);

create table if not exists public.publication_product_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  destination_id uuid not null references public.facebook_destinations(id) on delete cascade,
  variant_id uuid references public.publication_variants(id) on delete set null,
  enabled boolean not null default true,
  custom_text text,
  primary_image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  frequency_minutes integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_product_destinations_frequency_check
    check (frequency_minutes is null or frequency_minutes between 0 and 43200),
  constraint publication_product_destinations_unique unique(product_id, destination_id)
);

create index if not exists publication_product_destinations_lookup_idx
  on public.publication_product_destinations(user_id, spot_id, product_id, enabled);

create table if not exists public.publication_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  status text not null default 'draft',
  idempotency_key text not null,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  total_jobs integer not null default 0,
  published_jobs integer not null default 0,
  failed_jobs integer not null default 0,
  attention_jobs integer not null default 0,
  skipped_jobs integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_batches_status_check
    check (status in ('draft','queued','running','paused','completed','partial','failed','cancelled')),
  constraint publication_batches_counts_check
    check (
      total_jobs >= 0 and published_jobs >= 0 and failed_jobs >= 0
      and attention_jobs >= 0 and skipped_jobs >= 0
    ),
  constraint publication_batches_idempotency_unique unique(user_id, idempotency_key)
);

create index if not exists publication_batches_user_spot_idx
  on public.publication_batches(user_id, spot_id, created_at desc);

create index if not exists publication_batches_status_idx
  on public.publication_batches(status, scheduled_at, created_at);

create table if not exists public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.publication_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  product_id uuid not null references public.commerce_products(id) on delete cascade,
  channel text not null,
  destination_id uuid not null references public.facebook_destinations(id) on delete cascade,
  variant_id uuid references public.publication_variants(id) on delete set null,
  status text not null default 'queued',
  attempts integer not null default 0,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  published_url text,
  error_code text,
  error_message text,
  content_hash text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  intervention_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_jobs_channel_check
    check (channel in ('facebook_marketplace','facebook_group','facebook_page')),
  constraint publication_jobs_status_check
    check (status in (
      'queued','opening','filling','uploading_media','waiting_confirmation',
      'publishing','published','retrying','failed','skipped'
    )),
  constraint publication_jobs_attempts_check check (attempts >= 0),
  constraint publication_jobs_idempotency_unique unique(user_id, idempotency_key)
);

create index if not exists publication_jobs_batch_idx
  on public.publication_jobs(batch_id, created_at, status);

create index if not exists publication_jobs_queue_idx
  on public.publication_jobs(status, scheduled_at, created_at)
  where status in ('queued','retrying');

create index if not exists publication_jobs_dedupe_idx
  on public.publication_jobs(user_id, product_id, destination_id, content_hash, completed_at desc);

create table if not exists public.publication_audit_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  spot_id uuid not null references public.commerce_spots(id) on delete cascade,
  batch_id uuid references public.publication_batches(id) on delete set null,
  job_id uuid references public.publication_jobs(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists publication_audit_log_owner_idx
  on public.publication_audit_log(user_id, spot_id, created_at desc);

alter table public.commerce_facebook_connections enable row level security;
alter table public.facebook_destinations enable row level security;
alter table public.publication_variants enable row level security;
alter table public.publication_product_destinations enable row level security;
alter table public.publication_batches enable row level security;
alter table public.publication_jobs enable row level security;
alter table public.publication_audit_log enable row level security;

revoke all on table public.commerce_facebook_connections from anon, authenticated;
revoke all on table public.facebook_destinations from anon, authenticated;
revoke all on table public.publication_variants from anon, authenticated;
revoke all on table public.publication_product_destinations from anon, authenticated;
revoke all on table public.publication_audit_log from anon, authenticated;

grant select on table public.publication_batches to authenticated;
grant select on table public.publication_jobs to authenticated;

drop policy if exists publication_batches_owner_select on public.publication_batches;
create policy publication_batches_owner_select
  on public.publication_batches for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists publication_jobs_owner_select on public.publication_jobs;
create policy publication_jobs_owner_select
  on public.publication_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

alter table public.publication_batches replica identity full;
alter table public.publication_jobs replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
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
  end if;
end $$;

insert into public.facebook_destinations(
  user_id, spot_id, name, type, facebook_url, facebook_id, enabled, cooldown_minutes, metadata
)
select distinct
  cpp.created_by_user_id,
  cp.spot_id,
  case
    when cpp.channel = 'facebook_marketplace' then 'Facebook Marketplace'
    else coalesce(nullif(cpp.destination_label, ''), 'Grupo de Facebook')
  end,
  case when cpp.channel = 'facebook_marketplace' then 'marketplace' else 'group' end,
  coalesce(
    nullif(cpp.destination_url, ''),
    case when cpp.channel = 'facebook_marketplace'
      then 'https://www.facebook.com/marketplace/create/item'
      else null
    end
  ),
  case
    when cpp.channel = 'facebook_marketplace' then 'marketplace'
    else nullif(cpp.destination_key, '')
  end,
  true,
  1440,
  jsonb_build_object('backfilled_from', 'commerce_product_publications')
from public.commerce_product_publications cpp
join public.commerce_products cp on cp.id = cpp.product_id
where cpp.channel in ('facebook_marketplace','facebook_group')
  and cpp.created_by_user_id is not null
  and cp.spot_id is not null
on conflict do nothing;

insert into public.publication_product_destinations(
  user_id, spot_id, product_id, destination_id, enabled, custom_text, metadata
)
select
  cpp.created_by_user_id,
  cp.spot_id,
  cpp.product_id,
  fd.id,
  true,
  nullif(cpp.channel_description, ''),
  jsonb_build_object('backfilled_from', 'commerce_product_publications', 'publication_id', cpp.id)
from public.commerce_product_publications cpp
join public.commerce_products cp on cp.id = cpp.product_id
join public.facebook_destinations fd
  on fd.user_id = cpp.created_by_user_id
 and fd.spot_id = cp.spot_id
 and fd.type = case when cpp.channel = 'facebook_marketplace' then 'marketplace' else 'group' end
 and (
   (cpp.channel = 'facebook_marketplace' and fd.facebook_id = 'marketplace')
   or
   (cpp.channel = 'facebook_group' and (
     (fd.facebook_url is not null and fd.facebook_url = cpp.destination_url)
     or (fd.facebook_id is not null and fd.facebook_id = cpp.destination_key)
   ))
 )
where cpp.channel in ('facebook_marketplace','facebook_group')
  and cpp.created_by_user_id is not null
  and cp.spot_id is not null
on conflict (product_id, destination_id) do nothing;

commit;
