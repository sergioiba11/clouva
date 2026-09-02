-- CI-only baseline for validating the canonical Agenda migrations in isolation.
-- This file is NOT a production migration. It models only the canonical CLOUVA
-- entities that Agenda references, avoiding unrelated historical migration drift.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user'
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid unique references auth.users(id) on delete set null,
  display_name text,
  username text,
  profile_image_url text,
  cover_url text,
  accent_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_members (
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer',
  status text not null default 'active',
  primary key(player_id,user_id)
);

create table if not exists public.studios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  slug text not null unique,
  name text not null
);

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'business',
  slug text not null unique,
  name text not null,
  owner_player_id uuid not null references public.players(id) on delete restrict,
  business_kind text,
  enabled_modules text[] not null default '{}'::text[],
  legacy_studio_id uuid unique references public.studios(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  primary key(space_id,player_id)
);

create table if not exists public.studio_services (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  price numeric(10,2),
  currency text not null default 'ARS',
  price_type text not null default 'consultar',
  cta_type text not null default 'reservar',
  is_active boolean not null default true
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.studio_services(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  buyer_id uuid not null references auth.users(id),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60,
  status text not null default 'requested',
  price numeric(10,2),
  currency text not null default 'ARS',
  payment_status text not null default 'not_required',
  external_reference text unique,
  external_payment_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bookings enable row level security;

create or replace function private.user_is_global_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin'
  );
$$;

create or replace function private.space_role_for_user(p_space_id uuid,p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_role text;
begin
  if p_space_id is null or p_user_id is null then return null; end if;
  if private.user_is_global_admin(p_user_id) then return 'admin'; end if;

  select p.id into v_player_id
  from public.players p
  where p.owner_user_id = p_user_id
  limit 1;
  if v_player_id is null then return null; end if;

  if exists (
    select 1 from public.spaces sp
    where sp.id = p_space_id and sp.owner_player_id = v_player_id
  ) then
    return 'owner';
  end if;

  select sm.role into v_role
  from public.space_members sm
  where sm.space_id = p_space_id
    and sm.player_id = v_player_id
    and sm.status = 'active'
  limit 1;
  return v_role;
end;
$$;

revoke all on function private.user_is_global_admin(uuid) from public,anon,authenticated;
revoke all on function private.space_role_for_user(uuid,uuid) from public,anon,authenticated;

-- Supabase local normally creates this publication, but keep the baseline
-- deterministic if the database-only launcher changes its defaults.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
