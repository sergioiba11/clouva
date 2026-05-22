alter table public.profiles
  add column if not exists username text unique,
  add column if not exists bio text,
  add column if not exists accent_color text default '#8f7cff',
  add column if not exists is_vip boolean not null default false,
  add column if not exists clouva_id text unique,
  add column if not exists social_links jsonb not null default '[]'::jsonb;

create or replace function public.generate_clouva_id()
returns text language plpgsql as $$
declare cid text;
begin
  cid := 'CLV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  return cid;
end $$;

update public.profiles set clouva_id = public.generate_clouva_id() where clouva_id is null;

alter table public.profiles enable row level security;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update using (id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'))
with check (id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

insert into storage.buckets (id, name, public) values ('avatars','avatars', true)
on conflict (id) do nothing;
