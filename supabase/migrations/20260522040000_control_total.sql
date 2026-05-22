-- Ensure specific admin user
insert into profiles (id, role, role_v2, full_name)
select au.id, 'admin'::app_role, 'admin'::user_role, coalesce(au.raw_user_meta_data->>'full_name', split_part(au.email,'@',1))
from auth.users au
where au.email = 'sergio.iba.11@gmail.com'
on conflict (id) do update set role='admin'::app_role, role_v2='admin'::user_role;

-- Product control extensions
alter table products add column if not exists vip_only boolean not null default false;
alter table products add column if not exists featured boolean not null default false;
alter table products add column if not exists deleted_at timestamptz;

-- Payments config
create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  active boolean not null default true,
  alias text,
  cbu_cvu text,
  holder text,
  instructions text,
  customer_notes text,
  qr_image_url text,
  created_at timestamptz not null default now()
);

insert into payment_methods(code,active,alias) values
('transferencia',true,'Transferencia bancaria'),
('efectivo',true,'Efectivo')
on conflict (code) do nothing;

-- Profiles extensions
alter table profiles add column if not exists clouva_id text unique;
alter table profiles add column if not exists is_vip boolean not null default false;
alter table profiles add column if not exists is_blocked boolean not null default false;
alter table profiles add column if not exists username text unique;

update profiles set clouva_id = coalesce(clouva_id, 'CLV-' || substr(replace(id::text,'-',''),1,10));

-- Flow modules
create table if not exists flow_projects (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), title text not null, status text default 'idea', priority int default 1, notes text, created_at timestamptz default now());
create table if not exists flow_businesses (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), name text not null, estimated_income_cents int default 0, expenses_cents int default 0, status text default 'activo', notes text, priority int default 1, created_at timestamptz default now());
create table if not exists flow_music_tracks (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), title text not null, lyrics text, beat text, producer text, status text default 'idea', release_target_date date, links text, notes text, cover_url text, created_at timestamptz default now());
create table if not exists flow_releases (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), title text not null, release_date date, status text default 'planificado', notes text, created_at timestamptz default now());
create table if not exists flow_finances (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), concept text not null, amount_cents int not null, kind text not null, created_at timestamptz default now());
create table if not exists flow_content_calendar (id uuid primary key default gen_random_uuid(), owner_id uuid references profiles(id), title text not null, channel text, publish_date date, status text default 'borrador', notes text, created_at timestamptz default now());
