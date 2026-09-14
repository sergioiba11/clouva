create table if not exists public.cannabis_strains (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  subtitle text,
  description text,
  strain_type text,
  hero_image text,
  profile text,
  tags text[] not null default '{}'::text[],
  aromas text[] not null default '{}'::text[],
  is_featured boolean not null default false,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.strain_effects (
  strain_id uuid primary key references public.cannabis_strains(id) on delete cascade,
  relaxation smallint check (relaxation between 0 and 10),
  creativity smallint check (creativity between 0 and 10),
  energy smallint check (energy between 0 and 10),
  happiness smallint check (happiness between 0 and 10),
  focus smallint check (focus between 0 and 10),
  updated_at timestamptz not null default now()
);

create table if not exists public.strain_terpenes (
  id uuid primary key default gen_random_uuid(),
  strain_id uuid not null references public.cannabis_strains(id) on delete cascade,
  terpene text not null,
  description text,
  aroma text,
  relative_value numeric,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (strain_id, terpene)
);

create table if not exists public.strain_flavors (
  id uuid primary key default gen_random_uuid(),
  strain_id uuid not null references public.cannabis_strains(id) on delete cascade,
  flavor text not null,
  value smallint check (value between 0 and 10),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (strain_id, flavor)
);

create table if not exists public.user_strain_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  strain_id uuid not null references public.cannabis_strains(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, strain_id)
);

create table if not exists public.strain_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_url text,
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_strain_views (
  user_id uuid not null references public.profiles(id) on delete cascade,
  strain_id uuid not null references public.cannabis_strains(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, strain_id)
);

create index if not exists cannabis_strains_published_featured_idx on public.cannabis_strains (is_published, is_featured, created_at desc);
create index if not exists cannabis_strains_name_idx on public.cannabis_strains (name);
create index if not exists strain_terpenes_strain_idx on public.strain_terpenes (strain_id, sort_order);
create index if not exists strain_flavors_strain_idx on public.strain_flavors (strain_id, sort_order);
create index if not exists strain_scans_user_created_idx on public.strain_scans (user_id, created_at desc);
create index if not exists user_strain_views_user_viewed_idx on public.user_strain_views (user_id, viewed_at desc);

alter table public.cannabis_strains enable row level security;
alter table public.strain_effects enable row level security;
alter table public.strain_terpenes enable row level security;
alter table public.strain_flavors enable row level security;
alter table public.user_strain_favorites enable row level security;
alter table public.strain_scans enable row level security;
alter table public.user_strain_views enable row level security;

drop policy if exists cannabis_strains_public_read on public.cannabis_strains;
create policy cannabis_strains_public_read on public.cannabis_strains for select to public using (is_published = true);

drop policy if exists strain_effects_public_read on public.strain_effects;
create policy strain_effects_public_read on public.strain_effects for select to public using (
  exists (select 1 from public.cannabis_strains s where s.id = strain_effects.strain_id and s.is_published = true)
);

drop policy if exists strain_terpenes_public_read on public.strain_terpenes;
create policy strain_terpenes_public_read on public.strain_terpenes for select to public using (
  exists (select 1 from public.cannabis_strains s where s.id = strain_terpenes.strain_id and s.is_published = true)
);

drop policy if exists strain_flavors_public_read on public.strain_flavors;
create policy strain_flavors_public_read on public.strain_flavors for select to public using (
  exists (select 1 from public.cannabis_strains s where s.id = strain_flavors.strain_id and s.is_published = true)
);

drop policy if exists user_strain_favorites_self_select on public.user_strain_favorites;
create policy user_strain_favorites_self_select on public.user_strain_favorites for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_strain_favorites_self_insert on public.user_strain_favorites;
create policy user_strain_favorites_self_insert on public.user_strain_favorites for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_strain_favorites_self_delete on public.user_strain_favorites;
create policy user_strain_favorites_self_delete on public.user_strain_favorites for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists strain_scans_self_select on public.strain_scans;
create policy strain_scans_self_select on public.strain_scans for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists strain_scans_self_insert on public.strain_scans;
create policy strain_scans_self_insert on public.strain_scans for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists strain_scans_self_delete on public.strain_scans;
create policy strain_scans_self_delete on public.strain_scans for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists user_strain_views_self_select on public.user_strain_views;
create policy user_strain_views_self_select on public.user_strain_views for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_strain_views_self_insert on public.user_strain_views;
create policy user_strain_views_self_insert on public.user_strain_views for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists user_strain_views_self_update on public.user_strain_views;
create policy user_strain_views_self_update on public.user_strain_views for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

do $$
declare
  v_strain_id uuid;
begin
  insert into public.cannabis_strains (
    slug, name, subtitle, description, strain_type, hero_image, profile, tags, aromas, is_featured, is_published
  ) values (
    'pina-express', 'Piña Express', 'Híbrida tropical',
    'Perfil de demostración para la experiencia de genéticas de CLOUVA.',
    'Híbrida', '/genetics/pina-express-bud.svg', 'Creativa y chill',
    array['Tropical','Creativa','Equilibrada'], array['tropical','cítrico','pino'], true, true
  )
  on conflict (slug) do update set
    name = excluded.name,
    subtitle = excluded.subtitle,
    description = excluded.description,
    strain_type = excluded.strain_type,
    hero_image = excluded.hero_image,
    profile = excluded.profile,
    tags = excluded.tags,
    aromas = excluded.aromas,
    is_featured = excluded.is_featured,
    is_published = excluded.is_published,
    updated_at = now()
  returning id into v_strain_id;

  insert into public.strain_effects (strain_id, relaxation, creativity, energy, happiness, focus)
  values (v_strain_id, 8, 9, 6, 8, 7)
  on conflict (strain_id) do update set
    relaxation = excluded.relaxation,
    creativity = excluded.creativity,
    energy = excluded.energy,
    happiness = excluded.happiness,
    focus = excluded.focus,
    updated_at = now();

  insert into public.strain_terpenes (strain_id, terpene, sort_order)
  values (v_strain_id, 'Mirceno', 1), (v_strain_id, 'Limoneno', 2), (v_strain_id, 'Cariofileno', 3)
  on conflict (strain_id, terpene) do update set sort_order = excluded.sort_order;

  insert into public.strain_flavors (strain_id, flavor, value, sort_order)
  values
    (v_strain_id, 'Tropical', 9, 1), (v_strain_id, 'Cítrico', 8, 2), (v_strain_id, 'Pino', 6, 3),
    (v_strain_id, 'Dulce', 7, 4), (v_strain_id, 'Terroso', 4, 5), (v_strain_id, 'Floral', 3, 6)
  on conflict (strain_id, flavor) do update set value = excluded.value, sort_order = excluded.sort_order;
end $$;
