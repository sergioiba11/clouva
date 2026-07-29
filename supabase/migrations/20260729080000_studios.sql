-- Comunidad: Estudios (studios/labels/collectives) + their member rosters.
-- Studio creation is VIP-gated (profiles.is_vip) at the RLS layer, not just in the UI.

create table public.studios (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  logo_url text,
  cover_url text,
  description text,
  city text,
  country text,
  founded_year int,
  website_url text,
  social_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index studios_owner_idx on public.studios(owner_id);

alter table public.studios enable row level security;

create policy studios_select_public
  on public.studios for select
  using (true);

create policy studios_insert_vip
  on public.studios for insert
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_vip = true)
  );

create policy studios_update_owner_or_admin
  on public.studios for update
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = studios.id and m.profile_id = auth.uid() and m.role = 'admin' and m.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_id = auth.uid()
    or exists (
      select 1 from public.studio_members m
      where m.studio_id = studios.id and m.profile_id = auth.uid() and m.role = 'admin' and m.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy studios_delete_owner_or_global_admin
  on public.studios for delete
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create table public.studio_members (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active' check (status in ('active', 'invited', 'removed')),
  joined_at timestamptz not null default now(),
  unique (studio_id, profile_id)
);

create index studio_members_studio_idx on public.studio_members(studio_id);
create index studio_members_profile_idx on public.studio_members(profile_id);

alter table public.studio_members enable row level security;

create policy studio_members_select_public
  on public.studio_members for select
  using (true);

create policy studio_members_write
  on public.studio_members for all
  using (
    exists (select 1 from public.studios s where s.id = studio_members.studio_id and s.owner_id = auth.uid())
    or exists (
      select 1 from public.studio_members m2
      where m2.studio_id = studio_members.studio_id and m2.profile_id = auth.uid() and m2.role = 'admin' and m2.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.studios s where s.id = studio_members.studio_id and s.owner_id = auth.uid())
    or exists (
      select 1 from public.studio_members m2
      where m2.studio_id = studio_members.studio_id and m2.profile_id = auth.uid() and m2.role = 'admin' and m2.status = 'active'
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
