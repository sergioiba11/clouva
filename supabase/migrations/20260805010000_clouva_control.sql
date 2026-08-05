begin;

create schema if not exists private;

create or replace function private.is_clouva_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(coalesce(p.role::text, '')) in ('admin', 'owner', 'super_admin')
        or lower(coalesce(p.role_v2::text, '')) = 'admin'
      )
  );
$$;

revoke all on function private.is_clouva_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_clouva_admin() to authenticated;

create table if not exists public.mobile_app_releases (
  id uuid primary key default gen_random_uuid(),
  app_name text not null default 'CLOUVA CONTROL',
  platform text not null default 'android' check (platform in ('android')),
  version text not null,
  build_number integer not null check (build_number > 0),
  storage_path text not null,
  file_size bigint,
  checksum text not null,
  release_notes text,
  is_stable boolean not null default false,
  minimum_required text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (app_name, platform, version, build_number)
);

create index if not exists mobile_app_releases_latest_idx
  on public.mobile_app_releases (platform, is_stable desc, created_at desc);

create table if not exists public.admin_mobile_issues (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  module text,
  route text,
  preview_persona text,
  screenshot_path text,
  device_model text,
  resolution text,
  app_version text,
  web_version text,
  status text not null default 'detectado'
    check (status in ('detectado', 'en_revision', 'en_desarrollo', 'listo_para_probar', 'resuelto')),
  priority text not null default 'media'
    check (priority in ('baja', 'media', 'alta', 'critica')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_mobile_issues_status_idx
  on public.admin_mobile_issues (status, priority, created_at desc);

create index if not exists admin_mobile_issues_route_idx
  on public.admin_mobile_issues (route, created_at desc)
  where route is not null;

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  module text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_admin_created_idx
  on public.admin_audit_logs (admin_user_id, created_at desc);

alter table public.mobile_app_releases enable row level security;
alter table public.admin_mobile_issues enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on public.mobile_app_releases from anon;
revoke all on public.admin_mobile_issues from anon;
revoke all on public.admin_audit_logs from anon;

grant select on public.mobile_app_releases to authenticated;
grant select, insert, update on public.admin_mobile_issues to authenticated;
grant select on public.admin_audit_logs to authenticated;
grant usage, select on sequence public.admin_audit_logs_id_seq to authenticated;

drop policy if exists "admins read mobile releases" on public.mobile_app_releases;
create policy "admins read mobile releases"
on public.mobile_app_releases for select
to authenticated
using ((select private.is_clouva_admin()));

drop policy if exists "admins read mobile issues" on public.admin_mobile_issues;
create policy "admins read mobile issues"
on public.admin_mobile_issues for select
to authenticated
using ((select private.is_clouva_admin()));

drop policy if exists "admins create mobile issues" on public.admin_mobile_issues;
create policy "admins create mobile issues"
on public.admin_mobile_issues for insert
to authenticated
with check ((select private.is_clouva_admin()) and created_by = (select auth.uid()));

drop policy if exists "admins update mobile issues" on public.admin_mobile_issues;
create policy "admins update mobile issues"
on public.admin_mobile_issues for update
to authenticated
using ((select private.is_clouva_admin()))
with check ((select private.is_clouva_admin()));

drop policy if exists "admins read audit logs" on public.admin_audit_logs;
create policy "admins read audit logs"
on public.admin_audit_logs for select
to authenticated
using ((select private.is_clouva_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-apk-releases',
  'admin-apk-releases',
  false,
  524288000,
  array['application/vnd.android.package-archive', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-mobile-issues',
  'admin-mobile-issues',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins read private apk releases" on storage.objects;
create policy "admins read private apk releases"
on storage.objects for select
to authenticated
using (bucket_id = 'admin-apk-releases' and (select private.is_clouva_admin()));

drop policy if exists "admins read issue screenshots" on storage.objects;
create policy "admins read issue screenshots"
on storage.objects for select
to authenticated
using (bucket_id = 'admin-mobile-issues' and (select private.is_clouva_admin()));

commit;
