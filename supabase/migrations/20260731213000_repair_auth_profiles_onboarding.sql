alter table public.profiles
  add column if not exists onboarding_status text not null default 'pending',
  add column if not exists onboarding_completed_at timestamptz;

alter table public.profiles drop constraint if exists profiles_onboarding_status_check;
alter table public.profiles
  add constraint profiles_onboarding_status_check
  check (onboarding_status in ('pending', 'exploring', 'player_created', 'published'));

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text;
begin
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Usuario'
  );

  insert into public.profiles (
    id,
    role,
    role_v2,
    display_name,
    full_name,
    email,
    phone,
    clouva_id,
    onboarding_status
  ) values (
    new.id,
    'customer'::public.app_role,
    'cliente'::public.user_role_v3,
    profile_name,
    profile_name,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'CLV-' || left(replace(new.id::text, '-', ''), 10),
    'pending'
  )
  on conflict (id) do update set
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    email = coalesce(public.profiles.email, excluded.email),
    phone = coalesce(public.profiles.phone, excluded.phone),
    clouva_id = coalesce(public.profiles.clouva_id, excluded.clouva_id),
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user_profile();

insert into public.profiles (
  id,
  role,
  role_v2,
  display_name,
  full_name,
  email,
  phone,
  clouva_id,
  onboarding_status
)
select
  u.id,
  'customer'::public.app_role,
  'cliente'::public.user_role_v3,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Usuario'
  ),
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Usuario'
  ),
  u.email,
  nullif(trim(u.raw_user_meta_data ->> 'phone'), ''),
  'CLV-' || left(replace(u.id::text, '-', ''), 10),
  'pending'
from auth.users u
on conflict (id) do update set
  display_name = coalesce(public.profiles.display_name, excluded.display_name),
  full_name = coalesce(public.profiles.full_name, excluded.full_name),
  email = coalesce(public.profiles.email, excluded.email),
  phone = coalesce(public.profiles.phone, excluded.phone),
  clouva_id = coalesce(public.profiles.clouva_id, excluded.clouva_id),
  updated_at = now();

update public.profiles p
set
  onboarding_status = case
    when exists (
      select 1 from public.players pl
      where pl.owner_user_id = p.id and pl.is_published = true
    ) then 'published'
    when exists (
      select 1 from public.players pl
      where pl.owner_user_id = p.id
    ) then 'player_created'
    else p.onboarding_status
  end,
  onboarding_completed_at = case
    when exists (
      select 1 from public.players pl
      where pl.owner_user_id = p.id and pl.is_published = true
    ) then coalesce(p.onboarding_completed_at, now())
    else p.onboarding_completed_at
  end,
  updated_at = now();