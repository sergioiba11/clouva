create table if not exists public.flow_agenda_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  template_key text,
  start_date date not null default now(),
  duration_value numeric not null default 1,
  duration_unit text not null default 'days' check (duration_unit in ('days','hours')),
  probability int not null default 3 check (probability between 1 and 5),
  steps jsonb not null default '[]'::jsonb,
  steps_done jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.flow_agenda_blocks enable row level security;

drop policy if exists flow_agenda_blocks_owner on public.flow_agenda_blocks;
drop policy if exists flow_agenda_blocks_admin on public.flow_agenda_blocks;

create policy flow_agenda_blocks_owner on public.flow_agenda_blocks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy flow_agenda_blocks_admin on public.flow_agenda_blocks
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
