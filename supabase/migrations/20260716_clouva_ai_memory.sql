create extension if not exists pgcrypto;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación',
  project_key text not null default 'clouva',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.project_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_key text not null default 'clouva',
  memory_type text not null check (memory_type in ('decision','fact','procedure','incident','solution','preference','architecture','goal')),
  title text not null,
  content text not null,
  importance smallint not null default 3 check (importance between 1 and 5),
  source_conversation_id uuid references public.ai_conversations(id) on delete set null,
  status text not null default 'active' check (status in ('active','superseded','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_key text not null default 'clouva',
  event_type text not null,
  component text,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx on public.ai_messages(conversation_id, created_at);
create index if not exists project_memory_user_project_idx on public.project_memory(user_id, project_key, status, importance desc, updated_at desc);
create index if not exists project_events_user_project_idx on public.project_events(user_id, project_key, created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.project_memory enable row level security;
alter table public.project_events enable row level security;

create policy "users manage own ai conversations" on public.ai_conversations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users manage own ai messages" on public.ai_messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users manage own project memory" on public.project_memory
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users manage own project events" on public.project_events
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
