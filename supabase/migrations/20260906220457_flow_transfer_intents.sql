create table if not exists public.flow_transfer_intents (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  sender_player_id uuid references public.players(id) on delete set null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_player_id uuid not null references public.players(id) on delete restrict,
  public_token text,
  required_quantity integer not null check (required_quantity between 1 and 50),
  available_at_creation integer not null default 0 check (available_at_creation >= 0),
  missing_quantity integer not null check (missing_quantity >= 0 and missing_quantity <= required_quantity),
  transfer_id uuid not null unique,
  purchase_operation_id uuid references public.flow_purchase_operations(id) on delete restrict,
  status text not null default 'awaiting_funding' check (status in ('awaiting_funding','awaiting_backing','ready','executing','completed','cancelled','expired','failed')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  completed_at timestamptz,
  last_error_code text,
  last_safe_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_user_id <> recipient_user_id)
);

create index if not exists flow_transfer_intents_sender_status_idx on public.flow_transfer_intents(sender_user_id,status,created_at desc);
create index if not exists flow_transfer_intents_purchase_idx on public.flow_transfer_intents(purchase_operation_id) where purchase_operation_id is not null;
create index if not exists flow_transfer_intents_recipient_idx on public.flow_transfer_intents(recipient_user_id,status);

alter table public.flow_transfer_intents enable row level security;
revoke all on table public.flow_transfer_intents from public, anon, authenticated;
grant all on table public.flow_transfer_intents to service_role;
