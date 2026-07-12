alter table if exists public.profiles
  add column if not exists avatar_3d_url text;
