-- Canonical CLOUVA QR registry.
-- Product/variant QR identifiers remain in commerce_product_identifiers as the
-- commerce source of truth, while this registry gives CLOUVA one resolver for
-- PRODUCT, VARIANT, ITEM and USER entities without exposing internal ids.

begin;

create table if not exists public.clouva_qr_registry (
  id uuid primary key default gen_random_uuid(),
  public_token text not null,
  entity_type text not null check (entity_type in ('PRODUCT', 'VARIANT', 'ITEM', 'USER')),
  entity_id uuid not null,
  studio_id uuid references public.studios(id) on delete cascade,
  source_identifier_id uuid unique references public.commerce_product_identifiers(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  is_canonical boolean not null default true,
  destination_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clouva_qr_destination_path_safe check (
    destination_path is null
    or (destination_path like '/%' and destination_path not like '//%')
  )
);

create unique index if not exists clouva_qr_registry_public_token_unique
  on public.clouva_qr_registry(public_token);
create unique index if not exists clouva_qr_registry_active_canonical_entity_unique
  on public.clouva_qr_registry(entity_type, entity_id)
  where status = 'ACTIVE' and is_canonical;
create index if not exists clouva_qr_registry_entity_idx
  on public.clouva_qr_registry(entity_type, entity_id, status);
create index if not exists clouva_qr_registry_studio_idx
  on public.clouva_qr_registry(studio_id)
  where studio_id is not null;

alter table public.clouva_qr_registry enable row level security;

-- Backfill every active product QR. If legacy data contains more than one active
-- QR for the same entity, all tokens keep resolving and only the oldest primary
-- candidate becomes canonical.
with ranked as (
  select
    identifier.id as source_identifier_id,
    identifier.public_token,
    case when identifier.catalog_variant_id is null then 'PRODUCT' else 'VARIANT' end as entity_type,
    coalesce(identifier.catalog_variant_id, identifier.catalog_product_id) as entity_id,
    identifier.studio_id,
    identifier.destination_path,
    identifier.destination_metadata,
    identifier.created_by,
    identifier.created_at,
    row_number() over (
      partition by
        case when identifier.catalog_variant_id is null then 'PRODUCT' else 'VARIANT' end,
        coalesce(identifier.catalog_variant_id, identifier.catalog_product_id)
      order by identifier.is_primary desc, identifier.created_at asc, identifier.id asc
    ) as entity_rank
  from public.commerce_product_identifiers identifier
  where identifier.identifier_type = 'clouva_qr'
    and identifier.status = 'active'
    and identifier.public_token is not null
)
insert into public.clouva_qr_registry(
  public_token, entity_type, entity_id, studio_id, source_identifier_id,
  status, is_canonical, destination_path, metadata, created_by, created_at, updated_at
)
select
  ranked.public_token,
  ranked.entity_type,
  ranked.entity_id,
  ranked.studio_id,
  ranked.source_identifier_id,
  'ACTIVE',
  ranked.entity_rank = 1,
  ranked.destination_path,
  coalesce(ranked.destination_metadata, '{}'::jsonb),
  ranked.created_by,
  ranked.created_at,
  now()
from ranked
on conflict (source_identifier_id) do nothing;

create or replace function public.sync_commerce_qr_to_clouva_registry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
  v_is_canonical boolean;
begin
  if new.identifier_type <> 'clouva_qr' or new.public_token is null then
    return new;
  end if;

  v_entity_type := case when new.catalog_variant_id is null then 'PRODUCT' else 'VARIANT' end;
  v_entity_id := coalesce(new.catalog_variant_id, new.catalog_product_id);

  select not exists (
    select 1
    from public.clouva_qr_registry registry
    where registry.entity_type = v_entity_type
      and registry.entity_id = v_entity_id
      and registry.status = 'ACTIVE'
      and registry.is_canonical
      and registry.source_identifier_id is distinct from new.id
  ) into v_is_canonical;

  insert into public.clouva_qr_registry(
    public_token, entity_type, entity_id, studio_id, source_identifier_id,
    status, is_canonical, destination_path, metadata, created_by,
    revoked_at, created_at, updated_at
  ) values (
    new.public_token,
    v_entity_type,
    v_entity_id,
    new.studio_id,
    new.id,
    case when new.status = 'active' then 'ACTIVE' else 'REVOKED' end,
    case when new.status = 'active' then v_is_canonical else false end,
    new.destination_path,
    coalesce(new.destination_metadata, '{}'::jsonb),
    coalesce(new.updated_by, new.created_by),
    case when new.status = 'active' then null else coalesce(new.disabled_at, now()) end,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (source_identifier_id) do update set
    public_token = excluded.public_token,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    studio_id = excluded.studio_id,
    status = excluded.status,
    is_canonical = case
      when excluded.status = 'ACTIVE' then public.clouva_qr_registry.is_canonical or excluded.is_canonical
      else false
    end,
    destination_path = excluded.destination_path,
    metadata = excluded.metadata,
    revoked_at = excluded.revoked_at,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists commerce_product_identifiers_sync_clouva_qr on public.commerce_product_identifiers;
create trigger commerce_product_identifiers_sync_clouva_qr
  after insert or update of public_token, status, destination_path, destination_metadata, catalog_product_id, catalog_variant_id
  on public.commerce_product_identifiers
  for each row
  execute function public.sync_commerce_qr_to_clouva_registry();

-- Service-role-only idempotent allocator. API routes perform the user/studio
-- authorization first, then this RPC provides concurrency-safe get-or-create.
create or replace function public.get_or_create_clouva_qr(
  p_entity_type text,
  p_entity_id uuid,
  p_actor_id uuid,
  p_studio_id uuid default null,
  p_destination_path text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.clouva_qr_registry
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.clouva_qr_registry;
  v_created public.clouva_qr_registry;
  v_token text;
begin
  if p_entity_type not in ('USER', 'ITEM') then
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
    return v_existing;
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
      exit;
    exception when unique_violation then
      select * into v_existing
      from public.clouva_qr_registry registry
      where registry.entity_type = p_entity_type
        and registry.entity_id = p_entity_id
        and registry.status = 'ACTIVE'
        and registry.is_canonical
      limit 1;
      if found then return v_existing; end if;
    end;
  end loop;

  return v_created;
end;
$$;

revoke all on table public.clouva_qr_registry from anon, authenticated;
revoke all on function public.get_or_create_clouva_qr(text, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.get_or_create_clouva_qr(text, uuid, uuid, uuid, text, jsonb) to service_role;

commit;
