create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity int not null default 1 check (quantity > 0),
  unique(profile_id, product_id)
);

create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(profile_id, product_id)
);

alter table orders add column if not exists profile_id uuid references profiles(id);
alter table orders add column if not exists status text default 'pendiente';

alter table cart_items enable row level security;
alter table favorites enable row level security;
alter table profiles enable row level security;
alter table orders enable row level security;

create policy "profiles self read" on profiles for select using (id = auth.uid());
create policy "profiles self update" on profiles for update using (id = auth.uid());

create policy "cart own manage" on cart_items for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "favorites own manage" on favorites for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "orders own read" on orders for select using (profile_id = auth.uid());
create policy "orders own insert" on orders for insert with check (profile_id = auth.uid());
create policy "admin orders all" on orders for all using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('owner','admin')));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (new.id, 'customer', coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
