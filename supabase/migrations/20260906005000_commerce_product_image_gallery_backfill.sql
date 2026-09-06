-- Close the product-image pipeline for listings created before gallery
-- persistence was canonicalized in the scan API.
--
-- Source photos and generated variants remain in metadata.product_images.
-- commerce_products.gallery is the publication-facing master set.

begin;

update public.commerce_products as product
set gallery = (
  select coalesce(jsonb_agg(to_jsonb(deduped.image_url) order by deduped.first_ordinal), '[]'::jsonb)
  from (
    select
      image ->> 'url' as image_url,
      min(ordinal) as first_ordinal
    from jsonb_array_elements(product.metadata -> 'product_images' -> 'generated_images')
      with ordinality as images(image, ordinal)
    where nullif(btrim(image ->> 'url'), '') is not null
    group by image ->> 'url'
  ) as deduped
)
where case
    when jsonb_typeof(product.gallery) = 'array' then jsonb_array_length(product.gallery) = 0
    else true
  end
  and jsonb_typeof(product.metadata -> 'product_images' -> 'generated_images') = 'array'
  and jsonb_array_length(product.metadata -> 'product_images' -> 'generated_images') > 0;

-- Record the same master selection inside metadata so lineage is explicit:
-- source_photos -> generated_images -> publication_master -> gallery/cover_url.
update public.commerce_products as product
set metadata = jsonb_set(
  coalesce(product.metadata, '{}'::jsonb),
  '{product_images,publication_master}',
  jsonb_build_object(
    'cover_url', coalesce(product.cover_url, product.gallery ->> 0),
    'gallery', product.gallery,
    'selected_at', now()
  ),
  true
)
where jsonb_typeof(product.metadata -> 'product_images') = 'object'
  and case
    when jsonb_typeof(product.gallery) = 'array' then jsonb_array_length(product.gallery) > 0
    else false
  end
  and not (product.metadata -> 'product_images' ? 'publication_master');

commit;
