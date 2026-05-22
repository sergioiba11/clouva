create table if not exists public.flow_flows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  content text,
  mood text,
  type text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flow_studio_sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, producer text, date date, status text, notes text, created_at timestamptz not null default now()
);
create table if not exists public.flow_vault_files (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, file_url text, file_type text, category text, notes text, created_at timestamptz not null default now()
);
create table if not exists public.flow_launches (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, release_date date, status text, checklist jsonb not null default '[]'::jsonb, notes text, created_at timestamptz not null default now()
);
create table if not exists public.flow_visuals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, prompt text, image_url text, type text, notes text, created_at timestamptz not null default now()
);
create table if not exists public.flow_money_entries (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('ingreso','gasto')), amount numeric(12,2) not null default 0, category text, source text, notes text, date date default now(), created_at timestamptz not null default now()
);
create table if not exists public.flow_lore_entries (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, content text, category text, created_at timestamptz not null default now()
);

alter table public.flow_flows enable row level security;
alter table public.flow_studio_sessions enable row level security;
alter table public.flow_vault_files enable row level security;
alter table public.flow_launches enable row level security;
alter table public.flow_visuals enable row level security;
alter table public.flow_money_entries enable row level security;
alter table public.flow_lore_entries enable row level security;

do $$
declare t text;
begin
  foreach t in array array['flow_flows','flow_studio_sessions','flow_vault_files','flow_launches','flow_visuals','flow_money_entries','flow_lore_entries']
  loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format('drop policy if exists %I_admin on public.%I', t, t);
    execute format('create policy %I_owner on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t, t);
    execute format('create policy %I_admin on public.%I for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = ''admin'')) with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = ''admin''))', t, t);
  end loop;
end $$;
