-- Safe sync with production profiles schema (role remains source of truth)

alter table if exists public.profiles
  add column if not exists email text,
  add column if not exists full_name text,
  add column if not exists avatar_url text,
  add column if not exists phone text,
  add column if not exists username text,
  add column if not exists clouva_id text,
  add column if not exists is_vip boolean not null default false,
  add column if not exists is_blocked boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_profiles_username_unique on public.profiles(username) where username is not null;
create unique index if not exists idx_profiles_clouva_id_unique on public.profiles(clouva_id) where clouva_id is not null;

update public.profiles
set clouva_id = coalesce(clouva_id, 'CLV-' || substr(replace(id::text,'-',''),1,10))
where clouva_id is null;
