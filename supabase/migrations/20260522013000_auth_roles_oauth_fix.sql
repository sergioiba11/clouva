-- CLOUVA OS PRO - Role normalization + OAuth profile support

create type user_role_v3 as enum ('admin','empleado','cliente','vip');

alter table if exists public.profiles
  add column if not exists email text,
  add column if not exists avatar_url text;

alter table if exists public.profiles
  add column if not exists role_v3 user_role_v3;

update public.profiles
set role_v3 = case
  when coalesce(role_v2::text, role::text) in ('admin') then 'admin'::user_role_v3
  when coalesce(role_v2::text, role::text) in ('employee','empleado') then 'empleado'::user_role_v3
  when coalesce(role_v2::text, role::text) in ('vip') then 'vip'::user_role_v3
  else 'cliente'::user_role_v3
end
where role_v3 is null;

alter table if exists public.profiles
  alter column role_v3 set default 'cliente'::user_role_v3,
  alter column role_v3 set not null;

alter table if exists public.profiles
  drop column if exists role_v2;

alter table if exists public.profiles
  rename column role_v3 to role_v2;

-- Keep legacy role in sync (backward compatibility)
update public.profiles
set role = case
  when role_v2 = 'admin' then 'admin'::app_role
  else 'customer'::app_role
end;

-- Ensure authenticated users can create or update their own profile
alter table if exists public.profiles enable row level security;

drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "profiles self upsert" on public.profiles;
create policy "profiles self upsert"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create index if not exists idx_profiles_role_v2 on public.profiles(role_v2);
create unique index if not exists idx_profiles_email_unique on public.profiles(email) where email is not null;
