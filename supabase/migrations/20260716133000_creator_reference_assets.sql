create table if not exists public.creator_reference_assets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('hoodie','remera','campera','baggy','zapatillas','gorra','cadena','lentes','mochila','aros','guantes','pulseras','anillos')),
  file_name text not null,
  file_size bigint not null default 0,
  storage_path text not null unique,
  source_url text,
  license text,
  author text,
  status text not null default 'reference' check (status in ('reference','processing','rigged','ready','error')),
  preview_settings jsonb not null default '{}'::jsonb,
  rigged_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_reference_assets_user_created_idx
  on public.creator_reference_assets (user_id, created_at desc);

alter table public.creator_reference_assets enable row level security;

drop policy if exists "Users can read own creator assets" on public.creator_reference_assets;
create policy "Users can read own creator assets"
  on public.creator_reference_assets for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own creator assets" on public.creator_reference_assets;
create policy "Users can insert own creator assets"
  on public.creator_reference_assets for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own creator assets" on public.creator_reference_assets;
create policy "Users can update own creator assets"
  on public.creator_reference_assets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own creator assets" on public.creator_reference_assets;
create policy "Users can delete own creator assets"
  on public.creator_reference_assets for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creator-reference-assets',
  'creator-reference-assets',
  false,
  83886080,
  array['model/gltf-binary','application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own creator GLBs" on storage.objects;
create policy "Users can read own creator GLBs"
  on storage.objects for select
  using (
    bucket_id = 'creator-reference-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can upload own creator GLBs" on storage.objects;
create policy "Users can upload own creator GLBs"
  on storage.objects for insert
  with check (
    bucket_id = 'creator-reference-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own creator GLBs" on storage.objects;
create policy "Users can update own creator GLBs"
  on storage.objects for update
  using (
    bucket_id = 'creator-reference-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'creator-reference-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own creator GLBs" on storage.objects;
create policy "Users can delete own creator GLBs"
  on storage.objects for delete
  using (
    bucket_id = 'creator-reference-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
