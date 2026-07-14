create table if not exists public.clothing_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('hoodie','shirt','jacket','pants','shorts','shoes','accessory')),
  fit text,
  color text,
  model_url text,
  thumbnail_url text,
  prompt text,
  front_reference_url text,
  back_reference_url text,
  side_reference_url text,
  meshy_task_id text,
  status text not null default 'pending' check (status in ('pending','generating','ready','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clothing_items_user_idx on public.clothing_items(user_id);

alter table public.clothing_items enable row level security;

drop policy if exists clothing_items_owner on public.clothing_items;
create policy clothing_items_owner on public.clothing_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists clothing_items_admin on public.clothing_items;
create policy clothing_items_admin on public.clothing_items
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Outfit equipado: una prenda activa por ranura principal
create table if not exists public.user_outfits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  top_id uuid references public.clothing_items(id) on delete set null,
  bottom_id uuid references public.clothing_items(id) on delete set null,
  shoes_id uuid references public.clothing_items(id) on delete set null,
  accessory_id uuid references public.clothing_items(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.user_outfits enable row level security;

drop policy if exists user_outfits_owner on public.user_outfits;
create policy user_outfits_owner on public.user_outfits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
