begin;

create table if not exists public.space_board_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  board_entry_id uuid not null references public.space_board_entries(id) on delete restrict,
  event_type text not null default 'VENTA' check (event_type in ('VENTA','REGALO')),
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  currency text not null default 'ARS',
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  inventory_movement_id uuid references public.space_inventory_movements(id) on delete set null,
  commerce_order_id uuid references public.commerce_orders(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists space_board_events_space_created_idx on public.space_board_events(space_id, created_at desc);
create index if not exists space_board_events_entry_created_idx on public.space_board_events(board_entry_id, created_at desc);

create or replace function public.record_space_board_sale(
  p_board_entry_id uuid,
  p_quantity numeric,
  p_actor_user_id uuid,
  p_note text default null,
  p_commerce_order_id uuid default null
)
returns public.space_board_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.space_board_entries%rowtype;
  v_item public.space_inventory_items%rowtype;
  v_role text;
  v_player_id uuid;
  v_movement public.space_inventory_movements%rowtype;
  v_event public.space_board_events%rowtype;
  v_price numeric(18,2);
begin
  if p_actor_user_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Venta inválida'; end if;
  select * into v_entry from public.space_board_entries where id=p_board_entry_id and active=true for update;
  if not found then raise exception 'Entrada del Pizarrón inexistente'; end if;
  if v_entry.availability <> 'disponible' then raise exception 'Esta entrada del Pizarrón no está disponible'; end if;

  v_role := private.space_role_for_user(v_entry.space_id,p_actor_user_id);
  if not private.user_is_global_admin(p_actor_user_id) and v_role not in ('owner','admin','manager','sales') then
    raise exception 'Sin permiso para registrar ventas';
  end if;
  v_player_id := private.space_player_for_user(v_entry.space_id,p_actor_user_id);
  if v_player_id is null and not private.user_is_global_admin(p_actor_user_id) then raise exception 'El usuario no controla un Player activo de este Space'; end if;

  if v_entry.item_id is not null then
    select * into v_item from public.space_inventory_items where id=v_entry.item_id and space_id=v_entry.space_id and active=true;
    if not found then raise exception 'El ítem enlazado ya no está disponible'; end if;
    if v_item.stock_source='managed' then
      select * into v_movement from public.record_space_inventory_movement(
        v_item.id,-p_quantity,'VENTA',p_actor_user_id,
        'Venta desde Pizarrón: ' || v_entry.name,'space_board_entry',v_entry.id,
        jsonb_build_object('unit_price',case when v_entry.is_free then 0 else coalesce(v_entry.price,0) end,'board_entry_id',v_entry.id)
      );
    elsif p_commerce_order_id is null then
      raise exception 'El stock de esta entrada pertenece a Commerce; registrá la venta mediante la Caja/checkout canónico';
    end if;
  end if;

  v_price := case when v_entry.is_free then 0 else coalesce(v_entry.price,0) end;
  insert into public.space_board_events(
    space_id,board_entry_id,event_type,quantity,unit_price,currency,total_amount,
    inventory_movement_id,commerce_order_id,player_id,user_id,note
  ) values (
    v_entry.space_id,v_entry.id,case when v_entry.is_free then 'REGALO' else 'VENTA' end,p_quantity,v_price,v_entry.currency,round(v_price*p_quantity,2),
    v_movement.id,p_commerce_order_id,v_player_id,p_actor_user_id,p_note
  ) returning * into v_event;
  return v_event;
end;
$$;

revoke all on function public.record_space_board_sale(uuid,numeric,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_space_board_sale(uuid,numeric,uuid,text,uuid) to service_role;

alter table public.space_board_events enable row level security;
revoke all on public.space_board_events from anon,authenticated;
grant select on public.space_board_events to authenticated;
create policy space_board_events_member_select on public.space_board_events for select to authenticated
using(public.space_role_for_current_user(space_id) is not null);

commit;