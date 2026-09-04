create sequence if not exists public.flow_asset_number_seq start with 1;

create table if not exists public.flow_purchase_operations (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid references auth.users(id) on delete set null,
  buyer_player_id uuid references public.players(id) on delete set null,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_player_id uuid references public.players(id) on delete set null,
  provider text not null,
  provider_payment_id text,
  provider_reference text not null unique,
  payment_method text not null,
  quantity integer not null check (quantity > 0 and quantity <= 1000),
  unit_usd numeric(12,2) not null default 1 check (unit_usd > 0),
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','failed','cancelled','refunded')),
  confirmed_at timestamptz,
  issued_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists flow_purchase_operations_provider_payment_uidx
  on public.flow_purchase_operations(provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists flow_purchase_operations_recipient_idx on public.flow_purchase_operations(recipient_user_id, created_at desc);

create table if not exists public.flow_assets (
  id uuid primary key default gen_random_uuid(),
  flow_number bigint not null default nextval('public.flow_asset_number_seq') unique,
  operation_id uuid not null references public.flow_purchase_operations(id) on delete restrict,
  operation_unit integer not null check (operation_unit > 0),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  owner_player_id uuid references public.players(id) on delete set null,
  original_buyer_user_id uuid references auth.users(id) on delete set null,
  original_buyer_player_id uuid references public.players(id) on delete set null,
  status text not null default 'available' check (status in ('pending_payment','available','activated','transferred')),
  issued_at timestamptz not null default now(),
  activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique(operation_id, operation_unit)
);
create index if not exists flow_assets_owner_idx on public.flow_assets(owner_user_id, issued_at desc);
create index if not exists flow_assets_owner_player_idx on public.flow_assets(owner_player_id, issued_at desc);

create table if not exists public.flow_asset_movements (
  id uuid primary key default gen_random_uuid(),
  flow_asset_id uuid not null references public.flow_assets(id) on delete restrict,
  action text not null check (action in ('issued','activated','transferred')),
  from_user_id uuid references auth.users(id) on delete set null,
  to_user_id uuid references auth.users(id) on delete set null,
  from_player_id uuid references public.players(id) on delete set null,
  to_player_id uuid references public.players(id) on delete set null,
  operation_id uuid references public.flow_purchase_operations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists flow_asset_movements_asset_idx on public.flow_asset_movements(flow_asset_id, created_at desc);

alter table public.flow_purchase_operations enable row level security;
alter table public.flow_assets enable row level security;
alter table public.flow_asset_movements enable row level security;

drop policy if exists flow_operations_read_own on public.flow_purchase_operations;
create policy flow_operations_read_own on public.flow_purchase_operations for select to authenticated
using (auth.uid() = recipient_user_id or auth.uid() = buyer_user_id);

drop policy if exists flow_assets_read_own on public.flow_assets;
create policy flow_assets_read_own on public.flow_assets for select to authenticated
using (auth.uid() = owner_user_id or auth.uid() = original_buyer_user_id);

drop policy if exists flow_asset_movements_read_related on public.flow_asset_movements;
create policy flow_asset_movements_read_related on public.flow_asset_movements for select to authenticated
using (exists (select 1 from public.flow_assets a where a.id = flow_asset_id and (a.owner_user_id = auth.uid() or a.original_buyer_user_id = auth.uid())));

create or replace function public.issue_flows_for_operation(p_operation_id uuid, p_confirmed_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op public.flow_purchase_operations%rowtype;
  v_count integer;
begin
  select * into v_op from public.flow_purchase_operations where id = p_operation_id for update;
  if not found then raise exception 'Operación de Flow inexistente.'; end if;
  if v_op.status <> 'confirmed' then raise exception 'El pago todavía no está confirmado.'; end if;

  if v_op.issued_at is not null then
    select count(*)::integer into v_count from public.flow_assets where operation_id = v_op.id;
    return jsonb_build_object('operationId', v_op.id, 'issued', v_count, 'alreadyIssued', true);
  end if;

  insert into public.flow_assets(operation_id, operation_unit, owner_user_id, owner_player_id, original_buyer_user_id, original_buyer_player_id, status, metadata)
  select v_op.id, n, v_op.recipient_user_id, v_op.recipient_player_id, v_op.buyer_user_id, v_op.buyer_player_id, 'available',
         jsonb_build_object('provider', v_op.provider, 'paymentMethod', v_op.payment_method)
  from generate_series(1, v_op.quantity) n;

  insert into public.flow_asset_movements(flow_asset_id, action, to_user_id, to_player_id, operation_id, created_by, metadata)
  select a.id, 'issued', a.owner_user_id, a.owner_player_id, v_op.id, p_confirmed_by,
         jsonb_build_object('provider', v_op.provider, 'paymentMethod', v_op.payment_method)
  from public.flow_assets a where a.operation_id = v_op.id;

  perform public.adjust_flows_balance(
    v_op.recipient_user_id,
    v_op.quantity,
    'purchase_credit',
    case when v_op.provider = 'manual' then 'manual_payment' else 'flow_purchase' end,
    v_op.id::text,
    jsonb_build_object('operationId', v_op.id, 'provider', v_op.provider, 'paymentMethod', v_op.payment_method, 'quantity', v_op.quantity),
    p_confirmed_by
  );

  update public.flow_purchase_operations
  set issued_at = now(), updated_at = now()
  where id = v_op.id;

  return jsonb_build_object('operationId', v_op.id, 'issued', v_op.quantity, 'alreadyIssued', false);
end;
$$;

revoke all on function public.issue_flows_for_operation(uuid,uuid) from public;
grant execute on function public.issue_flows_for_operation(uuid,uuid) to service_role;
