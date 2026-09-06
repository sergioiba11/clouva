-- Legacy image management mixed private scanner/source photos into gallery.
-- From this point forward gallery is publication-only. Raw scanner sources stay
-- in metadata.product_images.source_photos for lineage and editing, but are not
-- public unless they were explicitly added as Manual media.

begin;

with candidates as (
  select
    product.id,
    product.cover_url,
    array(
      select distinct candidate.url
      from (
        select image ->> 'url' as url, ordinal::bigint as sort_order
        from jsonb_array_elements(
          case
            when jsonb_typeof(product.metadata -> 'product_images' -> 'generated_images') = 'array'
              then product.metadata -> 'product_images' -> 'generated_images'
            else '[]'::jsonb
          end
        ) with ordinality as generated(image, ordinal)
        where nullif(btrim(image ->> 'url'), '') is not null

        union all

        select image ->> 'url' as url, (100000 + ordinal)::bigint as sort_order
        from jsonb_array_elements(
          case
            when jsonb_typeof(product.metadata -> 'product_images' -> 'source_photos') = 'array'
              then product.metadata -> 'product_images' -> 'source_photos'
            else '[]'::jsonb
          end
        ) with ordinality as sources(image, ordinal)
        where lower(coalesce(image ->> 'label', '')) = 'manual'
          and nullif(btrim(image ->> 'url'), '') is not null
      ) as candidate
      order by candidate.url
    ) as eligible_urls,
    array(
      select image ->> 'url'
      from jsonb_array_elements(
        case
          when jsonb_typeof(product.metadata -> 'product_images' -> 'generated_images') = 'array'
            then product.metadata -> 'product_images' -> 'generated_images'
          else '[]'::jsonb
        end
      ) with ordinality as generated(image, ordinal)
      where nullif(btrim(image ->> 'url'), '') is not null
      order by ordinal
    ) as generated_urls
  from public.commerce_products as product
  where jsonb_typeof(product.metadata -> 'product_images') = 'object'
), sanitized as (
  select
    product.id,
    candidates.cover_url,
    candidates.eligible_urls,
    candidates.generated_urls,
    array(
      select gallery_item.url
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(product.gallery) = 'array' then product.gallery
          else '[]'::jsonb
        end
      ) with ordinality as gallery_item(url, ordinal)
      where gallery_item.url = any(candidates.eligible_urls)
      order by ordinal
    ) as existing_public_urls
  from public.commerce_products as product
  join candidates on candidates.id = product.id
), resolved as (
  select
    id,
    case
      when cover_url = any(eligible_urls) then cover_url
      when cardinality(existing_public_urls) > 0 then existing_public_urls[1]
      when cardinality(generated_urls) > 0 then generated_urls[1]
      else null
    end as next_cover,
    case
      when cardinality(existing_public_urls) > 0 then existing_public_urls
      when cardinality(generated_urls) > 0 then generated_urls
      else array[]::text[]
    end as base_gallery
  from sanitized
), final_state as (
  select
    id,
    next_cover,
    case
      when next_cover is null then base_gallery
      else array_prepend(next_cover, array_remove(base_gallery, next_cover))
    end as publication_gallery
  from resolved
)
update public.commerce_products as product
set
  cover_url = final_state.next_cover,
  gallery = to_jsonb(final_state.publication_gallery),
  metadata = jsonb_set(
    jsonb_set(
      coalesce(product.metadata, '{}'::jsonb),
      '{product_images,cover_image}',
      coalesce(to_jsonb(final_state.next_cover), 'null'::jsonb),
      true
    ),
    '{product_images,publication_master}',
    jsonb_build_object(
      'cover_url', final_state.next_cover,
      'gallery', to_jsonb(final_state.publication_gallery),
      'selected_at', now(),
      'migration', '20260906011500_commerce_publication_media_sanitize'
    ),
    true
  ),
  updated_at = now()
from final_state
where product.id = final_state.id;

commit;
