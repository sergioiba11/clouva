-- Comunidad: events, gallery items, and creative "proyectos" (releases) --
-- each owned by either an individual profile or a studio, never both.

create table public.community_events (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references public.studios(id) on delete cascade,
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  city text,
  cover_url text,
  ticket_url text,
  created_at timestamptz not null default now(),
  constraint community_events_single_owner check (
    (studio_id is not null and owner_profile_id is null)
    or (studio_id is null and owner_profile_id is not null)
  )
);

create index community_events_studio_idx on public.community_events(studio_id);
create index community_events_owner_idx on public.community_events(owner_profile_id);
create index community_events_starts_idx on public.community_events(starts_at);

alter table public.community_events enable row level security;

create policy community_events_select_public
  on public.community_events for select
  using (true);

create policy community_events_write
  on public.community_events for all
  using (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.studios s
      where s.id = community_events.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1 from public.studio_members m
          where m.studio_id = s.id and m.profile_id = auth.uid() and m.role = 'admin' and m.status = 'active'
        )
      )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.studios s
      where s.id = community_events.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1 from public.studio_members m
          where m.studio_id = s.id and m.profile_id = auth.uid() and m.role = 'admin' and m.status = 'active'
        )
      )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create table public.community_gallery_items (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('image', 'video')),
  media_url text not null,
  caption text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index community_gallery_owner_idx on public.community_gallery_items(owner_profile_id);

alter table public.community_gallery_items enable row level security;

create policy community_gallery_select_public
  on public.community_gallery_items for select
  using (true);

create policy community_gallery_owner
  on public.community_gallery_items for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy community_gallery_admin
  on public.community_gallery_items for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create table public.community_projects (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  studio_id uuid references public.studios(id) on delete cascade,
  title text not null,
  cover_url text,
  release_type text check (release_type in ('single', 'ep', 'album', 'video', 'other')),
  release_date date,
  spotify_url text,
  youtube_url text,
  apple_music_url text,
  soundcloud_url text,
  bandcamp_url text,
  description text,
  created_at timestamptz not null default now(),
  constraint community_projects_single_owner check (
    (owner_profile_id is not null and studio_id is null)
    or (owner_profile_id is null and studio_id is not null)
  )
);

create index community_projects_owner_idx on public.community_projects(owner_profile_id);
create index community_projects_studio_idx on public.community_projects(studio_id);

alter table public.community_projects enable row level security;

create policy community_projects_select_public
  on public.community_projects for select
  using (true);

create policy community_projects_write
  on public.community_projects for all
  using (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.studios s
      where s.id = community_projects.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1 from public.studio_members m
          where m.studio_id = s.id and m.profile_id = auth.uid() and m.role = 'admin' and m.status = 'active'
        )
      )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    owner_profile_id = auth.uid()
    or exists (
      select 1 from public.studios s
      where s.id = community_projects.studio_id
      and (
        s.owner_id = auth.uid()
        or exists (
          select 1 from public.studio_members m
          where m.studio_id = s.id and m.profile_id = auth.uid() and m.role = 'admin' and m.status = 'active'
        )
      )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
