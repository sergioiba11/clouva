alter table public.user_avatars
  add column if not exists customization jsonb not null default '{}'::jsonb;
