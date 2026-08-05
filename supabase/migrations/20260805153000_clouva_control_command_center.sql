begin;

-- CLOUVA CONTROL reads operational data through security-definer RPCs that
-- validate the real admin role. The APK never receives a service-role key.
create or replace function public.clouva_control_processes(limit_per_source integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(limit_per_source, 20), 50));
  payload jsonb;
begin
  if not private.is_clouva_admin() then
    raise exception 'Acceso administrativo requerido' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(process_row) order by process_row.created_at desc nulls last), '[]'::jsonb)
    into payload
  from (
    select * from (
      select
        id::text as id,
        'avatar_analyzer_jobs'::text as source,
        'Analizador de avatar'::text as label,
        coalesce(status, 'unknown')::text as status,
        progress::double precision as progress,
        user_id::text as user_id,
        error_message::text as error,
        created_at,
        updated_at
      from public.avatar_analyzer_jobs
      order by created_at desc
      limit safe_limit
    ) avatar_jobs

    union all

    select * from (
      select
        id::text,
        'ai_image_generation_jobs'::text,
        'Generación de imágenes'::text,
        coalesce(status, 'unknown')::text,
        null::double precision,
        requested_by::text,
        error_code::text,
        created_at,
        completed_at
      from public.ai_image_generation_jobs
      order by created_at desc
      limit safe_limit
    ) image_jobs

    union all

    select * from (
      select
        id::text,
        'vip_profile_generation_jobs'::text,
        'Generación de identidad VIP'::text,
        coalesce(status, 'unknown')::text,
        null::double precision,
        user_id::text,
        error_message::text,
        created_at,
        coalesce(updated_at, completed_at)
      from public.vip_profile_generation_jobs
      order by created_at desc
      limit safe_limit
    ) vip_jobs

    union all

    select * from (
      select
        id::text,
        'social_import_sessions'::text,
        'Importación social'::text,
        coalesce(status, 'unknown')::text,
        null::double precision,
        user_id::text,
        error_message::text,
        created_at,
        coalesce(updated_at, completed_at)
      from public.social_import_sessions
      order by created_at desc
      limit safe_limit
    ) social_jobs

    union all

    select * from (
      select
        id::text,
        'billing_payments'::text,
        'Pagos'::text,
        coalesce(status, 'unknown')::text,
        null::double precision,
        user_id::text,
        status_detail::text,
        created_at,
        updated_at
      from public.billing_payments
      order by created_at desc
      limit safe_limit
    ) payment_jobs

    union all

    select * from (
      select
        id::text,
        'billing_subscriptions'::text,
        'Suscripciones'::text,
        coalesce(status, 'unknown')::text,
        null::double precision,
        user_id::text,
        provider_status::text,
        created_at,
        updated_at
      from public.billing_subscriptions
      order by created_at desc
      limit safe_limit
    ) subscription_jobs

    union all

    select * from (
      select
        id::text,
        'service_orders'::text,
        'Órdenes de servicios'::text,
        coalesce(status, 'unknown')::text,
        null::double precision,
        user_id::text,
        notes::text,
        created_at,
        updated_at
      from public.service_orders
      order by created_at desc
      limit safe_limit
    ) service_jobs

    union all

    select * from (
      select
        order_row.id::text,
        'store_orders'::text,
        case
          when order_row.has_physical then 'Pedido físico'::text
          else 'Pedido digital 3D'::text
        end,
        case
          when order_row.payment_status::text in ('failed', 'refunded') then order_row.payment_status::text
          when order_row.payment_status::text <> 'paid' then order_row.payment_status::text
          else coalesce(order_row.fulfillment_status::text, order_row.status::text, 'pending')
        end as process_status,
        null::double precision,
        order_row.buyer_id::text,
        case
          when order_row.fulfillment_status::text = 'stock_conflict'
            then 'El pago fue registrado, pero el stock necesita reconciliación antes de continuar.'::text
          else null::text
        end,
        order_row.created_at,
        coalesce(order_row.completed_at, order_row.paid_at, order_row.created_at)
      from (
        select
          o.*,
          exists (
            select 1
            from public.commerce_order_items oi
            where oi.order_id = o.id
              and oi.product_type = 'physical'
          ) as has_physical
        from public.commerce_orders o
        order by o.created_at desc
        limit safe_limit
      ) order_row
    ) store_jobs
  ) process_row;

  return payload;
end;
$$;

revoke all on function public.clouva_control_processes(integer) from public;
grant execute on function public.clouva_control_processes(integer) to authenticated;

create or replace function public.clouva_control_commerce_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  payload jsonb;
begin
  if not private.is_clouva_admin() then
    raise exception 'Acceso administrativo requerido' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'available', true,
    'approvedPaymentsToday', (
      select count(*)
      from public.commerce_orders
      where payment_status = 'paid'
        and coalesce(paid_at, created_at) >= date_trunc('day', now())
    ),
    'pendingPayments', (
      select count(*)
      from public.commerce_orders
      where payment_status = 'pending'
    ),
    'refundsToday', (
      select count(*)
      from public.commerce_orders
      where payment_status = 'refunded'
        and coalesce(refunded_at, created_at) >= date_trunc('day', now())
    ),
    'physicalOrdersToday', (
      select count(distinct o.id)
      from public.commerce_orders o
      join public.commerce_order_items oi on oi.order_id = o.id
      where oi.product_type = 'physical'
        and o.created_at >= date_trunc('day', now())
    ),
    'digitalDeliveriesToday', (
      select count(*)
      from public.commerce_order_items oi
      where oi.product_type in ('digital', 'avatar_item', 'asset_3d', 'music', 'beat', 'exclusive_content', 'bundle')
        and oi.delivery_status = 'delivered'
        and coalesce(oi.delivered_at, oi.delivery_claimed_at) >= date_trunc('day', now())
    ),
    'recentOrders', (
      select coalesce(jsonb_agg(order_payload order by created_at desc), '[]'::jsonb)
      from (
        select
          o.created_at,
          jsonb_build_object(
            'id', o.id::text,
            'orderNumber', null,
            'total', coalesce(o.total, 0),
            'currency', coalesce(o.currency, 'ARS'),
            'paymentStatus', coalesce(o.payment_status::text, 'unknown'),
            'shippingStatus', coalesce(shipment.status::text, o.fulfillment_status::text, 'unknown'),
            'status', coalesce(o.status::text, 'unknown'),
            'createdAt', o.created_at,
            'paidAt', o.paid_at
          ) as order_payload
        from public.commerce_orders o
        left join lateral (
          select s.status
          from public.commerce_shipments s
          where s.order_id = o.id
          order by s.updated_at desc, s.created_at desc
          limit 1
        ) shipment on true
        order by o.created_at desc
        limit 20
      ) recent
    )
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.clouva_control_commerce_summary() from public;
grant execute on function public.clouva_control_commerce_summary() to authenticated;

commit;
