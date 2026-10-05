-- CLOUVA Auto — Tuning builds + audio-reactive show presets.
-- Reuses vehicles, player_media, vehicle-media and existing vehicle access helpers.

create table if not exists public.vehicle_builds (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  name text not null default 'Build',
  is_active boolean not null default false,
  visibility text not null default 'private' check (visibility in ('private','public')),
  tuning_config jsonb not null default '{}'::jsonb,
  show_config jsonb not null default '{}'::jsonb,
  audio_media_id uuid references public.player_media(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_builds_vehicle_idx
  on public.vehicle_builds(vehicle_id, updated_at desc);

create index if not exists vehicle_builds_audio_media_idx
  on public.vehicle_builds(audio_media_id)
  where audio_media_id is not null;

create unique index if not exists vehicle_builds_one_active_idx
  on public.vehicle_builds(vehicle_id)
  where is_active;

drop trigger if exists vehicle_builds_touch_updated_at on public.vehicle_builds;
create trigger vehicle_builds_touch_updated_at
before update on public.vehicle_builds
for each row execute function private.touch_vehicle_updated_at();

alter table public.vehicle_builds enable row level security;

drop policy if exists vehicle_builds_read on public.vehicle_builds;
create policy vehicle_builds_read
on public.vehicle_builds for select
to authenticated
using (public.vehicle_can_view(vehicle_id, (select auth.uid())));

drop policy if exists vehicle_builds_write on public.vehicle_builds;
drop policy if exists vehicle_builds_insert on public.vehicle_builds;
drop policy if exists vehicle_builds_update on public.vehicle_builds;
drop policy if exists vehicle_builds_delete on public.vehicle_builds;

create policy vehicle_builds_insert
on public.vehicle_builds for insert
to authenticated
with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

create policy vehicle_builds_update
on public.vehicle_builds for update
to authenticated
using (public.vehicle_can_manage(vehicle_id, (select auth.uid())))
with check (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

create policy vehicle_builds_delete
on public.vehicle_builds for delete
to authenticated
using (public.vehicle_can_manage(vehicle_id, (select auth.uid())));

grant select, insert, update, delete on public.vehicle_builds to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('vehicle-media', 'vehicle-media', false, 209715200)
on conflict (id) do update
set file_size_limit = greatest(storage.buckets.file_size_limit, excluded.file_size_limit);
