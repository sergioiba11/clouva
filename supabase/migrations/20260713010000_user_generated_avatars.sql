alter table public.user_avatars
  add column if not exists name text not null default 'Mi avatar',
  add column if not exists source text not null default 'generated',
  add column if not exists status text not null default 'ready',
  add column if not exists model_url text,
  add column if not exists storage_path text,
  add column if not exists preview_image_url text,
  add column if not exists meshy_task_id text,
  add column if not exists front_rotation_y numeric not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists user_avatars_active_lookup_idx
  on public.user_avatars(user_id, updated_at desc)
  where is_active = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  26214400,
  array['model/gltf-binary', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own avatar files" on storage.objects;
create policy "Users can upload own avatar files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own avatar files" on storage.objects;
create policy "Users can update own avatar files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own avatar files" on storage.objects;
create policy "Users can delete own avatar files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
