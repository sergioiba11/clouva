begin;

alter table public.clouva_qr_registry
  drop constraint if exists clouva_qr_registry_entity_type_check;

alter table public.clouva_qr_registry
  add constraint clouva_qr_registry_entity_type_check
  check (entity_type in ('PRODUCT','VARIANT','ITEM','USER','SPACE'));

drop function if exists public.get_or_create_clouva_qr(text, uuid, uuid, uuid, text, jsonb);
create function public.get_or_create_clouva_qr(
  p_entity_type text,
  p_entity_id uuid,
  p_actor_id uuid,
  p_studio_id uuid default null,
  p_destination_path text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.clouva_qr_registry;
  v_created public.clouva_qr_registry;
  v_token text;
begin
  if p_entity_type not in ('USER', 'ITEM', 'SPACE') then
    raise exception 'PRODUCT y VARIANT se crean desde el registro canónico de identificadores comerciales.';
  end if;
  if p_entity_type = 'USER' and not exists (
    select 1 from public.players player where player.owner_user_id = p_entity_id
  ) then
    raise exception 'El usuario todavía no tiene un Player asociado.';
  end if;
  if p_entity_type = 'ITEM' and p_studio_id is null then
    raise exception 'ITEM requiere un Studio de origen.';
  end if;
  if p_entity_type = 'SPACE' and not exists (
    select 1 from public.spaces space where space.id = p_entity_id
  ) then
    raise exception 'El espacio no existe.';
  end if;
  if p_destination_path is not null and (p_destination_path not like '/%' or p_destination_path like '//%') then
    raise exception 'El destino público debe ser una ruta interna válida.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_entity_type || ':' || p_entity_id::text, 0));

  select * into v_existing
  from public.clouva_qr_registry registry
  where registry.entity_type = p_entity_type
    and registry.entity_id = p_entity_id
    and registry.status = 'ACTIVE'
    and registry.is_canonical
  order by registry.created_at
  limit 1;
  if found then
    if p_destination_path is not null and v_existing.destination_path is distinct from p_destination_path then
      update public.clouva_qr_registry
      set destination_path = p_destination_path,
          metadata = coalesce(p_metadata, '{}'::jsonb),
          updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    end if;
    return jsonb_build_object('qr', to_jsonb(v_existing), 'created', false);
  end if;

  loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    begin
      insert into public.clouva_qr_registry(
        public_token, entity_type, entity_id, studio_id, status, is_canonical,
        destination_path, metadata, created_by
      ) values (
        v_token, p_entity_type, p_entity_id, p_studio_id, 'ACTIVE', true,
        p_destination_path, coalesce(p_metadata, '{}'::jsonb), p_actor_id
      ) returning * into v_created;
      return jsonb_build_object('qr', to_jsonb(v_created), 'created', true);
    exception when unique_violation then
      select * into v_existing
      from public.clouva_qr_registry registry
      where registry.entity_type = p_entity_type
        and registry.entity_id = p_entity_id
        and registry.status = 'ACTIVE'
        and registry.is_canonical
      limit 1;
      if found then
        return jsonb_build_object('qr', to_jsonb(v_existing), 'created', false);
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.get_or_create_clouva_qr(text, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.get_or_create_clouva_qr(text, uuid, uuid, uuid, text, jsonb) to service_role;

commit;
