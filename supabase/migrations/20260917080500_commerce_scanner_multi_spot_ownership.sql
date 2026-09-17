-- Keep the canonical scanner RPC multi-Spot: listings inherit the owner shape
-- from commerce_spots instead of assuming every scanned product belongs to a Studio.
-- Also persist the reviewed structured recognition on the listing/catalog metadata
-- so publication copy and later reloads use the same confirmed product facts.

create or replace function public.upsert_commerce_scanned_product(
  p_spot_id uuid,
  p_identifier_type text,
  p_identifier_value text,
  p_product jsonb,
  p_listing jsonb,
  p_variant jsonb,
  p_actor_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_spot public.commerce_spots%rowtype;
  v_location public.commerce_inventory_locations%rowtype;
  v_catalog public.commerce_catalog_products%rowtype;
  v_catalog_variant public.commerce_catalog_variants%rowtype;
  v_listing public.commerce_products%rowtype;
  v_listing_variant public.commerce_product_variants%rowtype;
  v_identifier public.commerce_product_identifiers%rowtype;
  v_normalized text;
  v_kind text;
  v_name text;
  v_slug text;
  v_price numeric;
  v_cost numeric;
  v_stock integer;
  v_sku text;
  v_status text;
  v_listing_created boolean := false;
  v_recognition jsonb;
  v_catalog_metadata jsonb;
  v_listing_metadata jsonb;
  v_variant_metadata jsonb;
begin
  v_normalized := public.normalize_commerce_identifier(p_identifier_value);
  if v_normalized = '' then raise exception 'El código es obligatorio.'; end if;
  if p_identifier_type not in ('ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'clouva_barcode', 'clouva_qr', 'sku') then
    raise exception 'Tipo de identificador inválido.';
  end if;

  select * into v_spot
  from public.commerce_spots
  where id = p_spot_id
  for update;
  if not found or v_spot.status <> 'active' then raise exception 'El Spot no está activo.'; end if;

  if v_spot.owner_type = 'user' and v_spot.owner_user_id is null then
    raise exception 'El Spot de usuario no tiene owner_user_id.';
  end if;
  if v_spot.owner_type = 'studio' and v_spot.studio_id is null then
    raise exception 'El Spot de Studio no tiene studio_id.';
  end if;

  select * into v_location
  from public.commerce_inventory_locations
  where spot_id = p_spot_id and status = 'active'
  order by (code = 'PRINCIPAL') desc, created_at
  limit 1;
  if not found then raise exception 'El Spot no tiene una ubicación de inventario activa.'; end if;

  -- The UI review sends the final editable values in p_product/p_variant.
  -- Preserve existing AI provenance/confidence fields, then add the reviewed
  -- structured values that downstream copy/publication code consumes.
  v_recognition :=
    case
      when jsonb_typeof(p_listing #> '{metadata,recognition}') = 'object'
        then p_listing #> '{metadata,recognition}'
      when jsonb_typeof(p_product #> '{metadata,recognition}') = 'object'
        then p_product #> '{metadata,recognition}'
      else '{}'::jsonb
    end
    || jsonb_strip_nulls(jsonb_build_object(
      'name', nullif(btrim(p_product ->> 'name'), ''),
      'description', nullif(btrim(p_product ->> 'description'), ''),
      'brand', nullif(btrim(p_product ->> 'brand'), ''),
      'category', nullif(btrim(p_product ->> 'category'), ''),
      'product_kind', nullif(btrim(p_product ->> 'product_kind'), ''),
      'listing_kind', nullif(btrim(p_listing ->> 'listing_kind'), ''),
      'size', nullif(btrim(p_variant ->> 'size'), ''),
      'color', nullif(btrim(p_variant ->> 'color'), ''),
      'presentation', nullif(btrim(p_variant ->> 'presentation'), ''),
      'identifier_type', p_identifier_type,
      'identifier_value', btrim(p_identifier_value)
    ));

  v_catalog_metadata :=
    case when jsonb_typeof(p_product -> 'metadata') = 'object'
      then p_product -> 'metadata'
      else '{}'::jsonb
    end
    || jsonb_build_object('recognition', v_recognition);

  v_listing_metadata :=
    case when jsonb_typeof(p_listing -> 'metadata') = 'object'
      then p_listing -> 'metadata'
      else '{}'::jsonb
    end
    || jsonb_build_object('recognition', v_recognition);

  v_variant_metadata :=
    case when jsonb_typeof(p_variant -> 'metadata') = 'object'
      then p_variant -> 'metadata'
      else '{}'::jsonb
    end
    || jsonb_build_object('recognition', v_recognition);

  select * into v_identifier
  from public.commerce_product_identifiers
  where identifier_type = p_identifier_type
    and normalized_value = v_normalized
    and (spot_id is null or spot_id = p_spot_id)
  order by (spot_id = p_spot_id) desc, created_at
  limit 1;

  if found then
    select * into v_catalog
    from public.commerce_catalog_products
    where id = v_identifier.catalog_product_id;

    if v_identifier.catalog_variant_id is not null then
      select * into v_catalog_variant
      from public.commerce_catalog_variants
      where id = v_identifier.catalog_variant_id;
    end if;
  else
    v_kind := coalesce(nullif(p_product ->> 'product_kind', ''), 'physical');
    v_name := btrim(coalesce(p_product ->> 'name', ''));
    if v_kind not in ('physical', 'avatar_item', 'digital', 'bundle') then raise exception 'Tipo de producto inválido.'; end if;
    if v_name = '' then raise exception 'El nombre del producto es obligatorio.'; end if;

    insert into public.commerce_catalog_products(
      product_kind, name, description, brand, category, design_key,
      avatar_asset_id, status, metadata, created_by
    ) values (
      v_kind,
      v_name,
      nullif(btrim(p_product ->> 'description'), ''),
      nullif(btrim(p_product ->> 'brand'), ''),
      nullif(btrim(p_product ->> 'category'), ''),
      nullif(btrim(p_product ->> 'design_key'), ''),
      nullif(p_product ->> 'avatar_asset_id', '')::uuid,
      'active',
      v_catalog_metadata,
      p_actor_id
    ) returning * into v_catalog;

    if v_kind = 'physical' and p_variant is not null and p_variant <> '{}'::jsonb then
      insert into public.commerce_catalog_variants(
        catalog_product_id, title, size, color, presentation, metadata
      ) values (
        v_catalog.id,
        nullif(btrim(p_variant ->> 'title'), ''),
        nullif(btrim(p_variant ->> 'size'), ''),
        nullif(btrim(p_variant ->> 'color'), ''),
        nullif(btrim(p_variant ->> 'presentation'), ''),
        v_variant_metadata
      ) returning * into v_catalog_variant;
    end if;

    insert into public.commerce_product_identifiers(
      catalog_product_id, catalog_variant_id, spot_id, identifier_type,
      value, normalized_value, is_primary, created_by
    ) values (
      v_catalog.id,
      v_catalog_variant.id,
      case when p_identifier_type in ('sku', 'clouva_barcode', 'clouva_qr') then p_spot_id else null end,
      p_identifier_type,
      btrim(p_identifier_value),
      v_normalized,
      true,
      p_actor_id
    ) returning * into v_identifier;
  end if;

  select * into v_listing
  from public.commerce_products
  where spot_id = p_spot_id and catalog_product_id = v_catalog.id
  order by created_at
  limit 1
  for update;

  if not found then
    v_price := coalesce(nullif(p_listing ->> 'price', '')::numeric, 0);
    v_cost := nullif(p_listing ->> 'cost', '')::numeric;
    v_status := coalesce(nullif(p_listing ->> 'status', ''), 'draft');
    if v_price < 0 or v_cost < 0 then raise exception 'Precio o costo inválido.'; end if;
    if v_status not in ('draft', 'published', 'paused') then v_status := 'draft'; end if;

    v_slug := lower(regexp_replace(normalize(v_catalog.name, NFD), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    if v_slug = '' then v_slug := 'producto'; end if;
    v_slug := left(v_slug, 64) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

    insert into public.commerce_products(
      owner_type, owner_user_id, studio_id, spot_id, catalog_product_id, product_type,
      name, slug, description, price, cost_amount, currency, stock, status,
      cover_url, gallery, avatar_asset_id, listing_kind, metadata, created_by
    ) values (
      v_spot.owner_type,
      case when v_spot.owner_type = 'user' then v_spot.owner_user_id else null end,
      case when v_spot.owner_type = 'studio' then v_spot.studio_id else null end,
      p_spot_id,
      v_catalog.id,
      v_catalog.product_kind,
      v_catalog.name,
      v_slug,
      v_catalog.description,
      v_price,
      v_cost,
      v_spot.currency,
      case when v_catalog.product_kind = 'physical' and v_catalog_variant.id is null then 0 else null end,
      v_status,
      nullif(btrim(p_listing ->> 'cover_url'), ''),
      coalesce(p_listing -> 'gallery', '[]'::jsonb),
      v_catalog.avatar_asset_id,
      coalesce(
        nullif(p_listing ->> 'listing_kind', ''),
        case when p_identifier_type like 'ean%' or p_identifier_type like 'upc%' then 'resale' else 'standard' end
      ),
      v_listing_metadata,
      p_actor_id
    ) returning * into v_listing;
    v_listing_created := true;
  else
    -- A rescan/review may improve spot-specific recognition without mutating the
    -- shared catalog identity. Keep the listing metadata current and editable.
    update public.commerce_products
    set metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object('recognition', v_recognition),
      updated_at = now()
    where id = v_listing.id
    returning * into v_listing;
  end if;

  if v_catalog.product_kind = 'physical' and v_catalog_variant.id is not null then
    select * into v_listing_variant
    from public.commerce_product_variants
    where product_id = v_listing.id and catalog_variant_id = v_catalog_variant.id
    limit 1
    for update;

    if not found then
      v_sku := nullif(btrim(p_variant ->> 'sku'), '');
      insert into public.commerce_product_variants(
        product_id, catalog_variant_id, sku, title, size, color,
        price_override, cost_override, stock, active, metadata
      ) values (
        v_listing.id,
        v_catalog_variant.id,
        v_sku,
        v_catalog_variant.title,
        v_catalog_variant.size,
        v_catalog_variant.color,
        nullif(p_variant ->> 'price', '')::numeric,
        nullif(p_variant ->> 'cost', '')::numeric,
        0,
        true,
        v_variant_metadata
      ) returning * into v_listing_variant;

      if v_sku is not null then
        insert into public.commerce_product_identifiers(
          catalog_product_id, catalog_variant_id, spot_id, identifier_type,
          value, normalized_value, is_primary, created_by
        ) values (
          v_catalog.id,
          v_catalog_variant.id,
          p_spot_id,
          'sku',
          v_sku,
          public.normalize_commerce_identifier(v_sku),
          false,
          p_actor_id
        ) on conflict do nothing;
      end if;
    end if;
  end if;

  v_stock := greatest(0, coalesce(nullif(p_listing ->> 'initial_stock', '')::integer, 0));
  if v_listing_created and v_catalog.product_kind = 'physical' and v_stock > 0 then
    perform public.adjust_commerce_spot_inventory(
      p_spot_id,
      v_listing.id,
      v_listing_variant.id,
      v_location.id,
      v_stock,
      'opening_stock',
      coalesce(v_listing_variant.cost_override, v_listing.cost_amount),
      v_spot.currency,
      'scanner:first-load',
      'Carga inicial desde escáner',
      p_actor_id,
      p_idempotency_key || ':opening-stock',
      jsonb_build_object('identifier_id', v_identifier.id)
    );
  end if;

  return jsonb_build_object(
    'identifier', to_jsonb(v_identifier),
    'catalog_product', to_jsonb(v_catalog),
    'catalog_variant', case when v_catalog_variant.id is null then null else to_jsonb(v_catalog_variant) end,
    'listing', to_jsonb(v_listing),
    'listing_variant', case when v_listing_variant.id is null then null else to_jsonb(v_listing_variant) end,
    'created', v_listing_created
  );
end;
$function$;
