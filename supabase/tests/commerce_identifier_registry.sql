-- Transactional integration test for the canonical product identifier registry.
-- It exercises commercial-code reuse/conflict, stable QR resolution/revocation,
-- variant isolation, replacement history and inventory isolation. Nothing persists.

begin;

do $test$
declare
  v_spot public.commerce_spots%rowtype;
  v_location public.commerce_inventory_locations%rowtype;
  v_catalog_one uuid;
  v_catalog_two uuid;
  v_catalog_shirt uuid;
  v_listing_one uuid;
  v_listing_two uuid;
  v_listing_shirt uuid;
  v_catalog_variant_m uuid;
  v_catalog_variant_l uuid;
  v_variant_m uuid;
  v_variant_l uuid;
  v_result jsonb;
  v_identifier_id uuid;
  v_qr_id uuid;
  v_old_code_id uuid;
  v_resolved jsonb;
  v_count integer;
  v_stock_m integer;
  v_stock_l integer;
begin
  select * into v_spot from public.commerce_spots where status = 'active' order by created_at limit 1;
  if not found then raise exception 'test requires active spot'; end if;
  select * into v_location from public.commerce_inventory_locations where spot_id = v_spot.id and status = 'active' order by created_at limit 1;
  if not found then raise exception 'test requires inventory location'; end if;

  insert into public.commerce_catalog_products(product_kind,name,brand,status)
  values ('physical','__TEST OCB ROLLBACK__','OCB','active') returning id into v_catalog_one;
  insert into public.commerce_products(owner_type,studio_id,spot_id,catalog_product_id,product_type,name,slug,price,currency,status,listing_kind)
  values ('studio',v_spot.studio_id,v_spot.id,v_catalog_one,'physical','__TEST OCB ROLLBACK__','test-ocb-'||replace(gen_random_uuid()::text,'-',''),800,'ARS','draft','resale')
  returning id into v_listing_one;

  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_one,null,'ean_13','4006381333931','manufacturer',true,null);
  if (v_result->>'created')::boolean is not true then raise exception 'EAN was not created'; end if;
  v_identifier_id := (v_result->'identifier'->>'id')::uuid;
  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_one,null,'ean_13','4006381333931','manufacturer',true,null);
  if (v_result->>'created')::boolean is not false or (v_result->>'conflict')::boolean is not false then raise exception 'EAN idempotency failed'; end if;

  insert into public.commerce_catalog_products(product_kind,name,status)
  values ('physical','__TEST CONFLICT ROLLBACK__','active') returning id into v_catalog_two;
  insert into public.commerce_products(owner_type,studio_id,spot_id,catalog_product_id,product_type,name,slug,price,currency,status,listing_kind)
  values ('studio',v_spot.studio_id,v_spot.id,v_catalog_two,'physical','__TEST CONFLICT ROLLBACK__','test-conflict-'||replace(gen_random_uuid()::text,'-',''),900,'ARS','draft','resale')
  returning id into v_listing_two;
  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_two,null,'ean_13','4006381333931','manufacturer',true,null);
  if (v_result->>'conflict')::boolean is not true or v_result->'product'->>'id' <> v_listing_one::text then raise exception 'EAN conflict did not identify product'; end if;

  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_one,null,'clouva_qr','https://clouva.com.ar/q/test-random-token-rollback','clouva_generated',false,null,'test-random-token-rollback','product');
  v_qr_id := (v_result->'identifier'->>'id')::uuid;
  v_resolved := public.resolve_commerce_identifier(v_spot.id,'https://clouva.com.ar/q/test-random-token-rollback');
  if v_resolved->'identifier'->>'id' <> v_qr_id::text then raise exception 'QR did not resolve to original product'; end if;
  perform public.disable_commerce_product_identifier(v_qr_id,null);
  v_resolved := public.resolve_commerce_identifier(v_spot.id,'https://clouva.com.ar/q/test-random-token-rollback');
  if coalesce((v_resolved->>'exists')::boolean,false) is true or v_resolved ? 'identifier' then raise exception 'disabled QR still resolves'; end if;

  insert into public.commerce_catalog_products(product_kind,name,brand,status)
  values ('physical','__TEST VIDA FLOWS ROLLBACK__','EL IGLÚ','active') returning id into v_catalog_shirt;
  insert into public.commerce_catalog_variants(catalog_product_id,title,size,color)
  values (v_catalog_shirt,'Negra M','M','Negra') returning id into v_catalog_variant_m;
  insert into public.commerce_catalog_variants(catalog_product_id,title,size,color)
  values (v_catalog_shirt,'Negra L','L','Negra') returning id into v_catalog_variant_l;
  insert into public.commerce_products(owner_type,studio_id,spot_id,catalog_product_id,product_type,name,slug,price,currency,status,listing_kind)
  values ('studio',v_spot.studio_id,v_spot.id,v_catalog_shirt,'physical','__TEST VIDA FLOWS ROLLBACK__','test-vida-'||replace(gen_random_uuid()::text,'-',''),3000,'ARS','draft','owned_design')
  returning id into v_listing_shirt;
  insert into public.commerce_product_variants(product_id,catalog_variant_id,sku,title,size,color,stock,active)
  values (v_listing_shirt,v_catalog_variant_m,null,'Negra M','M','Negra',5,true) returning id into v_variant_m;
  insert into public.commerce_product_variants(product_id,catalog_variant_id,sku,title,size,color,stock,active)
  values (v_listing_shirt,v_catalog_variant_l,null,'Negra L','L','Negra',7,true) returning id into v_variant_l;

  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_shirt,v_variant_m,'sku','IGL-VDF-BLK-M','clouva_generated',false,null);
  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_shirt,v_variant_m,'code_128','CLV000000000000000001','clouva_generated',false,null);
  v_old_code_id := (v_result->'identifier'->>'id')::uuid;
  v_result := public.create_commerce_product_identifier(v_spot.id,v_listing_shirt,v_variant_m,'clouva_qr','https://clouva.com.ar/q/test-shirt-m-rollback','clouva_generated',false,null,'test-shirt-m-rollback','variant');
  v_resolved := public.resolve_commerce_identifier(v_spot.id,'CLV000000000000000001');
  if v_resolved->'listing_variant'->>'id' <> v_variant_m::text then raise exception 'variant code resolved to wrong variant'; end if;

  perform public.adjust_commerce_spot_inventory(v_spot.id,v_listing_shirt,v_variant_m,v_location.id,3,'adjustment_in',null,'ARS','identifier-test','rollback stock test',null,'identifier-test-'||gen_random_uuid()::text,'{}'::jsonb);
  select stock into v_stock_m from public.commerce_product_variants where id=v_variant_m;
  select stock into v_stock_l from public.commerce_product_variants where id=v_variant_l;
  if v_stock_m <> 8 or v_stock_l <> 7 then raise exception 'variant stock isolation failed: % %', v_stock_m, v_stock_l; end if;

  v_result := public.replace_commerce_product_identifier(v_old_code_id,'code_128','CLV000000000000000002','clouva_generated',null,true,null);
  if not exists(select 1 from public.commerce_product_identifiers where id=v_old_code_id and status='replaced' and normalized_value like 'REPLACED:%') then raise exception 'old code lifecycle failed'; end if;
  if not exists(select 1 from public.commerce_product_identifiers where replaces_identifier_id=v_old_code_id and status='active' and value='CLV000000000000000002') then raise exception 'replacement link failed'; end if;

  select count(*) into v_count from public.commerce_product_identifier_events
  where identifier_id in (v_identifier_id,v_qr_id,v_old_code_id);
  if v_count < 5 then raise exception 'identifier history incomplete: %', v_count; end if;
end
$test$;

rollback;
