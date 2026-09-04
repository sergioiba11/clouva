alter table public.agenda_members
  add column if not exists invitation_token uuid default gen_random_uuid(),
  add column if not exists accepted_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists email_delivery_status text not null default 'queued',
  add column if not exists email_provider_message_id text,
  add column if not exists whatsapp_delivery_status text not null default 'queued',
  add column if not exists whatsapp_provider_message_id text,
  add column if not exists notification_id uuid references public.notifications(id) on delete set null;

create unique index if not exists agenda_members_invitation_token_uidx
  on public.agenda_members(invitation_token);

create table if not exists public.agenda_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null,
  player_id uuid not null,
  channel text not null check (channel in ('email','whatsapp','notification')),
  status text not null default 'queued',
  provider_message_id text,
  failure_reason text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agenda_id,player_id,channel),
  foreign key (agenda_id,player_id) references public.agenda_members(agenda_id,player_id) on delete cascade
);

alter table public.agenda_invitation_deliveries enable row level security;
revoke all on public.agenda_invitation_deliveries from anon, authenticated;
