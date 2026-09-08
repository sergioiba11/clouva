create table if not exists public.commerce_creator_product_concepts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.commerce_creator_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  product_template text not null default 'custom',
  role text not null default 'secondary' check (role in ('primary','secondary')),
  position integer not null default 0 check (position >= 0),
  status text not null default 'draft' check (status in ('draft','pending','generating','review','approved','commerce_ready','published','failed')),
  creative_config jsonb not null default '{}'::jsonb,
  design_overrides jsonb not null default '{}'::jsonb,
  reference_assets jsonb not null default '[]'::jsonb,
  generated_assets jsonb not null default '[]'::jsonb,
  approved_assets jsonb not null default '[]'::jsonb,
  commerce_draft jsonb not null default '{}'::jsonb,
  variants_draft jsonb not null default '[]'::jsonb,
  listing_copy jsonb not null default '{}'::jsonb,
  clothing_item_id uuid references public.clothing_items(id) on delete set null,
  creator_3d_asset_id uuid references public.creator_3d_assets(id) on delete set null,
  production_status text not null default 'not_started' check (production_status in ('not_started','preparing','ready')),
  production_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_creator_concepts_project_position_idx
  on public.commerce_creator_product_concepts(project_id, position, created_at);
create index if not exists commerce_creator_concepts_user_updated_idx
  on public.commerce_creator_product_concepts(user_id, updated_at desc);
create index if not exists commerce_creator_concepts_status_idx
  on public.commerce_creator_product_concepts(status);
create index if not exists commerce_creator_concepts_clothing_idx
  on public.commerce_creator_product_concepts(clothing_item_id)
  where clothing_item_id is not null;
create index if not exists commerce_creator_concepts_creator3d_idx
  on public.commerce_creator_product_concepts(creator_3d_asset_id)
  where creator_3d_asset_id is not null;

alter table public.commerce_creator_product_concepts enable row level security;

drop policy if exists commerce_creator_concepts_select_own on public.commerce_creator_product_concepts;
create policy commerce_creator_concepts_select_own
  on public.commerce_creator_product_concepts for select
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.commerce_creator_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists commerce_creator_concepts_insert_own on public.commerce_creator_product_concepts;
create policy commerce_creator_concepts_insert_own
  on public.commerce_creator_product_concepts for insert
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.commerce_creator_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists commerce_creator_concepts_update_own on public.commerce_creator_product_concepts;
create policy commerce_creator_concepts_update_own
  on public.commerce_creator_product_concepts for update
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.commerce_creator_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.commerce_creator_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists commerce_creator_concepts_delete_own on public.commerce_creator_product_concepts;
create policy commerce_creator_concepts_delete_own
  on public.commerce_creator_product_concepts for delete
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.commerce_creator_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

alter table public.commerce_products
  add column if not exists creator_concept_id uuid references public.commerce_creator_product_concepts(id) on delete set null;

drop index if exists public.commerce_products_creator_project_unique;
create index if not exists commerce_products_creator_project_idx
  on public.commerce_products(creator_project_id)
  where creator_project_id is not null;
create unique index if not exists commerce_products_creator_concept_unique
  on public.commerce_products(creator_concept_id)
  where creator_concept_id is not null;

insert into public.commerce_creator_product_concepts (
  project_id, user_id, name, product_template, role, position, status,
  creative_config, reference_assets, generated_assets, approved_assets,
  commerce_draft, variants_draft, clothing_item_id, creator_3d_asset_id, metadata
)
select
  p.id,
  p.user_id,
  p.name,
  coalesce(nullif(p.product_template,''), 'custom'),
  'primary',
  0,
  case when p.commerce_product_id is not null then 'commerce_ready' else 'draft' end,
  jsonb_build_object('legacy_project_product', true),
  p.reference_assets,
  p.generated_assets,
  p.approved_assets,
  p.commerce_draft,
  p.variants_draft,
  p.clothing_item_id,
  p.creator_3d_asset_id,
  jsonb_build_object('backfilled_from_project', true)
from public.commerce_creator_projects p
where p.commerce_product_id is not null
  and not exists (
    select 1 from public.commerce_creator_product_concepts c
    where c.project_id = p.id and c.role = 'primary'
  );

update public.commerce_products cp
set creator_concept_id = c.id
from public.commerce_creator_projects p
join public.commerce_creator_product_concepts c
  on c.project_id = p.id and c.role = 'primary'
where cp.id = p.commerce_product_id
  and cp.creator_concept_id is null;
