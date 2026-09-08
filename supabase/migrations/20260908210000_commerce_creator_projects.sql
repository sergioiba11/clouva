begin;

create table if not exists public.commerce_creator_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_type text not null default 'user' check (owner_type in ('player','studio','user','clouva')),
  player_id uuid references public.players(id) on delete set null,
  studio_id uuid references public.studios(id) on delete set null,
  spot_id uuid references public.commerce_spots(id) on delete set null,
  name text not null,
  collection_name text,
  category text,
  product_template text,
  creative_mode text not null default 'from_scratch' check (creative_mode in ('from_scratch','exact_design','reference')),
  brief text,
  source_type text,
  source_ref text,
  status text not null default 'draft' check (status in ('draft','generating','review','approved','commerce_ready')),
  design_system jsonb not null default '{}'::jsonb,
  reference_assets jsonb not null default '[]'::jsonb,
  generated_assets jsonb not null default '[]'::jsonb,
  approved_assets jsonb not null default '[]'::jsonb,
  commerce_draft jsonb not null default '{}'::jsonb,
  variants_draft jsonb not null default '[]'::jsonb,
  commerce_product_id uuid unique references public.commerce_products(id) on delete set null,
  clothing_item_id uuid references public.clothing_items(id) on delete set null,
  creator_3d_asset_id uuid references public.creator_3d_assets(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_creator_projects_owner_shape check (
    (owner_type = 'player' and player_id is not null and studio_id is null)
    or (owner_type = 'studio' and studio_id is not null and player_id is null)
    or (owner_type in ('user','clouva') and player_id is null and studio_id is null)
  )
);

create index if not exists commerce_creator_projects_user_updated_idx
  on public.commerce_creator_projects(user_id, updated_at desc);
create index if not exists commerce_creator_projects_status_idx
  on public.commerce_creator_projects(user_id, status, updated_at desc);

alter table public.commerce_creator_projects enable row level security;

grant select, insert, update, delete on public.commerce_creator_projects to authenticated;

create policy commerce_creator_projects_select_own
on public.commerce_creator_projects
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy commerce_creator_projects_insert_own
on public.commerce_creator_projects
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy commerce_creator_projects_update_own
on public.commerce_creator_projects
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy commerce_creator_projects_delete_own
on public.commerce_creator_projects
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Variants must follow the same canonical ownership rules as their parent
-- commerce_product. The previous policies covered Player/Studio only, while
-- commerce_products already supports user-owned products and Spot catalog roles.
drop policy if exists commerce_product_variants_write_owner_or_admin_insert on public.commerce_product_variants;
drop policy if exists commerce_product_variants_write_owner_or_admin_update on public.commerce_product_variants;
drop policy if exists commerce_product_variants_write_owner_or_admin_delete on public.commerce_product_variants;

create policy commerce_product_variants_write_owner_or_admin_insert
on public.commerce_product_variants
for insert
to authenticated
with check (
  exists (
    select 1
    from public.commerce_products p
    where p.id = commerce_product_variants.product_id
      and (
        exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and (pr.role)::text = 'admin')
        or ((p.owner_type = 'user') and p.owner_user_id = (select auth.uid()) and public.can_administer_spaces())
        or ((p.owner_type = 'player') and public.can_administer_spaces() and p.player_id is not null and (
          exists (select 1 from public.players pl where pl.id = p.player_id and pl.owner_user_id = (select auth.uid()))
          or exists (select 1 from public.player_members pm where pm.player_id = p.player_id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role in ('owner','manager','editor'))
        ))
        or ((p.owner_type = 'studio') and p.studio_id is not null and public.can_manage_studio(p.studio_id, (select auth.uid())) and (
          exists (select 1 from public.studios s where s.id = p.studio_id and s.owner_id = (select auth.uid()))
          or exists (select 1 from public.studio_members sm where sm.studio_id = p.studio_id and sm.profile_id = (select auth.uid()) and sm.status = 'active' and sm.role in ('owner','admin','manager','editor'))
        ))
        or (p.spot_id is not null and public.commerce_spot_can(p.spot_id, (select auth.uid()), 'catalog'))
      )
  )
);

create policy commerce_product_variants_write_owner_or_admin_update
on public.commerce_product_variants
for update
to authenticated
using (
  exists (
    select 1
    from public.commerce_products p
    where p.id = commerce_product_variants.product_id
      and (
        exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and (pr.role)::text = 'admin')
        or ((p.owner_type = 'user') and p.owner_user_id = (select auth.uid()) and public.can_administer_spaces())
        or ((p.owner_type = 'player') and public.can_administer_spaces() and p.player_id is not null and (
          exists (select 1 from public.players pl where pl.id = p.player_id and pl.owner_user_id = (select auth.uid()))
          or exists (select 1 from public.player_members pm where pm.player_id = p.player_id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role in ('owner','manager','editor'))
        ))
        or ((p.owner_type = 'studio') and p.studio_id is not null and public.can_manage_studio(p.studio_id, (select auth.uid())) and (
          exists (select 1 from public.studios s where s.id = p.studio_id and s.owner_id = (select auth.uid()))
          or exists (select 1 from public.studio_members sm where sm.studio_id = p.studio_id and sm.profile_id = (select auth.uid()) and sm.status = 'active' and sm.role in ('owner','admin','manager','editor'))
        ))
        or (p.spot_id is not null and public.commerce_spot_can(p.spot_id, (select auth.uid()), 'catalog'))
      )
  )
)
with check (
  exists (
    select 1
    from public.commerce_products p
    where p.id = commerce_product_variants.product_id
      and (
        exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and (pr.role)::text = 'admin')
        or ((p.owner_type = 'user') and p.owner_user_id = (select auth.uid()) and public.can_administer_spaces())
        or ((p.owner_type = 'player') and public.can_administer_spaces() and p.player_id is not null and (
          exists (select 1 from public.players pl where pl.id = p.player_id and pl.owner_user_id = (select auth.uid()))
          or exists (select 1 from public.player_members pm where pm.player_id = p.player_id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role in ('owner','manager','editor'))
        ))
        or ((p.owner_type = 'studio') and p.studio_id is not null and public.can_manage_studio(p.studio_id, (select auth.uid())) and (
          exists (select 1 from public.studios s where s.id = p.studio_id and s.owner_id = (select auth.uid()))
          or exists (select 1 from public.studio_members sm where sm.studio_id = p.studio_id and sm.profile_id = (select auth.uid()) and sm.status = 'active' and sm.role in ('owner','admin','manager','editor'))
        ))
        or (p.spot_id is not null and public.commerce_spot_can(p.spot_id, (select auth.uid()), 'catalog'))
      )
  )
);

create policy commerce_product_variants_write_owner_or_admin_delete
on public.commerce_product_variants
for delete
to authenticated
using (
  exists (
    select 1
    from public.commerce_products p
    where p.id = commerce_product_variants.product_id
      and (
        exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and (pr.role)::text = 'admin')
        or ((p.owner_type = 'user') and p.owner_user_id = (select auth.uid()) and public.can_administer_spaces())
        or ((p.owner_type = 'player') and public.can_administer_spaces() and p.player_id is not null and (
          exists (select 1 from public.players pl where pl.id = p.player_id and pl.owner_user_id = (select auth.uid()))
          or exists (select 1 from public.player_members pm where pm.player_id = p.player_id and pm.user_id = (select auth.uid()) and pm.status = 'active' and pm.role in ('owner','manager','editor'))
        ))
        or ((p.owner_type = 'studio') and p.studio_id is not null and public.can_manage_studio(p.studio_id, (select auth.uid())) and (
          exists (select 1 from public.studios s where s.id = p.studio_id and s.owner_id = (select auth.uid()))
          or exists (select 1 from public.studio_members sm where sm.studio_id = p.studio_id and sm.profile_id = (select auth.uid()) and sm.status = 'active' and sm.role in ('owner','admin','manager','editor'))
        ))
        or (p.spot_id is not null and public.commerce_spot_can(p.spot_id, (select auth.uid()), 'catalog'))
      )
  )
);

commit;
