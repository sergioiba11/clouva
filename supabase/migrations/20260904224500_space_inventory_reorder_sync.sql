begin;

create or replace function public.sync_space_inventory_reorder(
  p_item_id uuid,
  p_actor_user_id uuid
)
returns public.space_inventory_purchase_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.space_inventory_items%rowtype;
  v_request public.space_inventory_purchase_requests%rowtype;
  v_quantity numeric(18,4);
  v_target numeric(18,4);
  v_needed numeric(18,4);
  v_role text;
  v_player_id uuid;
begin
  if p_actor_user_id is null then raise exception 'Actor requerido'; end if;

  select * into v_item
  from public.space_inventory_items
  where id = p_item_id and active = true
  for update;
  if not found then raise exception 'Ítem inexistente'; end if;

  v_role := private.space_role_for_user(v_item.space_id, p_actor_user_id);
  if not private.user_is_global_admin(p_actor_user_id)
     and v_role not in ('owner','admin','manager','inventory','sales') then
    raise exception 'Sin permiso para sincronizar reposición';
  end if;

  v_player_id := private.space_player_for_user(v_item.space_id, p_actor_user_id);
  if v_player_id is null and not private.user_is_global_admin(p_actor_user_id) then
    raise exception 'El usuario no controla un Player activo de este Space';
  end if;

  if v_item.stock_source = 'commerce_variant' then
    select coalesce(v.stock, 0)::numeric(18,4) into v_quantity
    from public.commerce_product_variants v
    where v.id = v_item.commerce_variant_id;
    if v_quantity is null then raise exception 'Variante de Commerce inexistente'; end if;
  elsif v_item.stock_source = 'commerce_product' then
    select coalesce(p.stock, 0)::numeric(18,4) into v_quantity
    from public.commerce_products p
    where p.id = v_item.commerce_product_id;
    if v_quantity is null then raise exception 'Producto de Commerce inexistente'; end if;
  else
    v_quantity := v_item.quantity;
  end if;

  select * into v_request
  from public.space_inventory_purchase_requests
  where space_id = v_item.space_id
    and item_id = v_item.id
    and source = 'stock_minimum'
    and status in ('pendiente','comprado')
  order by case status when 'comprado' then 1 else 2 end, created_at desc
  limit 1
  for update;

  if v_item.minimum_quantity <= 0 or v_quantity > v_item.minimum_quantity then
    if found and v_request.status = 'pendiente' then
      update public.space_inventory_purchase_requests
      set status = 'cancelado',
          notes = 'Cancelado automáticamente: el stock volvió a estar por encima del mínimo.',
          updated_at = now()
      where id = v_request.id
      returning * into v_request;
      return v_request;
    end if;
    return null;
  end if;

  v_target := greatest(coalesce(v_item.ideal_quantity, v_item.minimum_quantity), v_item.minimum_quantity);
  v_needed := greatest(v_target - v_quantity, 0.0001);

  if found then
    if v_request.status = 'pendiente' then
      update public.space_inventory_purchase_requests
      set name = v_item.name,
          quantity_needed = v_needed,
          unit = v_item.unit,
          estimated_price = case
            when v_item.replacement_cost is not null then round((v_item.replacement_cost * v_needed)::numeric, 2)
            else null
          end,
          supplier = v_item.supplier,
          updated_at = now()
      where id = v_request.id
      returning * into v_request;
    end if;
    return v_request;
  end if;

  insert into public.space_inventory_purchase_requests(
    space_id,item_id,name,quantity_needed,unit,priority,estimated_price,supplier,status,source,
    added_by_player_id,added_by_user_id,notes
  ) values (
    v_item.space_id,v_item.id,v_item.name,v_needed,v_item.unit,'normal',
    case when v_item.replacement_cost is not null then round((v_item.replacement_cost * v_needed)::numeric, 2) else null end,
    v_item.supplier,'pendiente','stock_minimum',v_player_id,p_actor_user_id,
    'Generado automáticamente por stock mínimo.'
  ) returning * into v_request;

  return v_request;
exception
  when unique_violation then
    select * into v_request
    from public.space_inventory_purchase_requests
    where space_id = v_item.space_id
      and item_id = v_item.id
      and source = 'stock_minimum'
      and status in ('pendiente','comprado')
    order by created_at desc
    limit 1;
    return v_request;
end;
$$;

revoke all on function public.sync_space_inventory_reorder(uuid,uuid) from public, anon, authenticated;
grant execute on function public.sync_space_inventory_reorder(uuid,uuid) to service_role;

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

  v_before := v_item.quantity;
  v_after := v_before + p_delta;
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

  perform public.sync_space_inventory_reorder(v_item.id, p_actor_user_id);
  return v_movement;
end;
$$;

revoke all on function public.record_space_inventory_movement(uuid,numeric,text,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_space_inventory_movement(uuid,numeric,text,uuid,text,text,uuid,jsonb) to service_role;

commit;
