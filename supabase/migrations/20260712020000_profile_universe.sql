alter table public.profiles
  add column if not exists spotify_url text;

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

alter table public.follows enable row level security;

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select using (true);

drop policy if exists follows_manage_own on public.follows;
create policy follows_manage_own on public.follows for all
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());
