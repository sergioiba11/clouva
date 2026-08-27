create table if not exists public.creator_3d_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (char_length(slug) between 1 and 120),
  kind text not null check (kind in ('object', 'accessory')),
  category text not null,
  preset_key text,
  status text not null default 'generating' check (status in ('draft', 'generating', 'ready', 'failed', 'archived')),
  source_sheet_storage_path text,
  source_sheet_url text,
  reference_order jsonb not null default '["front","back","side"]'::jsonb,
  reference_paths jsonb not null default '{}'::jsonb,
  reference_urls jsonb not null default '{}'::jsonb,
  split_metadata jsonb not null default '{}'::jsonb,
  meshy_task_id text,
  meshy_config jsonb not null default '{}'::jsonb,
  model_url text,
  storage_path text,
  preview_image_url text,
  attachment_profile jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (user_id, meshy_task_id)
);

create index if not exists creator_3d_assets_user_created_idx
  on public.creator_3d_assets (user_id, created_at desc);

create index if not exists creator_3d_assets_user_status_idx
  on public.creator_3d_assets (user_id, status);

create index if not exists creator_3d_assets_preset_idx
  on public.creator_3d_assets (preset_key)
  where preset_key is not null;

create or replace function public.touch_creator_3d_assets_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_creator_3d_assets_updated_at() from public;

drop trigger if exists creator_3d_assets_touch_updated_at on public.creator_3d_assets;
create trigger creator_3d_assets_touch_updated_at
before update on public.creator_3d_assets
for each row execute function public.touch_creator_3d_assets_updated_at();

alter table public.creator_3d_assets enable row level security;

revoke all on table public.creator_3d_assets from anon;
revoke all on table public.creator_3d_assets from authenticated;
grant select on table public.creator_3d_assets to authenticated;
grant all on table public.creator_3d_assets to service_role;

drop policy if exists creator_3d_assets_select_own_or_admin on public.creator_3d_assets;
create policy creator_3d_assets_select_own_or_admin
on public.creator_3d_assets
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select private.is_clouva_admin())
);

comment on table public.creator_3d_assets is
  'Canonical CLOUVA 3D objects/accessories generated from one precise 3-view reference sheet.';
