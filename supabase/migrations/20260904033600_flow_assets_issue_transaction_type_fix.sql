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
    'purchase',
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
