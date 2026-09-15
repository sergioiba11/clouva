alter table public.player_knowledge_insights
  add column if not exists refresh_started_at timestamptz,
  add column if not exists refresh_token uuid;

create index if not exists idx_player_knowledge_insights_refresh
  on public.player_knowledge_insights (topic, subject_key, refresh_started_at desc)
  where refresh_started_at is not null;
