-- Idempotent compatibility adapter from the original products/orders store to
-- commerce_*. Legacy tables remain untouched and readable; every imported row
-- is linked back to its original UUID, and unresolved historical records are
-- surfaced instead of guessed.

begin;

alter table public.commerce_orders
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.commerce_legacy_links (
  id uuid primary key default gen_random_uuid(),
  legacy_entity_type text not null check (legacy_entity_type in ('product', 'product_variant', 'order', 'order_item')),
  legacy_id uuid not null,
  commerce_entity_type text not null check (commerce_entity_type in ('commerce_product', 'commerce_product_variant', 'commerce_order', 'commerce_order_item')),
  commerce_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  migrated_at timestamptz not null default now(),
  unique (legacy_entity_type, legacy_id),
  unique (commerce_entity_type, commerce_id)
);

create index if not exists commerce_legacy_links_commerce_idx
  on public.commerce_legacy_links(commerce_entity_type, commerce_id);

create table if not exists public.commerce_legacy_import_issues (
  id uuid primary key default gen_random_uuid(),
  legacy_entity_type text not null,
  legacy_id uuid not null,
  issue_code text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (legacy_entity_type, legacy_id, issue_code)
);

create or replace function public.record_commerce_legacy_issue(
  p_legacy_entity_type text,
  p_legacy_id uuid,
  p_issue_code text,
  p_detail text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.commerce_legacy_import_issues(
    legacy_entity_type,
    legacy_id,
    issue_code,
    detail,
    metadata
  )
  values (
    p_legacy_entity_type,
    p_legacy_id,
    p_issue_code,
    p_detail,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (legacy_entity_type, legacy_id, issue_code)
  do update set
    detail = excluded.detail,
    metadata = excluded.metadata,
    last_seen_at = now(),
    resolved_at = null;
end;
$$;

create or replace function public.migrate_legacy_store_to_commerce()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_product record;
  legacy_variant record;
  legacy_order record;
  legacy_item record;
  product_json jsonb;
  variant_json jsonb;
  order_json jsonb;
  item_json jsonb;
  commerce_product_id uuid;
  commerce_variant_id uuid;
  commerce_order_id uuid;
  commerce_item_id uuid;
  linked_product_id uuid;
  buyer_id uuid;
  legacy_customer_id uuid;
  legacy_email text;
  base_slug text;
  final_slug text;
  product_name text;
  product_description text;
  product_category text;
  product_price numeric(10,2);
  product_stock integer;
  variant_count integer;
  image_gallery jsonb;
  cover_url text;
  legacy_payment_status text;
  legacy_shipping_status text;
  mapped_payment_status text;
  mapped_order_status text;
  mapped_fulfillment_status text;
  order_total numeric(10,2);
  order_shipping numeric(10,2);
  item_quantity integer;
  item_unit_price numeric(10,2);
  imported_products integer := 0;
  imported_variants integer := 0;
  imported_orders integer := 0;
  imported_items integer := 0;
  skipped_orders integer := 0;
begin
  if to_regclass('public.products') is not null then
    for legacy_product in
      select p.*
      from public.products p
      where not exists (
        select 1
        from public.commerce_legacy_links link
        where link.legacy_entity_type = 'product'
          and link.legacy_id = p.id
      )
      order by p.created_at nulls last, p.id
    loop
      product_json := to_jsonb(legacy_product);
      product_name := coalesce(nullif(product_json ->> 'name', ''), 'Producto legado ' || left(legacy_product.id::text, 8));
      product_description := nullif(product_json ->> 'description', '');
      base_slug := coalesce(nullif(product_json ->> 'slug', ''), 'legacy-' || legacy_product.id::text);
      product_price := coalesce(
        nullif(product_json ->> 'price', '')::numeric,
        nullif(product_json ->> 'price_cents', '')::numeric / 100,
        0
      );
      product_stock := coalesce(nullif(product_json ->> 'stock', '')::integer, 0);

      select c.name
        into product_category
      from public.categories c
      where c.id::text = product_json ->> 'category_id'
      limit 1;

      if to_regclass('public.product_images') is not null then
        select
          min(pi.image_url) filter (where pi.sort_order = minimum_sort.minimum_sort),
          coalesce(jsonb_agg(pi.image_url order by pi.sort_order, pi.id), '[]'::jsonb)
          into cover_url, image_gallery
        from public.product_images pi
        cross join lateral (
          select min(pi2.sort_order) as minimum_sort
          from public.product_images pi2
          where pi2.product_id = legacy_product.id
        ) minimum_sort
        where pi.product_id = legacy_product.id;
      else
        cover_url := null;
        image_gallery := '[]'::jsonb;
      end if;

      final_slug := base_slug;
      if exists (
        select 1
        from public.commerce_products cp
        where cp.owner_type = 'clouva'
          and cp.slug = final_slug
      ) then
        final_slug := left(base_slug, 180) || '-legacy-' || left(replace(legacy_product.id::text, '-', ''), 8);
      end if;

      insert into public.commerce_products(
        owner_type,
        player_id,
        studio_id,
        product_type,
        name,
        slug,
        description,
        price,
        currency,
        stock,
        status,
        cover_url,
        gallery,
        metadata,
        created_at,
        updated_at
      )
      values (
        'clouva',
        null,
        null,
        'physical',
        product_name,
        final_slug,
        product_description,
        greatest(product_price, 0),
        coalesce(nullif(product_json ->> 'currency', ''), 'ARS'),
        greatest(product_stock, 0),
        case
          when coalesce((product_json ->> 'active')::boolean, false)
            and coalesce(product_json ->> 'status', 'activo') not in ('archivado', 'archived', 'inactivo')
            then 'published'
          when coalesce(product_json ->> 'status', '') in ('archivado', 'archived') then 'archived'
          else 'draft'
        end,
        cover_url,
        image_gallery,
        jsonb_build_object(
          'category', product_category,
          'legacy', jsonb_build_object(
            'source_table', 'products',
            'product_id', legacy_product.id,
            'original_slug', product_json ->> 'slug',
            'sku', product_json ->> 'sku',
            'tags', coalesce(product_json -> 'tags', '[]'::jsonb),
            'sizes', coalesce(product_json -> 'sizes', '[]'::jsonb),
            'colors', coalesce(product_json -> 'colors', '[]'::jsonb)
          )
        ),
        coalesce(nullif(product_json ->> 'created_at', '')::timestamptz, now()),
        coalesce(nullif(product_json ->> 'updated_at', '')::timestamptz, now())
      )
      returning id into commerce_product_id;

      insert into public.commerce_legacy_links(
        legacy_entity_type,
        legacy_id,
        commerce_entity_type,
        commerce_id,
        metadata
      )
      values (
        'product',
        legacy_product.id,
        'commerce_product',
        commerce_product_id,
        jsonb_build_object('source_table', 'products')
      );
      imported_products := imported_products + 1;

      variant_count := 0;
      if to_regclass('public.product_variants') is not null then
        for legacy_variant in
          select pv.*
          from public.product_variants pv
          where pv.product_id = legacy_product.id
            and not exists (
              select 1
              from public.commerce_legacy_links link
              where link.legacy_entity_type = 'product_variant'
                and link.legacy_id = pv.id
            )
          order by pv.id
        loop
          variant_json := to_jsonb(legacy_variant);
          insert into public.commerce_product_variants(
            product_id,
            sku,
            title,
            size,
            color,
            price_override,
            stock,
            active,
            metadata,
            created_at,
            updated_at
          )
          values (
            commerce_product_id,
            nullif(variant_json ->> 'sku', ''),
            nullif(variant_json ->> 'title', ''),
            nullif(variant_json ->> 'size', ''),
            nullif(variant_json ->> 'color', ''),
            coalesce(nullif(variant_json ->> 'price', '')::numeric, nullif(variant_json ->> 'price_override', '')::numeric),
            greatest(coalesce(nullif(variant_json ->> 'stock', '')::integer, 0), 0),
            coalesce((variant_json ->> 'active')::boolean, true),
            jsonb_build_object('legacy', jsonb_build_object('source_table', 'product_variants', 'variant_id', legacy_variant.id)),
            coalesce(nullif(variant_json ->> 'created_at', '')::timestamptz, now()),
            coalesce(nullif(variant_json ->> 'updated_at', '')::timestamptz, now())
          )
          returning id into commerce_variant_id;

          insert into public.commerce_legacy_links(
            legacy_entity_type,
            legacy_id,
            commerce_entity_type,
            commerce_id,
            metadata
          )
          values (
            'product_variant',
            legacy_variant.id,
            'commerce_product_variant',
            commerce_variant_id,
            jsonb_build_object('legacy_product_id', legacy_product.id)
          );
          variant_count := variant_count + 1;
          imported_variants := imported_variants + 1;
        end loop;
      end if;

      if variant_count = 0 then
        insert into public.commerce_product_variants(
          product_id,
          sku,
          title,
          stock,
          active,
          metadata
        )
        values (
          commerce_product_id,
          nullif(product_json ->> 'sku', ''),
          'Edición base',
          greatest(product_stock, 0),
          true,
          jsonb_build_object(
            'legacy', jsonb_build_object(
              'source_table', 'products',
              'product_id', legacy_product.id,
              'reason', 'no_variant_stock_distribution_available'
            )
          )
        )
        returning id into commerce_variant_id;
        imported_variants := imported_variants + 1;
      end if;
    end loop;
  end if;

  if to_regclass('public.orders') is not null then
    for legacy_order in
      select o.*
      from public.orders o
      where not exists (
        select 1
        from public.commerce_legacy_links link
        where link.legacy_entity_type = 'order'
          and link.legacy_id = o.id
      )
      order by o.created_at nulls last, o.id
    loop
      order_json := to_jsonb(legacy_order);
      buyer_id := null;
      legacy_email := lower(coalesce(nullif(order_json ->> 'customer_email', ''), ''));

      begin
        legacy_customer_id := nullif(order_json ->> 'customer_id', '')::uuid;
      exception when others then
        legacy_customer_id := null;
      end;

      if legacy_customer_id is not null and to_regclass('public.customers') is not null then
        select nullif(to_jsonb(c) ->> 'profile_id', '')::uuid
          into buyer_id
        from public.customers c
        where c.id = legacy_customer_id
        limit 1;
      end if;

      if buyer_id is null and legacy_email <> '' then
        select p.id
          into buyer_id
        from public.profiles p
        where lower(p.email) = legacy_email
        limit 1;
      end if;

      if buyer_id is null or not exists (select 1 from auth.users u where u.id = buyer_id) then
        perform public.record_commerce_legacy_issue(
          'order',
          legacy_order.id,
          'missing_auth_buyer',
          'La orden clásica no puede vincularse de forma segura a un usuario auth existente.',
          jsonb_build_object('customer_id', legacy_customer_id, 'customer_email', legacy_email)
        );
        skipped_orders := skipped_orders + 1;
        continue;
      end if;

      legacy_payment_status := lower(coalesce(order_json ->> 'payment_status', order_json ->> 'status', 'pendiente'));
      legacy_shipping_status := lower(coalesce(order_json ->> 'shipping_status', order_json ->> 'status', 'pendiente'));
      mapped_payment_status := case
        when legacy_payment_status in ('pagado', 'paid', 'approved') then 'paid'
        when legacy_payment_status in ('reembolsado', 'refunded', 'charged_back') then 'refunded'
        when legacy_payment_status in ('rechazado', 'cancelado', 'cancelled', 'failed') then 'failed'
        else 'pending'
      end;
      mapped_fulfillment_status := case
        when legacy_shipping_status in ('preparando', 'preparing') then 'preparing'
        when legacy_shipping_status in ('listo', 'ready_to_ship') then 'ready_to_ship'
        when legacy_shipping_status in ('enviado', 'shipped') then 'shipped'
        when legacy_shipping_status in ('entregado', 'delivered') then 'delivered'
        when legacy_shipping_status in ('cancelado', 'cancelled') then 'cancelled'
        when legacy_shipping_status in ('devuelto', 'returned') then 'returned'
        else 'pending'
      end;
      mapped_order_status := case
        when mapped_fulfillment_status = 'delivered' then 'completed'
        when mapped_payment_status in ('failed', 'refunded') or mapped_fulfillment_status in ('cancelled', 'returned') then 'cancelled'
        when mapped_payment_status = 'paid' then 'confirmed'
        else 'pending'
      end;
      order_total := greatest(coalesce(
        nullif(order_json ->> 'total', '')::numeric,
        nullif(order_json ->> 'total_cents', '')::numeric / 100,
        0
      ), 0);
      order_shipping := greatest(coalesce(
        nullif(order_json ->> 'shipping_cost', '')::numeric,
        nullif(order_json ->> 'shipping_subtotal', '')::numeric,
        0
      ), 0);

      insert into public.commerce_orders(
        buyer_id,
        seller_type,
        seller_player_id,
        seller_studio_id,
        subtotal,
        shipping_subtotal,
        fees,
        commission,
        total,
        currency,
        status,
        payment_status,
        fulfillment_status,
        paid_at,
        completed_at,
        refunded_at,
        stock_committed_at,
        metadata,
        created_at
      )
      values (
        buyer_id,
        'clouva',
        null,
        null,
        greatest(order_total - order_shipping, 0),
        order_shipping,
        0,
        0,
        order_total,
        coalesce(nullif(order_json ->> 'currency', ''), 'ARS'),
        mapped_order_status,
        mapped_payment_status,
        mapped_fulfillment_status,
        case when mapped_payment_status = 'paid' then coalesce(nullif(order_json ->> 'paid_at', '')::timestamptz, nullif(order_json ->> 'created_at', '')::timestamptz) else null end,
        case when mapped_order_status = 'completed' then coalesce(nullif(order_json ->> 'updated_at', '')::timestamptz, now()) else null end,
        case when mapped_payment_status = 'refunded' then coalesce(nullif(order_json ->> 'updated_at', '')::timestamptz, now()) else null end,
        case when mapped_payment_status = 'paid' then coalesce(nullif(order_json ->> 'paid_at', '')::timestamptz, nullif(order_json ->> 'created_at', '')::timestamptz, now()) else null end,
        jsonb_build_object(
          'legacy', jsonb_build_object(
            'source_table', 'orders',
            'order_id', legacy_order.id,
            'order_number', order_json ->> 'order_number',
            'external_reference', order_json ->> 'external_reference',
            'external_payment_id', order_json ->> 'external_payment_id',
            'original_status', order_json ->> 'status',
            'original_payment_status', order_json ->> 'payment_status',
            'original_shipping_status', order_json ->> 'shipping_status'
          )
        ),
        coalesce(nullif(order_json ->> 'created_at', '')::timestamptz, now())
      )
      returning id into commerce_order_id;

      insert into public.commerce_legacy_links(
        legacy_entity_type,
        legacy_id,
        commerce_entity_type,
        commerce_id,
        metadata
      )
      values (
        'order',
        legacy_order.id,
        'commerce_order',
        commerce_order_id,
        jsonb_build_object('source_table', 'orders')
      );
      imported_orders := imported_orders + 1;

      if to_regclass('public.order_items') is not null then
        for legacy_item in
          select oi.*
          from public.order_items oi
          where oi.order_id = legacy_order.id
          order by oi.id
        loop
          item_json := to_jsonb(legacy_item);
          linked_product_id := null;
          select link.commerce_id
            into linked_product_id
          from public.commerce_legacy_links link
          where link.legacy_entity_type = 'product'
            and link.legacy_id::text = item_json ->> 'product_id'
          limit 1;

          if linked_product_id is null then
            perform public.record_commerce_legacy_issue(
              'order_item',
              legacy_item.id,
              'missing_product_link',
              'El item clásico no tiene un producto canónico vinculado.',
              jsonb_build_object('legacy_order_id', legacy_order.id, 'legacy_product_id', item_json ->> 'product_id')
            );
            continue;
          end if;

          item_quantity := greatest(coalesce(
            nullif(item_json ->> 'qty', '')::integer,
            nullif(item_json ->> 'quantity', '')::integer,
            1
          ), 1);
          item_unit_price := greatest(coalesce(
            nullif(item_json ->> 'unit_price', '')::numeric,
            nullif(item_json ->> 'unit_price_cents', '')::numeric / 100,
            0
          ), 0);

          insert into public.commerce_order_items(
            order_id,
            product_id,
            product_name,
            product_type,
            quantity,
            unit_price,
            total,
            delivery_status,
            metadata
          )
          values (
            commerce_order_id,
            linked_product_id,
            coalesce(nullif(item_json ->> 'product_name', ''), 'Producto legado'),
            'physical',
            item_quantity,
            item_unit_price,
            item_unit_price * item_quantity,
            'not_applicable',
            jsonb_build_object('legacy', jsonb_build_object('source_table', 'order_items', 'order_item_id', legacy_item.id))
          )
          returning id into commerce_item_id;

          insert into public.commerce_legacy_links(
            legacy_entity_type,
            legacy_id,
            commerce_entity_type,
            commerce_id,
            metadata
          )
          values (
            'order_item',
            legacy_item.id,
            'commerce_order_item',
            commerce_item_id,
            jsonb_build_object('legacy_order_id', legacy_order.id)
          )
          on conflict (legacy_entity_type, legacy_id) do nothing;
          imported_items := imported_items + 1;
        end loop;
      end if;

      insert into public.commerce_shipments(
        order_id,
        shipment_group,
        recipient_name,
        recipient_phone,
        recipient_email,
        address_line_1,
        country,
        delivery_method,
        shipping_cost,
        status,
        metadata,
        created_at
      )
      values (
        commerce_order_id,
        'primary',
        nullif(order_json ->> 'customer_name', ''),
        nullif(order_json ->> 'customer_phone', ''),
        nullif(order_json ->> 'customer_email', ''),
        coalesce(nullif(order_json ->> 'customer_address', ''), nullif(order_json ->> 'address', '')),
        'AR',
        'shipping',
        order_shipping,
        case mapped_fulfillment_status
          when 'preparing' then 'preparing'
          when 'ready_to_ship' then 'ready_to_ship'
          when 'shipped' then 'shipped'
          when 'delivered' then 'delivered'
          when 'cancelled' then 'cancelled'
          when 'returned' then 'returned'
          else 'pending'
        end,
        jsonb_build_object('legacy', jsonb_build_object('source_table', 'orders', 'order_id', legacy_order.id, 'address_was_freeform', true)),
        coalesce(nullif(order_json ->> 'created_at', '')::timestamptz, now())
      )
      on conflict (order_id, shipment_group) do nothing;

      insert into public.commerce_order_events(
        order_id,
        event_type,
        note,
        actor_type,
        dedupe_key,
        metadata,
        created_at
      )
      values (
        commerce_order_id,
        'legacy_order_imported',
        'Pedido histórico importado desde la tienda clásica sin modificar su registro original.',
        'system',
        'legacy-order:' || legacy_order.id::text,
        jsonb_build_object('legacy_order_id', legacy_order.id),
        coalesce(nullif(order_json ->> 'created_at', '')::timestamptz, now())
      )
      on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object(
    'imported_products', imported_products,
    'imported_variants', imported_variants,
    'imported_orders', imported_orders,
    'imported_items', imported_items,
    'skipped_orders', skipped_orders
  );
end;
$$;

revoke all on function public.record_commerce_legacy_issue(text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.migrate_legacy_store_to_commerce() from public, anon, authenticated;
grant execute on function public.migrate_legacy_store_to_commerce() to service_role;

create or replace view public.commerce_legacy_compatibility_status as
select
  (select count(*) from public.products) as legacy_products,
  (select count(*) from public.orders) as legacy_orders,
  (select count(*) from public.commerce_legacy_links where legacy_entity_type = 'product') as linked_products,
  (select count(*) from public.commerce_legacy_links where legacy_entity_type = 'order') as linked_orders,
  (select count(*) from public.commerce_legacy_import_issues where resolved_at is null) as unresolved_issues;

select public.migrate_legacy_store_to_commerce();

commit;
