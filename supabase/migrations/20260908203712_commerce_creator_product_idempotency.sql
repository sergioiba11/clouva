alter table public.commerce_products
  add column if not exists creator_project_id uuid references public.commerce_creator_projects(id) on delete set null;

create unique index if not exists commerce_products_creator_project_unique
  on public.commerce_products(creator_project_id)
  where creator_project_id is not null;

create index if not exists commerce_products_creator_project_idx
  on public.commerce_products(creator_project_id)
  where creator_project_id is not null;
