-- Notificaciones in-app (campanita). Los inserts los hace el service role
-- desde el servidor (ej. al otorgar VIP) -- no hay policy de insert para el
-- usuario autenticado, a propósito, igual que admin_audit_log.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own
  on public.notifications for select
  using (user_id = auth.uid());

create policy notifications_update_own
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
