alter table public.notifications
  add column if not exists actor_player_id uuid references public.players(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists notifications_actor_player_idx
  on public.notifications(actor_player_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
