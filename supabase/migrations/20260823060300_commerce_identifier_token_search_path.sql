-- Repair the QR token fallback for projects where pgcrypto lives in the
-- extensions schema. The registry functions intentionally use an empty
-- search_path, so extension functions must be schema-qualified.

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
  if new.status <> 'active' then
    new.normalized_value := upper(new.status) || ':' || new.id::text || ':' || public.normalize_commerce_identifier(new.value);
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_commerce_product_identifier() from public, anon, authenticated;

notify pgrst, 'reload schema';
