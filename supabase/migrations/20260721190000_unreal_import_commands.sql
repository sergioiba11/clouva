create table if not exists public.unreal_import_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  avatar_id uuid,
  command_type text not null default 'import_avatar' check (command_type in ('import_avatar','import_garment','import_accessory')),
  source_url text not null,
  filename text not null,
  destination_path text not null,
  status text not null default 'pending' check (status in ('pending','claimed','downloading','importing','succeeded','failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  result jsonb,
  error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists unreal_import_commands_pending_idx
  on public.unreal_import_commands(status, created_at);

alter table public.unreal_import_commands enable row level security;

create policy "Users can read own Unreal commands"
  on public.unreal_import_commands for select
  using (auth.uid() = user_id);
