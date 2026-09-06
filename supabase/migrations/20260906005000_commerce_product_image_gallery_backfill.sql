-- Close the product-image pipeline for listings created before gallery
-- persistence was canonicalized in the scan API.
--
-- Source photos and generated variants remain in metadata.product_images.
-- commerce_products.gallery is the publication-facing master set.

begin;

update public.commerce_products as product
set gallery = generated.gallery
from lateral (
  select coalesce(jsonb_agg(to_jsonb(image_url) order by ordinal), '[]'::jsonb) as gallery
  from (
    select distinct on (image_url)
      image ->> 'url' as image_url,
      ordinal
    from jsonb_array_elements(
      case
        when jsonb_typeof(product.metadata -> 'product_images' -> 'generated_images') = 'array'
          then product.metadata -> 'product_images' -> 'generated_images'
        else '[]'::jsonb
      end
    ) with ordinality as images(image, ordinal)
    where nullif(btrim(image ->> 'url'), '') is not null
    order by image_url, ordinal
  ) deduped
) as generated
where coalesce(jsonb_array_length(product.gallery), 0) = 0
  and jsonb_array_length(generated.gallery) > 0;

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
  and jsonb_array_length(product.gallery) > 0
  and not (product.metadata -> 'product_images' ? 'publication_master');

commit;
