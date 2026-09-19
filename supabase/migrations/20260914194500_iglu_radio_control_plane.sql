create table if not exists public.radio_station_settings (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  station_name text not null default 'IGLÚ RADIO',
  timezone text not null default 'America/Argentina/Buenos_Aires',
  autodj_enabled boolean not null default false,
  active_playlist_id uuid,
  azuracast_station_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.radio_tracks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  title text not null,
  artist text not null default 'IGLÚ RECORDS',
  album text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  storage_bucket text not null default 'iglu-radio',
  storage_path text not null,
  mime_type text not null,
  file_size bigint not null check (file_size >= 0),
  artwork_url text,
  status text not null default 'uploading' check (status in ('uploading','ready','syncing','synced','failed','archived')),
  azuracast_media_id text,
  azuracast_path text,
  bpm numeric(7,2),
  genre text,
  release_year integer check (release_year is null or release_year between 1900 and 2200),
  isrc text,
  explicit boolean not null default false,
  notes text,
  spotify_url text,
  youtube_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, storage_path)
);

create table if not exists public.radio_playlists (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  shuffle boolean not null default true,
  repeat boolean not null default true,
  azuracast_playlist_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.radio_station_settings
  drop constraint if exists radio_station_settings_active_playlist_id_fkey;
alter table public.radio_station_settings
  add constraint radio_station_settings_active_playlist_id_fkey
  foreign key (active_playlist_id) references public.radio_playlists(id) on delete set null;

create table if not exists public.radio_playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.radio_playlists(id) on delete cascade,
  track_id uuid not null references public.radio_tracks(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (playlist_id, track_id)
);

create table if not exists public.radio_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  playlist_id uuid references public.radio_playlists(id) on delete set null,
  title text not null,
  description text,
  kind text not null default 'autodj' check (kind in ('autodj','program','session','live')),
  day_of_week smallint check (day_of_week is null or day_of_week between 0 and 6),
  start_time time,
  end_time time,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  status text not null default 'scheduled' check (status in ('scheduled','disabled','ended')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((day_of_week is not null and start_time is not null) or starts_at is not null)
);

create table if not exists public.radio_play_history (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  track_id uuid references public.radio_tracks(id) on delete set null,
  title text not null,
  artist text,
  source text not null default 'autodj' check (source in ('autodj','live','manual','unknown')),
  started_at timestamptz not null,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists radio_tracks_studio_status_idx on public.radio_tracks(studio_id,status,created_at desc);
create index if not exists radio_playlists_studio_status_idx on public.radio_playlists(studio_id,status,created_at desc);
create index if not exists radio_playlist_items_order_idx on public.radio_playlist_items(playlist_id,position);
create index if not exists radio_schedule_blocks_studio_idx on public.radio_schedule_blocks(studio_id,status,day_of_week,start_time);
create index if not exists radio_play_history_studio_started_idx on public.radio_play_history(studio_id,started_at desc);

alter table public.radio_station_settings enable row level security;
alter table public.radio_tracks enable row level security;
alter table public.radio_playlists enable row level security;
alter table public.radio_playlist_items enable row level security;
alter table public.radio_schedule_blocks enable row level security;
alter table public.radio_play_history enable row level security;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'iglu-radio',
  'iglu-radio',
  false,
  524288000,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/flac','audio/x-flac','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.radio_station_settings (studio_id, station_name, timezone)
select id, 'IGLÚ RADIO', 'America/Argentina/Buenos_Aires'
from public.studios
where slug='el-iglu'
on conflict (studio_id) do nothing;
