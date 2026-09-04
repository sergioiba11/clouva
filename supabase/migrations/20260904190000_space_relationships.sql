create table if not exists public.space_relationships (
  id uuid primary key default gen_random_uuid(),
  source_space_id uuid not null references public.spaces(id) on delete cascade,
  target_space_id uuid not null references public.spaces(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('hosted_at','contains','operated_by','brand_of','partner_of')),
  status text not null default 'active' check (status in ('active','inactive','pending')),
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint space_relationships_distinct_spaces check (source_space_id <> target_space_id),
  constraint space_relationships_unique unique (source_space_id, target_space_id, relationship_type)
);

create index if not exists space_relationships_source_idx on public.space_relationships(source_space_id, status);
create index if not exists space_relationships_target_idx on public.space_relationships(target_space_id, status);

alter table public.space_relationships enable row level security;
revoke all on table public.space_relationships from anon, authenticated;
grant all on table public.space_relationships to service_role;

comment on table public.space_relationships is 'Canonical links between CLOUVA Spaces, e.g. a business hosted inside a Studio without changing either Space ownership.';
