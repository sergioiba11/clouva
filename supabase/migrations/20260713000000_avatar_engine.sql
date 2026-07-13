create table if not exists public.avatar_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('body','hair','top','bottom','shoes','accessory')),
  model_url text not null,
  thumbnail_url text not null,
  compatible_skeleton text not null,
  free boolean not null default true,
  price numeric null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_avatars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists avatar_items_category_idx on public.avatar_items(category);
create index if not exists user_avatars_user_id_idx on public.user_avatars(user_id);
create unique index if not exists user_avatars_one_active_per_user_idx on public.user_avatars(user_id) where is_active;

alter table public.avatar_items enable row level security;
alter table public.user_avatars enable row level security;

drop policy if exists "Public avatar items are readable" on public.avatar_items;
create policy "Public avatar items are readable"
  on public.avatar_items for select
  using (true);

drop policy if exists "Users can read own avatars" on public.user_avatars;
create policy "Users can read own avatars"
  on public.user_avatars for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own avatars" on public.user_avatars;
create policy "Users can insert own avatars"
  on public.user_avatars for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own avatars" on public.user_avatars;
create policy "Users can update own avatars"
  on public.user_avatars for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own avatars" on public.user_avatars;
create policy "Users can delete own avatars"
  on public.user_avatars for delete
  using (auth.uid() = user_id);
