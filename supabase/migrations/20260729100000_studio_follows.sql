-- "Seguir" a un estudio -- follows.followed_id has a hard FK to profiles(id),
-- so studios need their own follow table, mirroring the same shape/policy.

create table public.studio_follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, studio_id)
);

alter table public.studio_follows enable row level security;

create policy studio_follows_read
  on public.studio_follows for select
  using (true);

create policy studio_follows_manage_own
  on public.studio_follows for all
  using (follower_id = auth.uid())
  with check (follower_id = auth.uid());
