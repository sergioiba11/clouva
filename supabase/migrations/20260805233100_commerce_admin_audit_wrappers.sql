-- Atomic audit wrappers around the explicit commerce admin operations.
-- The underlying money state remains webhook-owned; these wrappers only
-- operate stock-conflict resolution and physical fulfillment.

begin;

create or replace function public.admin_resolve_commerce_stock_conflict(
  p_order_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_order jsonb;
  next_order jsonb;
  result jsonb;
begin
  select to_jsonb(o)
    into previous_order
  from public.commerce_orders o
  where o.id = p_order_id;

  result := public.resolve_commerce_stock_conflict(p_order_id, p_admin_user_id);

  select to_jsonb(o)
    into next_order
  from public.commerce_orders o
  where o.id = p_order_id;

  insert into public.admin_audit_log(
    admin_user_id,
    action,
    entity_type,
    entity_id,
    previous_data,
    new_data
  )
  values (
    p_admin_user_id,
    'resolve_commerce_stock_conflict',
    'commerce_orders',
    p_order_id,
    previous_order,
    next_order
  );

  return result;
end;
$$;

create or replace function public.admin_set_commerce_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_carrier text,
  p_tracking_number text,
  p_tracking_url text,
  p_label_url text,
  p_note text,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_state jsonb;
  next_state jsonb;
  result jsonb;
begin
  select jsonb_build_object(
    'order', to_jsonb(o),
    'shipment', to_jsonb(s)
  )
    into previous_state
  from public.commerce_orders o
  left join public.commerce_shipments s
    on s.order_id = o.id and s.shipment_group = 'primary'
  where o.id = p_order_id;

  result := public.admin_update_commerce_fulfillment(
    p_order_id,
    p_fulfillment_status,
    p_carrier,
    p_tracking_number,
    p_tracking_url,
    p_label_url,
    p_note,
    p_admin_user_id
  );

  select jsonb_build_object(
    'order', to_jsonb(o),
    'shipment', to_jsonb(s)
  )
    into next_state
  from public.commerce_orders o
  left join public.commerce_shipments s
    on s.order_id = o.id and s.shipment_group = 'primary'
  where o.id = p_order_id;

  insert into public.admin_audit_log(
    admin_user_id,
    action,
    entity_type,
    entity_id,
    previous_data,
    new_data
  )
  values (
    p_admin_user_id,
    'update_commerce_fulfillment',
    'commerce_orders',
    p_order_id,
    previous_state,
    next_state
  );

  return result;
end;
$$;

revoke all on function public.admin_resolve_commerce_stock_conflict(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_set_commerce_fulfillment(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_resolve_commerce_stock_conflict(uuid, uuid) to service_role;
grant execute on function public.admin_set_commerce_fulfillment(uuid, text, text, text, text, text, text, uuid) to service_role;

commit;
