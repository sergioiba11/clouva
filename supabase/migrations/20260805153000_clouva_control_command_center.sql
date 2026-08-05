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
        id::text,
        'store_orders'::text,
        'Pedido físico'::text,
        case
          when coalesce(shipping_status::text, '') = 'entregado' then 'entregado'
          when coalesce(payment_status::text, '') = 'pagado'
               and coalesce(shipping_status::text, '') not in ('', 'pendiente') then shipping_status::text
          when coalesce(payment_status::text, '') = 'pagado' then 'pagado'
          else coalesce(payment_status::text, status::text, 'pendiente')
        end as status,
        null::double precision,
        customer_id::text,
        null::text,
        created_at,
        coalesce(paid_at, created_at)
      from public.orders
      order by created_at desc
      limit safe_limit
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
      from public.orders
      where payment_status::text = 'pagado'
        and coalesce(paid_at, created_at) >= date_trunc('day', now())
    ),
    'pendingPayments', (
      select count(*)
      from public.orders
      where payment_status::text in ('pendiente', 'pending')
    ),
    'refundsToday', (
      select count(*)
      from public.orders
      where payment_status::text in ('reembolsado', 'refunded')
        and created_at >= date_trunc('day', now())
    ),
    'physicalOrdersToday', (
      select count(*)
      from public.orders
      where created_at >= date_trunc('day', now())
    ),
    'digitalDeliveriesToday', 0,
    'recentOrders', (
      select coalesce(jsonb_agg(order_payload order by created_at desc), '[]'::jsonb)
      from (
        select
          created_at,
          jsonb_build_object(
            'id', id::text,
            'orderNumber', order_number,
            'total', coalesce(total, 0),
            'currency', coalesce(currency, 'ARS'),
            'paymentStatus', coalesce(payment_status::text, 'unknown'),
            'shippingStatus', coalesce(shipping_status::text, 'unknown'),
            'status', coalesce(status::text, 'unknown'),
            'createdAt', created_at,
            'paidAt', paid_at
          ) as order_payload
        from public.orders
        order by created_at desc
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
