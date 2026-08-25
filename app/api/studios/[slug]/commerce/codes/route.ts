import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildClouvaBarcodeValue,
  buildClouvaQrUrl,
  buildSpotSku,
  detectCommerceIdentifierType,
  type CommerceIdentifierType,
  validateCommerceIdentifier,
} from "@/lib/commerce/identifiers";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

type IdentifierOrigin = "manufacturer" | "imported" | "manual" | "clouva_generated";
type GeneratedKind = "sku" | "code_128" | "clouva_qr";

type CodeBody = {
  action?: "generate" | "generate_all_variants" | "attach";
  listingId?: string;
  variantId?: string | null;
  identifierTypes?: GeneratedKind[];
  code?: string;
  identifierType?: CommerceIdentifierType;
  origin?: IdentifierOrigin;
  isPrimary?: boolean;
};

type PatchBody = {
  action?: "disable" | "replace" | "destination";
  identifierId?: string;
  code?: string;
  identifierType?: CommerceIdentifierType;
  origin?: IdentifierOrigin;
  confirmed?: boolean;
  destinationType?: "product" | "variant" | "authenticity" | "product_3d" | "digital_claim" | "experience";
  destinationPath?: string;
  destinationMetadata?: Record<string, unknown>;
};

const GENERATED_KINDS = new Set<GeneratedKind>(["sku", "code_128", "clouva_qr"]);

function publicToken() {
  return randomBytes(24).toString("base64url");
}

function equivalentType(identifierType: string, requested: GeneratedKind) {
  if (requested === "code_128") return identifierType === "code_128" || identifierType === "clouva_barcode";
  return identifierType === requested;
}

function identifierOrigin(type: CommerceIdentifierType, requested?: IdentifierOrigin): IdentifierOrigin {
  if (requested) return requested;
  if (["ean_13", "ean_8", "upc_a", "upc_e"].includes(type)) return "manufacturer";
  return "manual";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as CodeBody;
    if (!body.listingId) return NextResponse.json({ error: "Elegí un producto." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,name,slug")
      .eq("id", body.listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing?.catalog_product_id) return NextResponse.json({ error: "El producto todavía no tiene identidad global." }, { status: 409 });

    if (body.action === "attach") {
      const raw = body.code ?? "";
      const type = body.identifierType ?? detectCommerceIdentifierType(raw);
      const validation = validateCommerceIdentifier(type, raw);
      if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });
      const token = type === "clouva_qr" ? publicToken() : null;
      const value = type === "clouva_qr" ? buildClouvaQrUrl(siteUrl, token!) : validation.value;
      const { data, error } = await admin.rpc("create_commerce_product_identifier", {
        p_spot_id: spot.id,
        p_listing_id: listing.id,
        p_listing_variant_id: body.variantId || null,
        p_identifier_type: type,
        p_value: value,
        p_origin: identifierOrigin(type, body.origin),
        p_is_primary: body.isPrimary ?? ["ean_13", "ean_8", "upc_a", "upc_e"].includes(type),
        p_actor_id: user.id,
        p_public_token: token,
        p_destination_type: body.variantId ? "variant" : "product",
        p_destination_path: null,
        p_destination_metadata: {},
        p_replaces_identifier_id: null,
      });
      if (error) throw new Error(error.message);
      const result = data as { conflict?: boolean; product?: unknown } | null;
      if (result?.conflict) return NextResponse.json({ error: "El código ya pertenece a otro producto.", result }, { status: 409 });
      return NextResponse.json({ result }, { status: 201 });
    }

    const { data: requestedVariants, error: variantsError } = body.action === "generate_all_variants"
      ? await admin
          .from("commerce_product_variants")
          .select("id,product_id,catalog_variant_id,sku,size,color,title")
          .eq("product_id", listing.id)
          .eq("active", true)
          .order("created_at")
      : body.variantId
        ? await admin
            .from("commerce_product_variants")
            .select("id,product_id,catalog_variant_id,sku,size,color,title")
            .eq("id", body.variantId)
            .eq("product_id", listing.id)
        : { data: [], error: null };
    if (variantsError) throw new Error(variantsError.message);
    const targets = requestedVariants?.length ? requestedVariants : [null];
    const requestedKinds = body.identifierTypes?.length
      ? body.identifierTypes.filter((kind): kind is GeneratedKind => GENERATED_KINDS.has(kind))
      : ["sku", "code_128", "clouva_qr"] satisfies GeneratedKind[];
    if (!requestedKinds.length) return NextResponse.json({ error: "Elegí al menos un tipo de identificador." }, { status: 400 });
    const { data: existing, error: existingError } = await admin
      .from("commerce_product_identifiers")
      .select("id,catalog_product_id,catalog_variant_id,identifier_type,value,status,origin,public_token,created_at")
      .eq("catalog_product_id", listing.catalog_product_id)
      .eq("status", "active")
      .or(`scope.eq.global,spot_id.is.null,spot_id.eq.${spot.id}`);
    if (existingError) throw new Error(existingError.message);

    const results: Array<Record<string, unknown>> = [];
    for (const variant of targets) {
      for (const kind of requestedKinds) {
        const active = (existing ?? []).find((identifier) =>
          identifier.catalog_variant_id === (variant?.catalog_variant_id ?? null)
          && equivalentType(identifier.identifier_type, kind));
        if (active) {
          results.push({ variantId: variant?.id ?? null, kind, status: "kept", identifier: active });
          continue;
        }
        const seed = randomUUID().replace(/-/g, "").toUpperCase();
        const token = kind === "clouva_qr" ? publicToken() : null;
        const value = kind === "sku"
          ? (variant?.sku || buildSpotSku({
              spotSlug: spot.slug,
              productName: listing.name,
              color: variant?.color,
              size: variant?.size,
              suffix: seed.slice(-4),
            }))
          : kind === "code_128"
            ? buildClouvaBarcodeValue(seed)
            : buildClouvaQrUrl(siteUrl, token!);
        const { data, error } = await admin.rpc("create_commerce_product_identifier", {
          p_spot_id: spot.id,
          p_listing_id: listing.id,
          p_listing_variant_id: variant?.id ?? null,
          p_identifier_type: kind,
          p_value: value,
          p_origin: "clouva_generated",
          p_is_primary: false,
          p_actor_id: user.id,
          p_public_token: token,
          p_destination_type: variant ? "variant" : "product",
          p_destination_path: null,
          p_destination_metadata: {},
          p_replaces_identifier_id: null,
        });
        if (error) throw new Error(error.message);
        const result = data as { conflict?: boolean } | null;
        if (result?.conflict) return NextResponse.json({ error: "Un código generado entró en conflicto.", result }, { status: 409 });
        results.push({ variantId: variant?.id ?? null, kind, status: "created", result });
      }
    }
    return NextResponse.json({ results }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron guardar los códigos." }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as PatchBody;
    if (!body.identifierId || !body.action) return NextResponse.json({ error: "Elegí un identificador y una acción." }, { status: 400 });
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: identifier, error: identifierError } = await admin
      .from("commerce_product_identifiers")
      .select("id,spot_id,identifier_type,status")
      .eq("id", body.identifierId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (identifierError) throw new Error(identifierError.message);
    if (!identifier) return NextResponse.json({ error: "El identificador no pertenece a este Spot." }, { status: 404 });

    if (body.action === "disable") {
      const { data, error } = await admin.rpc("disable_commerce_product_identifier", {
        p_identifier_id: identifier.id,
        p_actor_id: user.id,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ identifier: data });
    }
    if (body.action === "destination") {
      if (identifier.identifier_type !== "clouva_qr") return NextResponse.json({ error: "Solo los QR tienen destino editable." }, { status: 400 });
      const { data, error } = await admin.rpc("update_commerce_qr_destination", {
        p_identifier_id: identifier.id,
        p_destination_type: body.destinationType || "product",
        p_destination_path: body.destinationPath || "",
        p_destination_metadata: body.destinationMetadata ?? {},
        p_actor_id: user.id,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ identifier: data });
    }

    const raw = body.code ?? "";
    const type = body.identifierType ?? detectCommerceIdentifierType(raw);
    const validation = validateCommerceIdentifier(type, raw);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });
    const token = type === "clouva_qr" ? publicToken() : null;
    const value = type === "clouva_qr" ? buildClouvaQrUrl(siteUrl, token!) : validation.value;
    const { data, error } = await admin.rpc("replace_commerce_product_identifier", {
      p_identifier_id: identifier.id,
      p_identifier_type: type,
      p_value: value,
      p_origin: identifierOrigin(type, body.origin),
      p_actor_id: user.id,
      p_confirmed: body.confirmed === true,
      p_public_token: token,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ result: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el identificador.";
    const status = (error as Error & { status?: number })?.status
      ?? (isAuthError(error) ? 401 : /ya pertenece a otro producto/i.test(message) ? 409 : /Confirmá/.test(message) ? 400 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
