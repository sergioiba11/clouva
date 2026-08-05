-- Audited, idempotent admin entrypoint for future legacy rows created while
-- the old tables remain in compatibility mode.

create or replace function public.admin_migrate_legacy_store_to_commerce(
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
  select to_jsonb(status)
    into previous_state
  from public.commerce_legacy_compatibility_status status;

  result := public.migrate_legacy_store_to_commerce();

  select to_jsonb(status)
    into next_state
  from public.commerce_legacy_compatibility_status status;

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
    'migrate_legacy_store_to_commerce',
    'commerce_legacy_compatibility',
    gen_random_uuid(),
    previous_state,
    jsonb_build_object('status', next_state, 'result', result)
  );

  return jsonb_build_object('result', result, 'status', next_state);
end;
$$;

revoke all on function public.admin_migrate_legacy_store_to_commerce(uuid) from public, anon, authenticated;
grant execute on function public.admin_migrate_legacy_store_to_commerce(uuid) to service_role;
