begin;

create or replace function public.clouva_control_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select private.is_clouva_admin();
$$;

revoke all on function public.clouva_control_is_admin() from public;
grant execute on function public.clouva_control_is_admin() to authenticated;

create or replace function public.clouva_control_processes(limit_per_source integer default 15)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(limit_per_source, 15), 50));
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
  ) process_row;

  return payload;
end;
$$;

revoke all on function public.clouva_control_processes(integer) from public;
grant execute on function public.clouva_control_processes(integer) to authenticated;

drop policy if exists "admins insert audit logs" on public.admin_audit_logs;
create policy "admins insert audit logs"
on public.admin_audit_logs for insert
to authenticated
with check (
  (select private.is_clouva_admin())
  and admin_user_id = (select auth.uid())
);

drop policy if exists "admins upload issue screenshots" on storage.objects;
create policy "admins upload issue screenshots"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'admin-mobile-issues'
  and (select private.is_clouva_admin())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

commit;
