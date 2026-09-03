create table if not exists public.player_knowledge_profiles (
  player_id uuid primary key references public.players(id) on delete cascade,
  birth_date date null,
  show_lunar boolean not null default false,
  show_numerology boolean not null default false,
  show_zodiac boolean not null default false,
  knowledge_topics text[] not null default '{}'::text[],
  teach_topics text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_knowledge_birth_date_valid check (birth_date is null or birth_date <= current_date)
);

create table if not exists public.player_knowledge_insights (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  topic text not null,
  subject_key text not null,
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  model text null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (player_id, topic, subject_key)
);

create index if not exists player_knowledge_insights_expiry_idx
  on public.player_knowledge_insights (player_id, topic, expires_at desc);

alter table public.player_knowledge_profiles enable row level security;
alter table public.player_knowledge_insights enable row level security;

revoke all on table public.player_knowledge_profiles from anon, authenticated;
revoke all on table public.player_knowledge_insights from anon, authenticated;

grant all on table public.player_knowledge_profiles to service_role;
grant all on table public.player_knowledge_insights to service_role;
