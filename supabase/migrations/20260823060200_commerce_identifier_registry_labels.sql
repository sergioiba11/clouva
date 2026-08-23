-- Persistent product identifier registry for CLOUVA / El Iglú.
-- Extends the canonical commerce_product_identifiers table with lifecycle,
-- provenance, stable public QR tokens and immutable history. Label files stay
-- derived artifacts and are never stored in Postgres.

begin;

alter table public.commerce_product_identifiers
  add column if not exists studio_id uuid references public.studios(id) on delete cascade,
  add column if not exists origin text not null default 'manual',
  add column if not exists status text not null default 'active',
  add column if not exists scope text not null default 'spot',
  add column if not exists public_token text,
  add column if not exists destination_type text not null default 'product',
  add column if not exists destination_path text,
  add column if not exists destination_metadata jsonb not null default '{}'::jsonb,
  add column if not exists replaces_identifier_id uuid references public.commerce_product_identifiers(id) on delete restrict,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_identifiers_origin_check'
      and conrelid = 'public.commerce_product_identifiers'::regclass
  ) then
    alter table public.commerce_product_identifiers
      add constraint commerce_product_identifiers_origin_check
      check (origin in ('manufacturer', 'imported', 'manual', 'clouva_generated'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_identifiers_status_check'
      and conrelid = 'public.commerce_product_identifiers'::regclass
  ) then
    alter table public.commerce_product_identifiers
      add constraint commerce_product_identifiers_status_check
      check (status in ('active', 'disabled', 'replaced'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_identifiers_scope_check'
      and conrelid = 'public.commerce_product_identifiers'::regclass
  ) then
    alter table public.commerce_product_identifiers
      add constraint commerce_product_identifiers_scope_check
      check (scope in ('global', 'spot'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'commerce_product_identifiers_destination_check'
      and conrelid = 'public.commerce_product_identifiers'::regclass
  ) then
    alter table public.commerce_product_identifiers
      add constraint commerce_product_identifiers_destination_check
      check (destination_type in ('product', 'variant', 'authenticity', 'product_3d', 'digital_claim', 'experience'));
  end if;
end
$$;

update public.commerce_product_identifiers identifier
set
  origin = case
    when identifier.identifier_type in ('ean_13', 'ean_8', 'upc_a', 'upc_e') then 'manufacturer'
    when identifier.identifier_type in ('clouva_barcode', 'clouva_qr') then 'clouva_generated'
    else identifier.origin
  end,
  scope = case
    when identifier.identifier_type in ('ean_13', 'ean_8', 'upc_a', 'upc_e') then 'global'
    else 'spot'
  end,
  studio_id = coalesce(identifier.studio_id, spot.studio_id),
  updated_at = coalesce(identifier.updated_at, identifier.created_at, now())
from public.commerce_spots spot
where identifier.spot_id = spot.id;

update public.commerce_product_identifiers identifier
set
  spot_id = (
    select product.spot_id from public.commerce_products product
    where product.catalog_product_id = identifier.catalog_product_id
    order by product.created_at limit 1
  ),
  studio_id = (
    select product.studio_id from public.commerce_products product
    where product.catalog_product_id = identifier.catalog_product_id
    order by product.created_at limit 1
  ),
  updated_at = now()
where identifier.spot_id is null
  and identifier.studio_id is null
  and exists (
    select 1 from public.commerce_products product
    where product.catalog_product_id = identifier.catalog_product_id
  );

update public.commerce_product_identifiers
set public_token = encode(extensions.gen_random_bytes(18), 'hex')
where identifier_type = 'clouva_qr' and public_token is null;

update public.commerce_product_identifiers
set
  value = 'https://clouva.com.ar/q/' || public_token,
  normalized_value = public.normalize_commerce_identifier('https://clouva.com.ar/q/' || public_token),
  destination_type = case when catalog_variant_id is null then 'product' else 'variant' end,
  updated_at = now()
where identifier_type = 'clouva_qr' and public_token is not null;

drop index if exists public.commerce_product_identifiers_global_code_unique;
drop index if exists public.commerce_product_identifiers_spot_sku_unique;

create unique index if not exists commerce_product_identifiers_active_code_unique
  on public.commerce_product_identifiers(identifier_type, normalized_value)
  where status = 'active' and identifier_type <> 'sku';
create unique index if not exists commerce_product_identifiers_active_spot_sku_unique
  on public.commerce_product_identifiers(spot_id, normalized_value)
  where status = 'active' and identifier_type = 'sku' and spot_id is not null;
create unique index if not exists commerce_product_identifiers_public_token_unique
  on public.commerce_product_identifiers(public_token)
  where public_token is not null;
create index if not exists commerce_product_identifiers_studio_idx
  on public.commerce_product_identifiers(studio_id) where studio_id is not null;
create index if not exists commerce_product_identifiers_status_created_idx
  on public.commerce_product_identifiers(status, created_at desc);
create index if not exists commerce_product_identifiers_replaces_idx
  on public.commerce_product_identifiers(replaces_identifier_id) where replaces_identifier_id is not null;
create index if not exists commerce_product_identifiers_disabled_by_idx
  on public.commerce_product_identifiers(disabled_by) where disabled_by is not null;
create index if not exists commerce_product_identifiers_updated_by_idx
  on public.commerce_product_identifiers(updated_by) where updated_by is not null;

create table if not exists public.commerce_product_identifier_events (
  id uuid primary key default gen_random_uuid(),
  identifier_id uuid not null references public.commerce_product_identifiers(id) on delete restrict,
  studio_id uuid references public.studios(id) on delete cascade,
  spot_id uuid references public.commerce_spots(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'disabled', 'replaced', 'primary_changed', 'destination_updated',
    'downloaded_svg', 'downloaded_png', 'downloaded_pdf', 'printed'
  )),
  from_status text,
  to_status text,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commerce_identifier_events_identifier_created_idx
  on public.commerce_product_identifier_events(identifier_id, created_at desc);
create index if not exists commerce_identifier_events_spot_created_idx
  on public.commerce_product_identifier_events(spot_id, created_at desc) where spot_id is not null;
create index if not exists commerce_identifier_events_studio_idx
  on public.commerce_product_identifier_events(studio_id) where studio_id is not null;
create index if not exists commerce_identifier_events_actor_idx
  on public.commerce_product_identifier_events(actor_id) where actor_id is not null;

create or replace function public.prepare_commerce_product_identifier()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_studio_id uuid;
  v_token text;
begin
  new.value := btrim(new.value);
  new.normalized_value := public.normalize_commerce_identifier(new.value);
  new.origin := coalesce(nullif(new.origin, ''), case
    when new.identifier_type in ('ean_13', 'ean_8', 'upc_a', 'upc_e') then 'manufacturer'
    when new.identifier_type in ('clouva_barcode', 'clouva_qr') then 'clouva_generated'
    else 'manual'
  end);
  if new.identifier_type in ('ean_13', 'ean_8', 'upc_a', 'upc_e') and new.origin = 'manual' then
    new.origin := 'manufacturer';
  end if;
  if new.identifier_type in ('clouva_barcode', 'clouva_qr') and new.origin = 'manual' then
    new.origin := 'clouva_generated';
  end if;
  new.scope := case
    when new.identifier_type in ('ean_13', 'ean_8', 'upc_a', 'upc_e') then 'global'
    else coalesce(nullif(new.scope, ''), 'spot')
  end;
  new.status := coalesce(nullif(new.status, ''), 'active');
  new.updated_at := now();

  if new.spot_id is not null and new.studio_id is null then
    select spot.studio_id into v_studio_id from public.commerce_spots spot where spot.id = new.spot_id;
    new.studio_id := v_studio_id;
  end if;

  if new.identifier_type = 'clouva_qr' then
    v_token := coalesce(nullif(new.public_token, ''), encode(extensions.gen_random_bytes(18), 'hex'));
    new.public_token := v_token;
    if new.value = '' or new.value not like '%/q/%' then
      new.value := 'https://clouva.com.ar/q/' || v_token;
    else
      new.value := regexp_replace(new.value, '/q/[^/?#]+([?#].*)?$', '/q/' || v_token);
    end if;
    new.normalized_value := public.normalize_commerce_identifier(new.value);
    if new.destination_type = 'product' and new.catalog_variant_id is not null then
      new.destination_type := 'variant';
    end if;
  end if;
  -- Legacy scanner registration code predates lifecycle states and searches by
  -- normalized_value without a status predicate. Namespacing inactive rows keeps
  -- disabled/replaced codes revoked in every write path while preserving value.
  if new.status <> 'active' then
    new.normalized_value := upper(new.status) || ':' || new.id::text || ':' || public.normalize_commerce_identifier(new.value);
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_product_identifiers_prepare on public.commerce_product_identifiers;
create trigger commerce_product_identifiers_prepare
  before insert or update on public.commerce_product_identifiers
  for each row execute function public.prepare_commerce_product_identifier();

create or replace function public.attach_commerce_identifier_registration_context()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.commerce_product_identifiers
  set spot_id = new.spot_id, studio_id = new.studio_id, updated_at = now()
  where catalog_product_id = new.catalog_product_id
    and spot_id is null
    and studio_id is null;
  return new;
end;
$$;

drop trigger if exists commerce_products_attach_identifier_context on public.commerce_products;
create trigger commerce_products_attach_identifier_context
  after insert on public.commerce_products
  for each row execute function public.attach_commerce_identifier_registration_context();

create or replace function public.audit_commerce_product_identifier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.commerce_product_identifier_events(
      identifier_id, studio_id, spot_id, event_type, to_status, actor_id, metadata
    ) values (
      new.id, new.studio_id, new.spot_id, 'created', new.status, new.created_by,
      jsonb_build_object(
        'type', new.identifier_type,
        'origin', new.origin,
        'value', new.value,
        'replaces_identifier_id', new.replaces_identifier_id
      )
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.commerce_product_identifier_events(
      identifier_id, studio_id, spot_id, event_type, from_status, to_status, actor_id, metadata
    ) values (
      new.id, new.studio_id, new.spot_id,
      case when new.status = 'replaced' then 'replaced' else 'disabled' end,
      old.status, new.status, coalesce(new.disabled_by, new.updated_by),
      jsonb_build_object('replacement_id', (
        select replacement.id from public.commerce_product_identifiers replacement
        where replacement.replaces_identifier_id = new.id order by replacement.created_at desc limit 1
      ))
    );
  end if;
  if old.is_primary is distinct from new.is_primary then
    insert into public.commerce_product_identifier_events(
      identifier_id, studio_id, spot_id, event_type, actor_id, metadata
    ) values (new.id, new.studio_id, new.spot_id, 'primary_changed', new.updated_by,
      jsonb_build_object('from', old.is_primary, 'to', new.is_primary));
  end if;
  if old.destination_type is distinct from new.destination_type
     or old.destination_path is distinct from new.destination_path
     or old.destination_metadata is distinct from new.destination_metadata then
    insert into public.commerce_product_identifier_events(
      identifier_id, studio_id, spot_id, event_type, actor_id, metadata
    ) values (new.id, new.studio_id, new.spot_id, 'destination_updated', new.updated_by,
      jsonb_build_object('destination_type', new.destination_type, 'destination_path', new.destination_path));
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_product_identifiers_audit on public.commerce_product_identifiers;
create trigger commerce_product_identifiers_audit
  after insert or update on public.commerce_product_identifiers
  for each row execute function public.audit_commerce_product_identifier();

drop trigger if exists commerce_product_identifier_events_immutable on public.commerce_product_identifier_events;
create trigger commerce_product_identifier_events_immutable
  before update or delete on public.commerce_product_identifier_events
  for each row execute function public.reject_commerce_immutable_change();

create or replace function public.resolve_commerce_identifier(
  p_spot_id uuid,
  p_value text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'identifier', to_jsonb(identifier),
      'catalog_product', to_jsonb(catalog_product),
      'catalog_variant', case when catalog_variant.id is null then null else to_jsonb(catalog_variant) end,
      'listing', case when listing.id is null then null else to_jsonb(listing) end,
      'listing_variant', case when listing_variant.id is null then null else to_jsonb(listing_variant) end,
      'exists_in_spot', listing.id is not null
    )
    from public.commerce_product_identifiers identifier
    join public.commerce_catalog_products catalog_product on catalog_product.id = identifier.catalog_product_id
    left join public.commerce_catalog_variants catalog_variant on catalog_variant.id = identifier.catalog_variant_id
    left join public.commerce_products listing
      on listing.spot_id = p_spot_id and listing.catalog_product_id = identifier.catalog_product_id
    left join public.commerce_product_variants listing_variant
      on listing_variant.product_id = listing.id
     and (identifier.catalog_variant_id is null or listing_variant.catalog_variant_id = identifier.catalog_variant_id)
    where identifier.status = 'active'
      and identifier.normalized_value = public.normalize_commerce_identifier(p_value)
      and (identifier.scope = 'global' or identifier.spot_id = p_spot_id)
    order by (identifier.spot_id = p_spot_id) desc, identifier.is_primary desc, identifier.created_at
    limit 1
  ), jsonb_build_object('exists', false));
$$;

create or replace function public.create_commerce_product_identifier(
  p_spot_id uuid,
  p_listing_id uuid,
  p_listing_variant_id uuid,
  p_identifier_type text,
  p_value text,
  p_origin text,
  p_is_primary boolean,
  p_actor_id uuid,
  p_public_token text default null,
  p_destination_type text default 'product',
  p_destination_path text default null,
  p_destination_metadata jsonb default '{}'::jsonb,
  p_replaces_identifier_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.commerce_spots%rowtype;
  v_listing public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_existing public.commerce_product_identifiers%rowtype;
  v_identifier public.commerce_product_identifiers%rowtype;
  v_normalized text;
  v_scope text;
  v_conflict_listing public.commerce_products%rowtype;
begin
  if p_identifier_type not in ('ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'clouva_barcode', 'clouva_qr', 'sku') then
    raise exception 'Tipo de identificador inválido.';
  end if;
  if p_origin not in ('manufacturer', 'imported', 'manual', 'clouva_generated') then
    raise exception 'Origen de identificador inválido.';
  end if;
  v_normalized := public.normalize_commerce_identifier(p_value);
  if v_normalized = '' then raise exception 'El código es obligatorio.'; end if;

  select * into v_spot from public.commerce_spots where id = p_spot_id and status = 'active';
  if not found then raise exception 'El Spot no está activo.'; end if;
  select * into v_listing from public.commerce_products
  where id = p_listing_id and spot_id = p_spot_id for update;
  if not found or v_listing.catalog_product_id is null then
    raise exception 'El producto no pertenece al Spot o no tiene identidad global.';
  end if;
  if p_listing_variant_id is not null then
    select * into v_variant from public.commerce_product_variants
    where id = p_listing_variant_id and product_id = p_listing_id for update;
    if not found or v_variant.catalog_variant_id is null then
      raise exception 'La variante no pertenece al producto o no tiene identidad global.';
    end if;
  end if;

  select * into v_existing
  from public.commerce_product_identifiers identifier
  where identifier.status = 'active'
    and identifier.identifier_type = p_identifier_type
    and identifier.normalized_value = v_normalized
    and (p_identifier_type <> 'sku' or identifier.spot_id = p_spot_id)
  order by identifier.created_at
  limit 1;

  if found then
    if v_existing.catalog_product_id = v_listing.catalog_product_id
       and v_existing.catalog_variant_id is not distinct from v_variant.catalog_variant_id then
      return jsonb_build_object('identifier', to_jsonb(v_existing), 'created', false, 'conflict', false);
    end if;
    select * into v_conflict_listing from public.commerce_products
    where catalog_product_id = v_existing.catalog_product_id
    order by (spot_id = p_spot_id) desc, created_at limit 1;
    return jsonb_build_object(
      'created', false,
      'conflict', true,
      'identifier', to_jsonb(v_existing),
      'product', jsonb_build_object(
        'id', v_conflict_listing.id,
        'name', v_conflict_listing.name,
        'slug', v_conflict_listing.slug,
        'spot_id', v_conflict_listing.spot_id
      )
    );
  end if;

  v_scope := case
    when p_identifier_type in ('ean_13', 'ean_8', 'upc_a', 'upc_e') then 'global'
    else 'spot'
  end;

  insert into public.commerce_product_identifiers(
    catalog_product_id, catalog_variant_id, studio_id, spot_id, identifier_type,
    value, normalized_value, origin, status, scope, is_primary, public_token,
    destination_type, destination_path, destination_metadata,
    replaces_identifier_id, created_by
  ) values (
    v_listing.catalog_product_id, v_variant.catalog_variant_id, v_spot.studio_id, p_spot_id,
    p_identifier_type, btrim(p_value), v_normalized, p_origin, 'active', v_scope,
    coalesce(p_is_primary, false), nullif(p_public_token, ''), p_destination_type,
    p_destination_path, coalesce(p_destination_metadata, '{}'::jsonb),
    p_replaces_identifier_id, p_actor_id
  ) returning * into v_identifier;

  if p_identifier_type = 'sku' and p_listing_variant_id is not null then
    update public.commerce_product_variants set sku = v_identifier.value where id = p_listing_variant_id;
  end if;
  return jsonb_build_object('identifier', to_jsonb(v_identifier), 'created', true, 'conflict', false);
end;
$$;

create or replace function public.disable_commerce_product_identifier(
  p_identifier_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identifier public.commerce_product_identifiers%rowtype;
begin
  select * into v_identifier from public.commerce_product_identifiers
  where id = p_identifier_id for update;
  if not found then raise exception 'El identificador no existe.'; end if;
  if v_identifier.status <> 'active' then return to_jsonb(v_identifier); end if;
  update public.commerce_product_identifiers
  set status = 'disabled', disabled_at = now(), disabled_by = p_actor_id, is_primary = false
  where id = p_identifier_id returning * into v_identifier;
  if v_identifier.identifier_type = 'sku' and v_identifier.catalog_variant_id is not null then
    update public.commerce_product_variants variant
    set sku = null
    where variant.catalog_variant_id = v_identifier.catalog_variant_id
      and variant.product_id in (select product.id from public.commerce_products product where product.spot_id = v_identifier.spot_id)
      and public.normalize_commerce_identifier(variant.sku) = v_identifier.normalized_value;
  end if;
  return to_jsonb(v_identifier);
end;
$$;

create or replace function public.replace_commerce_product_identifier(
  p_identifier_id uuid,
  p_identifier_type text,
  p_value text,
  p_origin text,
  p_actor_id uuid,
  p_confirmed boolean,
  p_public_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.commerce_product_identifiers%rowtype;
  v_listing public.commerce_products%rowtype;
  v_variant public.commerce_product_variants%rowtype;
  v_result jsonb;
begin
  if not coalesce(p_confirmed, false) then raise exception 'Confirmá el reemplazo del código.'; end if;
  select * into v_old from public.commerce_product_identifiers where id = p_identifier_id for update;
  if not found or v_old.status <> 'active' then raise exception 'El identificador activo no existe.'; end if;
  select * into v_listing from public.commerce_products
  where catalog_product_id = v_old.catalog_product_id and spot_id = v_old.spot_id
  order by created_at limit 1;
  if not found then raise exception 'No se encontró la publicación del identificador.'; end if;
  if v_old.catalog_variant_id is not null then
    select * into v_variant from public.commerce_product_variants
    where product_id = v_listing.id and catalog_variant_id = v_old.catalog_variant_id limit 1;
  end if;

  update public.commerce_product_identifiers
  set status = 'replaced', disabled_at = now(), disabled_by = p_actor_id, is_primary = false
  where id = v_old.id;

  v_result := public.create_commerce_product_identifier(
    v_old.spot_id, v_listing.id, v_variant.id, p_identifier_type, p_value,
    p_origin, v_old.is_primary, p_actor_id, p_public_token,
    v_old.destination_type, v_old.destination_path, v_old.destination_metadata, v_old.id
  );
  if coalesce((v_result ->> 'conflict')::boolean, false) then
    raise exception 'El código ya pertenece a otro producto.';
  end if;
  return v_result || jsonb_build_object('replaced_identifier', to_jsonb(v_old));
end;
$$;

create or replace function public.update_commerce_qr_destination(
  p_identifier_id uuid,
  p_destination_type text,
  p_destination_path text,
  p_destination_metadata jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identifier public.commerce_product_identifiers%rowtype;
begin
  if p_destination_type not in ('product', 'variant', 'authenticity', 'product_3d', 'digital_claim', 'experience') then
    raise exception 'Destino QR inválido.';
  end if;
  update public.commerce_product_identifiers
  set destination_type = p_destination_type,
      destination_path = nullif(btrim(p_destination_path), ''),
      destination_metadata = coalesce(p_destination_metadata, '{}'::jsonb),
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_identifier_id and identifier_type = 'clouva_qr' and status = 'active'
  returning * into v_identifier;
  if not found then raise exception 'El QR activo no existe.'; end if;
  return to_jsonb(v_identifier);
end;
$$;

alter table public.commerce_product_identifier_events enable row level security;

drop policy if exists commerce_product_identifiers_manager_select on public.commerce_product_identifiers;
create policy commerce_product_identifiers_manager_select on public.commerce_product_identifiers
  for select to authenticated
  using (
    (studio_id is not null and public.can_manage_studio(studio_id, (select auth.uid())))
    or exists (
      select 1 from public.commerce_spots spot
      where spot.id = commerce_product_identifiers.spot_id
        and public.can_manage_studio(spot.studio_id, (select auth.uid()))
    )
  );

create policy commerce_product_identifier_events_manager_select on public.commerce_product_identifier_events
  for select to authenticated
  using (
    (studio_id is not null and public.can_manage_studio(studio_id, (select auth.uid())))
    or exists (
      select 1 from public.commerce_spots spot
      where spot.id = commerce_product_identifier_events.spot_id
        and public.can_manage_studio(spot.studio_id, (select auth.uid()))
    )
  );

revoke all on public.commerce_product_identifier_events from anon, authenticated;
grant select on public.commerce_product_identifier_events to authenticated;
grant all on public.commerce_product_identifier_events to service_role;

revoke all on function public.prepare_commerce_product_identifier() from public, anon, authenticated;
revoke all on function public.attach_commerce_identifier_registration_context() from public, anon, authenticated;
revoke all on function public.audit_commerce_product_identifier() from public, anon, authenticated;
revoke all on function public.create_commerce_product_identifier(uuid, uuid, uuid, text, text, text, boolean, uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_commerce_product_identifier(uuid, uuid, uuid, text, text, text, boolean, uuid, text, text, text, jsonb, uuid) to service_role;
revoke all on function public.disable_commerce_product_identifier(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disable_commerce_product_identifier(uuid, uuid) to service_role;
revoke all on function public.replace_commerce_product_identifier(uuid, text, text, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.replace_commerce_product_identifier(uuid, text, text, text, uuid, boolean, text) to service_role;
revoke all on function public.update_commerce_qr_destination(uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_commerce_qr_destination(uuid, text, text, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
