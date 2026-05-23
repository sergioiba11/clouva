create or replace function public.order_state_key(o public.orders)
returns text language sql immutable as $$
  select case
    when o.payment_status = 'cancelado' or o.shipping_status = 'cancelado' then 'cancelado'
    when o.shipping_status = 'enviado' then 'enviado'
    when o.shipping_status = 'preparando' then 'preparando'
    when o.payment_status = 'pagado' then 'pagado'
    else 'pendiente'
  end
$$;

create or replace function public.ensure_stock_before_order_items()
returns trigger language plpgsql as $$
declare available_stock int;
begin
  select coalesce(sum(stock),0) into available_stock from public.product_variants where product_id = new.product_id;
  if available_stock < new.qty then
    raise exception 'Stock insuficiente para producto %', new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ensure_stock_before_order_items on public.order_items;
create trigger trg_ensure_stock_before_order_items
before insert on public.order_items
for each row execute function public.ensure_stock_before_order_items();

create or replace function public.apply_stock_on_order_state_change()
returns trigger language plpgsql as $$
declare old_state text; new_state text; line record;
begin
  old_state := public.order_state_key(old);
  new_state := public.order_state_key(new);
  if old_state = new_state then return new; end if;

  if old_state <> 'pagado' and new_state = 'pagado' then
    for line in select product_id, qty from public.order_items where order_id = new.id loop
      update public.product_variants set stock = greatest(0, stock - line.qty) where id in (
        select id from public.product_variants where product_id = line.product_id order by id limit 1
      );
      insert into public.stock_movements(product_id,movement_type,quantity,note) values (line.product_id,'venta',line.qty,'Descuento por pago de pedido '||new.id);
    end loop;
  end if;

  if old_state = 'pagado' and new_state = 'cancelado' then
    for line in select product_id, qty from public.order_items where order_id = new.id loop
      update public.product_variants set stock = stock + line.qty where id in (
        select id from public.product_variants where product_id = line.product_id order by id limit 1
      );
      insert into public.stock_movements(product_id,movement_type,quantity,note) values (line.product_id,'devolucion',line.qty,'Restitución por cancelación de pedido '||new.id);
    end loop;
  end if;

  return new;
end $$;

drop trigger if exists trg_apply_stock_on_order_state_change on public.orders;
create trigger trg_apply_stock_on_order_state_change
after update on public.orders
for each row execute function public.apply_stock_on_order_state_change();
