alter table orders add column if not exists payment_method text;
alter table orders add column if not exists address text;

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);
