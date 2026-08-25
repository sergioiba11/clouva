import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommerceLabelRecord } from "@/lib/server/commerce-labels";

type IdentifierRow = {
  id: string;
  catalog_product_id: string;
  catalog_variant_id: string | null;
  spot_id: string | null;
  identifier_type: string;
  value: string;
  status: string;
};

const BARCODE_PRIORITY = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode"];

function variantLabel(variant: { title?: string | null; color?: string | null; size?: string | null; presentation?: string | null } | null) {
  return [variant?.title, variant?.color, variant?.size, variant?.presentation]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(" · ");
}

function chooseBarcode(identifiers: IdentifierRow[], preferredId?: string | null) {
  const preferred = identifiers.find((identifier) => identifier.id === preferredId && identifier.identifier_type !== "clouva_qr" && identifier.identifier_type !== "sku");
  const identifier = preferred ?? BARCODE_PRIORITY
    .map((type) => identifiers.find((candidate) => candidate.identifier_type === type))
    .find(Boolean);
  return identifier ? { type: identifier.identifier_type, value: identifier.value } : null;
}

function chooseQr(identifiers: IdentifierRow[], preferredId?: string | null) {
  const identifier = identifiers.find((candidate) => candidate.id === preferredId && candidate.identifier_type === "clouva_qr")
    ?? identifiers.find((candidate) => candidate.identifier_type === "clouva_qr");
  return identifier ? { value: identifier.value } : null;
}

function chooseSku(identifiers: IdentifierRow[]) {
  return identifiers.find((identifier) => identifier.identifier_type === "sku")?.value ?? null;
}

export async function loadCommerceLabelForIdentifier(args: {
  admin: SupabaseClient;
  spotId: string;
  identifierId: string;
}) {
  const { data: identifier, error } = await args.admin
    .from("commerce_product_identifiers")
    .select("id,catalog_product_id,catalog_variant_id,spot_id,identifier_type,value,status")
    .eq("id", args.identifierId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!identifier) return null;

  const [{ data: listing, error: listingError }, { data: catalog, error: catalogError }, variantResult, identifiersResult] = await Promise.all([
    args.admin
      .from("commerce_products")
      .select("id,name,price,currency,catalog_product_id")
      .eq("spot_id", args.spotId)
      .eq("catalog_product_id", identifier.catalog_product_id)
      .limit(1)
      .maybeSingle(),
    args.admin
      .from("commerce_catalog_products")
      .select("id,name")
      .eq("id", identifier.catalog_product_id)
      .maybeSingle(),
    identifier.catalog_variant_id
      ? args.admin
          .from("commerce_catalog_variants")
          .select("id,title,color,size,presentation")
          .eq("id", identifier.catalog_variant_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    args.admin
      .from("commerce_product_identifiers")
      .select("id,catalog_product_id,catalog_variant_id,spot_id,identifier_type,value,status")
      .eq("catalog_product_id", identifier.catalog_product_id)
      .eq("status", "active")
      .or(`scope.eq.global,spot_id.is.null,spot_id.eq.${args.spotId}`),
  ]);
  const firstError = listingError ?? catalogError ?? variantResult.error ?? identifiersResult.error;
  if (firstError) throw new Error(firstError.message);
  if (!listing || !catalog) return null;

  const siblingIdentifiers = (identifiersResult.data ?? []).filter((candidate) =>
    candidate.catalog_variant_id === identifier.catalog_variant_id,
  ) as IdentifierRow[];
  const { data: listingVariant, error: listingVariantError } = identifier.catalog_variant_id
    ? await args.admin
        .from("commerce_product_variants")
        .select("sku,price_override")
        .eq("product_id", listing.id)
        .eq("catalog_variant_id", identifier.catalog_variant_id)
        .maybeSingle()
    : { data: null, error: null };
  if (listingVariantError) throw new Error(listingVariantError.message);

  const record: CommerceLabelRecord = {
    productName: listing.name || catalog.name,
    variantLabel: variantLabel(variantResult.data),
    sku: listingVariant?.sku ?? chooseSku(siblingIdentifiers),
    price: Number(listingVariant?.price_override ?? listing.price ?? 0),
    currency: listing.currency,
    barcode: chooseBarcode(siblingIdentifiers, identifier.id),
    qr: chooseQr(siblingIdentifiers, identifier.id),
  };
  return { record, identifiers: siblingIdentifiers, identifier: identifier as IdentifierRow };
}

export async function loadCommerceLabelsForListing(args: {
  admin: SupabaseClient;
  spotId: string;
  listingId: string;
  listingVariantId?: string | null;
}) {
  const { data: listing, error: listingError } = await args.admin
    .from("commerce_products")
    .select("id,name,price,currency,catalog_product_id")
    .eq("id", args.listingId)
    .eq("spot_id", args.spotId)
    .maybeSingle();
  if (listingError) throw new Error(listingError.message);
  if (!listing?.catalog_product_id) return null;

  let variantQuery = args.admin
    .from("commerce_product_variants")
    .select("id,catalog_variant_id,sku,title,color,size,price_override,active")
    .eq("product_id", listing.id)
    .eq("active", true)
    .order("created_at");
  if (args.listingVariantId) variantQuery = variantQuery.eq("id", args.listingVariantId);
  const [{ data: variants, error: variantsError }, identifiersResult] = await Promise.all([
    variantQuery,
    args.admin
      .from("commerce_product_identifiers")
      .select("id,catalog_product_id,catalog_variant_id,spot_id,identifier_type,value,status")
      .eq("catalog_product_id", listing.catalog_product_id)
      .eq("status", "active")
      .or(`scope.eq.global,spot_id.is.null,spot_id.eq.${args.spotId}`),
  ]);
  if (variantsError) throw new Error(variantsError.message);
  if (identifiersResult.error) throw new Error(identifiersResult.error.message);
  const identifiers = (identifiersResult.data ?? []) as IdentifierRow[];
  const targets = variants?.length ? variants : [null];
  const records = targets.map((variant) => {
    const scoped = identifiers.filter((identifier) => identifier.catalog_variant_id === (variant?.catalog_variant_id ?? null));
    return {
      variantId: variant?.id ?? null,
      record: {
        productName: listing.name,
        variantLabel: variantLabel(variant),
        sku: variant?.sku ?? chooseSku(scoped),
        price: Number(variant?.price_override ?? listing.price ?? 0),
        currency: listing.currency,
        barcode: chooseBarcode(scoped),
        qr: chooseQr(scoped),
      } satisfies CommerceLabelRecord,
      identifiers: scoped,
    };
  });
  return { listing, records };
}

export async function recordCommerceLabelEvents(args: {
  admin: SupabaseClient;
  identifierIds: string[];
  studioId: string;
  spotId: string;
  actorId: string;
  eventType: "downloaded_svg" | "downloaded_png" | "downloaded_pdf" | "printed";
  metadata: Record<string, unknown>;
}) {
  const uniqueIds = [...new Set(args.identifierIds)];
  if (!uniqueIds.length) return;
  const { error } = await args.admin.from("commerce_product_identifier_events").insert(uniqueIds.map((identifierId) => ({
    identifier_id: identifierId,
    studio_id: args.studioId,
    spot_id: args.spotId,
    event_type: args.eventType,
    actor_id: args.actorId,
    metadata: args.metadata,
  })));
  if (error) throw new Error(error.message);
}
