begin;

create or replace function public.record_space_inventory_movement(
  p_item_id uuid,
  p_delta numeric,
  p_movement_type text,
  p_actor_user_id uuid,
  p_reason text default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.space_inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.space_inventory_items%rowtype;
  v_before numeric(18,4);
  v_after numeric(18,4);
  v_player_id uuid;
  v_role text;
  v_movement public.space_inventory_movements%rowtype;
  v_needed numeric(18,4);
begin
  if p_actor_user_id is null or p_delta is null or p_delta = 0 then raise exception 'Movimiento inválido'; end if;
  if p_movement_type not in ('COMPRA','INGRESO','CONSUMO','VENTA','REGALO','ROTURA','PERDIDA','AJUSTE') then raise exception 'Tipo de movimiento inválido'; end if;

  select * into v_item from public.space_inventory_items where id=p_item_id and active=true for update;
  if not found then raise exception 'Ítem inexistente'; end if;
  if v_item.stock_source <> 'managed' then raise exception 'El stock de este ítem pertenece al Commerce canónico'; end if;

  v_role := private.space_role_for_user(v_item.space_id,p_actor_user_id);
  if not private.user_is_global_admin(p_actor_user_id) then
    if p_movement_type='VENTA' then
      if v_role not in ('owner','admin','manager','inventory','sales') then raise exception 'Sin permiso para registrar ventas'; end if;
    elsif v_role not in ('owner','admin','manager','inventory') then
      raise exception 'Sin permiso de inventario';
    end if;
  end if;

  v_player_id := private.space_player_for_user(v_item.space_id,p_actor_user_id);
  if v_player_id is null and not private.user_is_global_admin(p_actor_user_id) then raise exception 'El usuario no controla un Player activo de este Space'; end if;
  v_before := v_item.quantity; v_after := v_before + p_delta;
  if v_after < 0 then raise exception 'Stock insuficiente'; end if;

  update public.space_inventory_items
  set quantity=v_after,
      last_purchase_at=case when p_movement_type='COMPRA' and p_delta>0 then now() else last_purchase_at end,
      updated_at=now()
  where id=v_item.id;

  insert into public.space_inventory_movements(
    space_id,item_id,delta,unit,movement_type,reason,reference_type,reference_id,
    player_id,user_id,quantity_before,quantity_after,metadata
  ) values (
    v_item.space_id,v_item.id,p_delta,v_item.unit,p_movement_type,p_reason,p_reference_type,p_reference_id,
    v_player_id,p_actor_user_id,v_before,v_after,coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_movement;

  if v_item.minimum_quantity > 0 and v_after <= v_item.minimum_quantity then
    v_needed := greatest(coalesce(v_item.ideal_quantity,v_item.minimum_quantity)-v_after, 0.0001);
    insert into public.space_inventory_purchase_requests(
      space_id,item_id,name,quantity_needed,unit,priority,estimated_price,supplier,status,source,
      added_by_player_id,added_by_user_id,notes
    ) values (
      v_item.space_id,v_item.id,v_item.name,v_needed,v_item.unit,'normal',
      case when v_item.replacement_cost is not null then v_item.replacement_cost*v_needed else null end,
      v_item.supplier,'pendiente','stock_minimum',v_player_id,p_actor_user_id,'Generado automáticamente por stock mínimo.'
    ) on conflict do nothing;
  end if;
  return v_movement;
end;
$$;

revoke all on function public.record_space_inventory_movement(uuid,numeric,text,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_space_inventory_movement(uuid,numeric,text,uuid,text,text,uuid,jsonb) to service_role;

commit;