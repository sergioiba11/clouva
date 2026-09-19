import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  listingId?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  costAmount?: unknown;
  stock?: unknown;
  status?: unknown;
  autosave?: unknown;
  brand?: unknown;
  category?: unknown;
  productKind?: unknown;
  listingKind?: unknown;
  size?: unknown;
  color?: unknown;
  presentation?: unknown;
  coverUrlCandidate?: unknown;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max: number) {
  const valueText = text(value, max);
  return valueText || null;
}

function has(body: UpdateBody, key: keyof UpdateBody) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function numberValue(value: unknown, field: string, { min = 0, nullable = false }: { min?: number; nullable?: boolean } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`${field} no es válido.`);
  return parsed;
}

function stockValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("El stock no es válido.");
  return parsed;
}

function stringUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function imageUrls(metadata: unknown) {
  const images = record(record(metadata).product_images);
  const rows = [
    ...(Array.isArray(images.source_photos) ? images.source_photos : []),
    ...(Array.isArray(images.generated_images) ? images.generated_images : []),
  ];
  return new Set(rows.flatMap((raw) => {
    const url = record(raw).url;
    return typeof url === "string" && /^https?:\/\//i.test(url) ? [url] : [];
  }));
}

function publicationMasterApproved(metadata: unknown) {
  const images = record(record(metadata).product_images);
  const master = record(images.publication_master);
  return master.approved === true
    && typeof master.cover_url === "string"
    && master.cover_url.length > 0
    && stringUrls(master.gallery).length > 0;
}

function lifecycleMissing(args: {
  name: string;
  price: number;
  stock: number | null;
  productType: string;
  coverUrl: string | null;
  metadata: unknown;
}) {
  return [
    ...(!args.name ? ["name"] : []),
    ...(!(args.price > 0) ? ["price"] : []),
    ...(!args.coverUrl ? ["cover"] : []),
    ...(args.productType === "physical" && args.stock == null ? ["stock"] : []),
    ...(!publicationMasterApproved(args.metadata) ? ["publication_master"] : []),
  ];
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateBody;
    const listingId = text(body.listingId, 80);
    if (!listingId) return NextResponse.json({ error: "Falta el producto a editar." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,product_type,listing_kind,name,description,price,cost_amount,stock,status,cover_url,gallery,metadata")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });

    const nextName = has(body, "name") ? text(body.name, 180) : listing.name;
    if (!nextName) return NextResponse.json({ error: "El producto necesita un nombre." }, { status: 400 });

    const nextDescription = has(body, "description")
      ? nullableText(body.description, 4000)
      : listing.description;
    const nextPrice: number = has(body, "price") && body.price !== ""
      ? Number(numberValue(body.price, "El precio"))
      : Number(listing.price || 0);
    const nextCost = has(body, "costAmount")
      ? numberValue(body.costAmount, "El costo", { nullable: true })
      : listing.cost_amount == null ? null : Number(listing.cost_amount);
    const nextStock = has(body, "stock")
      ? stockValue(body.stock)
      : listing.stock == null ? null : Number(listing.stock);

    const requestedStatus = text(body.status, 24);
    const allowedStatus = new Set(["draft", "published", "paused", "archived"]);
    const nextStatus = requestedStatus && allowedStatus.has(requestedStatus)
      ? requestedStatus
      : listing.status === "published" ? "published" : "draft";
    const autosave = body.autosave === true;

    const nextMetadata = { ...record(listing.metadata) };
    const currentDraftFields = record(nextMetadata.draft_fields);
    nextMetadata.draft_fields = {
      ...currentDraftFields,
      ...(has(body, "brand") ? { brand: text(body.brand, 120) } : {}),
      ...(has(body, "category") ? { category: text(body.category, 120) } : {}),
      ...(has(body, "productKind") ? { product_kind: text(body.productKind, 40) } : {}),
      ...(has(body, "listingKind") ? { listing_kind: text(body.listingKind, 40) } : {}),
      ...(has(body, "size") ? { size: text(body.size, 80) } : {}),
      ...(has(body, "color") ? { color: text(body.color, 80) } : {}),
      ...(has(body, "presentation") ? { presentation: text(body.presentation, 160) } : {}),
    };

    let nextCover = listing.cover_url;
    let nextGallery = Array.isArray(listing.gallery)
      ? listing.gallery.filter((url): url is string => typeof url === "string")
      : [];
    const coverCandidate = text(body.coverUrlCandidate, 2000);
    if (coverCandidate) {
      if (!imageUrls(nextMetadata).has(coverCandidate)) {
        return NextResponse.json({ error: "La portada provisoria debe pertenecer a este producto." }, { status: 400 });
      }
      nextCover = coverCandidate;
      nextGallery = [coverCandidate, ...nextGallery.filter((url) => url !== coverCandidate)].slice(0, 24);
    }

    const missing = lifecycleMissing({
      name: nextName,
      price: nextPrice,
      stock: nextStock,
      productType: listing.product_type,
      coverUrl: nextCover,
      metadata: nextMetadata,
    });
    const updatedAt = new Date().toISOString();
    const currentLifecycle = record(nextMetadata.draft_lifecycle);
    const stage = nextStatus === "published" ? "published" : missing.length ? "incomplete" : "ready";
    nextMetadata.draft_lifecycle = {
      ...currentLifecycle,
      stage,
      missing,
      price_confirmed: nextPrice > 0,
      cost_confirmed: nextCost != null,
      stock_confirmed: listing.product_type !== "physical" || nextStock != null,
      last_saved_at: updatedAt,
      autosave,
    };

    if (nextStatus === "published") {
      if (!(nextPrice > 0)) {
        return NextResponse.json({ error: "Confirmá un precio mayor a cero antes de publicar.", code: "PRICE_REQUIRED" }, { status: 400 });
      }
      if (!nextCover) {
        return NextResponse.json({ error: "Elegí una portada antes de publicar.", code: "COVER_REQUIRED" }, { status: 400 });
      }
      if (!publicationMasterApproved(nextMetadata)) {
        return NextResponse.json({
          error: "Aprobá la imagen master antes de publicar el producto.",
          code: "PUBLICATION_MASTER_REQUIRED",
        }, { status: 409 });
      }
    }

    const { data: updated, error: updateError } = await admin
      .from("commerce_products")
      .update({
        name: nextName,
        description: nextDescription,
        price: nextPrice,
        cost_amount: nextCost,
        stock: nextStock,
        status: nextStatus,
        cover_url: nextCover,
        gallery: nextGallery,
        listing_kind: has(body, "listingKind") ? text(body.listingKind, 40) || listing.listing_kind : listing.listing_kind,
        metadata: nextMetadata,
        updated_at: updatedAt,
      })
      .eq("id", listing.id)
      .eq("spot_id", spot.id)
      .select("id,name,description,price,cost_amount,currency,stock,status,cover_url,gallery,metadata,updated_at")
      .single();
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, product: updated, stage, missing });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo editar el producto." }, { status });
  }
}
