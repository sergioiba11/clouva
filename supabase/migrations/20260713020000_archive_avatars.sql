alter table public.user_avatars
  add column if not exists archived_at timestamptz;

create index if not exists user_avatars_archived_idx on public.user_avatars(user_id, archived_at);
