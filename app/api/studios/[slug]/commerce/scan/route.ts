import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  detectCommerceIdentifierType,
  type CommerceIdentifierType,
  validateCommerceIdentifier,
} from "@/lib/commerce/identifiers";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resultListingId(value: unknown) {
  const root = record(value);
  const listing = record(root.listing);
  return typeof listing.id === "string" ? listing.id : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const code = request.nextUrl.searchParams.get("code") ?? "";
    const requestedType = request.nextUrl.searchParams.get("type") as CommerceIdentifierType | null;
    const type = requestedType ?? detectCommerceIdentifierType(code);
    const validation = validateCommerceIdentifier(type, code);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data, error } = await admin.rpc("resolve_commerce_identifier", {
      p_spot_id: spot.id,
      p_value: validation.value,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ type, code: validation.value, result: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar el código." }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      code?: string;
      identifierType?: CommerceIdentifierType;
      product?: Record<string, unknown>;
      listing?: Record<string, unknown>;
      variant?: Record<string, unknown>;
      idempotencyKey?: string;
    };
    const code = body.code ?? "";
    const identifierType = body.identifierType ?? detectCommerceIdentifierType(code);
    const validation = validateCommerceIdentifier(identifierType, code);
    if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data, error } = await admin.rpc("upsert_commerce_scanned_product", {
      p_spot_id: spot.id,
      p_identifier_type: identifierType,
      p_identifier_value: validation.value,
      p_product: body.product ?? {},
      p_listing: body.listing ?? {},
      p_variant: body.variant ?? {},
      p_actor_id: user.id,
      p_idempotency_key: body.idempotencyKey || `scan:${spot.id}:${randomUUID()}`,
    });
    if (error) throw new Error(error.message);

    // El RPC canónico conserva la creación/resolución del producto. La portada
    // es una propiedad de la publicación del Spot, así que la persistimos sobre
    // commerce_products una vez que conocemos el listing resultante. De esta
    // forma no hace falta cambiar la firma del RPC ni duplicar su lógica.
    const listingId = resultListingId(data);
    const requestedCover = typeof body.listing?.cover_url === "string" ? body.listing.cover_url.trim() : "";
    const requestedMetadata = record(body.listing?.metadata);
    if (listingId && (requestedCover || Object.keys(requestedMetadata).length)) {
      const { data: existing, error: existingError } = await admin
        .from("commerce_products")
        .select("metadata")
        .eq("id", listingId)
        .eq("spot_id", spot.id)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);

      const patch: Record<string, unknown> = {};
      if (requestedCover) patch.cover_url = requestedCover;
      if (Object.keys(requestedMetadata).length) {
        patch.metadata = { ...record(existing?.metadata), ...requestedMetadata };
      }
      const { error: updateError } = await admin
        .from("commerce_products")
        .update(patch)
        .eq("id", listingId)
        .eq("spot_id", spot.id);
      if (updateError) throw new Error(updateError.message);

      const root = record(data);
      const listing = record(root.listing);
      root.listing = {
        ...listing,
        ...(requestedCover ? { cover_url: requestedCover } : {}),
        ...(Object.keys(requestedMetadata).length ? { metadata: patch.metadata } : {}),
      };
    }

    return NextResponse.json({ result: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear el producto." }, { status });
  }
}
