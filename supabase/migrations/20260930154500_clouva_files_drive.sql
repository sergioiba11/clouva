-- CLOUVA Files: private Drive-style storage with public share links.
create table if not exists public.clouva_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 500),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  mime_type text not null default 'application/octet-stream',
  share_token uuid not null default gen_random_uuid() unique,
  is_share_enabled boolean not null default true,
  download_count bigint not null default 0 check (download_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clouva_files_owner_created_idx
  on public.clouva_files (owner_id, created_at desc);

create unique index if not exists clouva_files_share_token_idx
  on public.clouva_files (share_token);

create or replace function public.touch_clouva_files_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_clouva_files_updated_at() from public;

drop trigger if exists clouva_files_touch_updated_at on public.clouva_files;
create trigger clouva_files_touch_updated_at
before update on public.clouva_files
for each row execute function public.touch_clouva_files_updated_at();

alter table public.clouva_files enable row level security;

revoke all on table public.clouva_files from anon;
revoke all on table public.clouva_files from authenticated;
grant select, insert, update, delete on table public.clouva_files to authenticated;
grant all on table public.clouva_files to service_role;

drop policy if exists clouva_files_select_own on public.clouva_files;
create policy clouva_files_select_own
on public.clouva_files
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists clouva_files_insert_own on public.clouva_files;
create policy clouva_files_insert_own
on public.clouva_files
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists clouva_files_update_own on public.clouva_files;
create policy clouva_files_update_own
on public.clouva_files
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists clouva_files_delete_own on public.clouva_files;
create policy clouva_files_delete_own
on public.clouva_files
for delete
to authenticated
using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clouva-files',
  'clouva-files',
  false,
  null,
  null
)
on conflict (id) do update set
  public = false,
  file_size_limit = null,
  allowed_mime_types = null;

drop policy if exists "Users can read own CLOUVA files" on storage.objects;
create policy "Users can read own CLOUVA files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'clouva-files'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can upload own CLOUVA files" on storage.objects;
create policy "Users can upload own CLOUVA files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'clouva-files'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update own CLOUVA files" on storage.objects;
create policy "Users can update own CLOUVA files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'clouva-files'
  and (select auth.uid())::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'clouva-files'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete own CLOUVA files" on storage.objects;
create policy "Users can delete own CLOUVA files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'clouva-files'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);

comment on table public.clouva_files is
  'Private Drive-style files uploaded through /archivos. Share tokens are resolved server-side to signed download URLs.';
