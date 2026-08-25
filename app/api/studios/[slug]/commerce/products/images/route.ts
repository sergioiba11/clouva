import { NextRequest, NextResponse } from "next/server";
import { deleteGeneratedMedia, uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type JsonRecord = Record<string, unknown>;
type ImageActionBody = {
  listingId?: unknown;
  action?: unknown;
  storagePath?: unknown;
  url?: unknown;
  dataUrl?: unknown;
  label?: unknown;
};

type CatalogImage = {
  url: string;
  storagePath: string;
  label: string;
  source: "source" | "generated";
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function productImages(metadata: unknown) {
  return record(record(metadata).product_images);
}

function catalogImages(metadata: unknown): CatalogImage[] {
  const images = productImages(metadata);
  const source = (Array.isArray(images.source_photos) ? images.source_photos : []).map((value) => {
    const item = record(value);
    return {
      url: typeof item.url === "string" ? item.url : "",
      storagePath: typeof item.storage_path === "string" ? item.storage_path : "",
      label: typeof item.display_label === "string" ? item.display_label : typeof item.label === "string" ? item.label : "Original",
      source: "source" as const,
    };
  });
  const generated = (Array.isArray(images.generated_images) ? images.generated_images : []).map((value) => {
    const item = record(value);
    const sourceLabel = typeof item.source_label === "string" ? item.source_label : "Gemini";
    const detailIndex = typeof item.detail_index === "number" ? ` ${item.detail_index}` : "";
    return {
      url: typeof item.url === "string" ? item.url : "",
      storagePath: typeof item.storage_path === "string" ? item.storage_path : "",
      label: `${sourceLabel}${detailIndex}`,
      source: "generated" as const,
    };
  });
  return [...generated, ...source].filter((item) => item.url && item.storagePath);
}

function galleryFromMetadata(metadata: unknown, coverUrl: string | null) {
  const urls = [coverUrl, ...catalogImages(metadata).map((image) => image.url)].filter((value): value is string => Boolean(value));
  return [...new Set(urls)];
}

function removeImage(metadata: unknown, storagePath: string) {
  const root = { ...record(metadata) };
  const current = productImages(root);
  if (!Object.keys(current).length) return { metadata: root, removedUrl: null as string | null, coverUrl: null as string | null };

  let removedUrl: string | null = null;
  const filter = (value: unknown) => (Array.isArray(value) ? value : []).filter((raw) => {
    const item = record(raw);
    if (item.storage_path === storagePath) {
      if (typeof item.url === "string") removedUrl = item.url;
      return false;
    }
    return true;
  });

  const sourcePhotos = filter(current.source_photos);
  const generatedImages = filter(current.generated_images);
  const generatedRecords = generatedImages.map(record);
  const sourceRecords = sourcePhotos.map(record);
  const oldCover = typeof current.cover_image === "string" ? current.cover_image : null;
  const coverUrl = oldCover && oldCover !== removedUrl
    ? oldCover
    : (generatedRecords.find((item) => item.kind === "front_catalog")?.url
      ?? generatedRecords[0]?.url
      ?? sourceRecords.find((item) => item.label === "Frente")?.url
      ?? sourceRecords[0]?.url
      ?? null);

  root.product_images = {
    ...current,
    source_photos: sourcePhotos,
    generated_images: generatedImages,
    cover_image: typeof coverUrl === "string" ? coverUrl : null,
  };

  return {
    metadata: root,
    removedUrl,
    coverUrl: typeof coverUrl === "string" ? coverUrl : null,
  };
}

function setCover(metadata: unknown, coverUrl: string) {
  const root = { ...record(metadata) };
  const current = productImages(root);
  root.product_images = { ...current, cover_image: coverUrl };
  return root;
}

function addManualImage(metadata: unknown, image: { url: string; storagePath: string; mimeType: string }, label: string) {
  const root = { ...record(metadata) };
  const current = productImages(root);
  const sourcePhotos = Array.isArray(current.source_photos) ? [...current.source_photos] : [];
  sourcePhotos.push({
    url: image.url,
    storage_path: image.storagePath,
    mime_type: image.mimeType,
    label: "Manual",
    display_label: label,
    detail_index: null,
  });
  root.product_images = {
    ...current,
    provider: current.provider ?? "manual",
    source_photos: sourcePhotos,
  };
  return root;
}

function parseDataUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Falta la imagen.");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("La imagen no tiene un formato válido.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("Usá una imagen JPG, PNG o WEBP.");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("La imagen debe pesar hasta 8 MB.");
  return { bytes, mimeType };
}

function referencesImage(metadata: unknown, storagePath: string) {
  return catalogImages(metadata).some((image) => image.storagePath === storagePath);
}

async function removeSharedCatalogReference(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  listingId: string;
  catalogProductId: string | null;
  storagePath: string;
  targetUrl: string;
}) {
  if (!args.catalogProductId) return false;
  const { data: relatedListings, error: relatedError } = await args.admin
    .from("commerce_products")
    .select("id,cover_url,metadata")
    .eq("catalog_product_id", args.catalogProductId)
    .neq("id", args.listingId);
  if (relatedError) throw new Error(relatedError.message);

  const sharedElsewhere = (relatedListings ?? []).some((related) => related.cover_url === args.targetUrl || referencesImage(related.metadata, args.storagePath));
  if (sharedElsewhere) return true;

  const { data: catalog, error: catalogError } = await args.admin
    .from("commerce_catalog_products")
    .select("id,metadata")
    .eq("id", args.catalogProductId)
    .maybeSingle();
  if (catalogError) throw new Error(catalogError.message);
  if (catalog) {
    const catalogNext = removeImage(catalog.metadata, args.storagePath);
    const { error: updateCatalogError } = await args.admin
      .from("commerce_catalog_products")
      .update({ metadata: catalogNext.metadata, updated_at: new Date().toISOString() })
      .eq("id", catalog.id);
    if (updateCatalogError) throw new Error(updateCatalogError.message);
  }
  return false;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as ImageActionBody;
    const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
    const action = body.action === "delete" || body.action === "set_cover" || body.action === "add" || body.action === "replace" ? body.action : "";
    if (!listingId || !action) return NextResponse.json({ error: "Faltan datos para administrar la imagen." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,cover_url,metadata")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });

    const images = catalogImages(listing.metadata);

    if (action === "set_cover") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url || !images.some((image) => image.url === url)) {
        return NextResponse.json({ error: "La portada debe ser una imagen guardada en este producto." }, { status: 400 });
      }
      const metadata = setCover(listing.metadata, url);
      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: url, gallery: galleryFromMetadata(metadata, url), metadata, updated_at: new Date().toISOString() })
        .eq("id", listing.id)
        .eq("spot_id", spot.id);
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ ok: true, action, listingId: listing.id, coverUrl: url });
    }

    if (action === "add" || action === "replace") {
      const parsed = parseDataUrl(body.dataUrl);
      const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "Imagen agregada";
      const stored = await uploadGeneratedMediaObject({
        bytes: parsed.bytes,
        mimeType: parsed.mimeType,
        pathPrefix: `commerce/${spot.id}/product-manual`,
      });

      let metadata = listing.metadata;
      let coverUrl = listing.cover_url;
      let replaced: CatalogImage | null = null;
      if (action === "replace") {
        const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
        replaced = images.find((image) => image.storagePath === storagePath) ?? null;
        if (!replaced) return NextResponse.json({ error: "La imagen a reemplazar no pertenece al producto." }, { status: 404 });
        const removed = removeImage(metadata, replaced.storagePath);
        metadata = removed.metadata;
        if (coverUrl === replaced.url) coverUrl = stored.url;
      }

      metadata = addManualImage(metadata, { url: stored.url, storagePath: stored.objectPath, mimeType: parsed.mimeType }, replaced?.label || label);
      if (!coverUrl) coverUrl = stored.url;
      if (coverUrl === stored.url) metadata = setCover(metadata, stored.url);

      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: coverUrl, gallery: galleryFromMetadata(metadata, coverUrl), metadata, updated_at: new Date().toISOString() })
        .eq("id", listing.id)
        .eq("spot_id", spot.id);
      if (updateError) throw new Error(updateError.message);

      if (replaced) {
        const sharedElsewhere = await removeSharedCatalogReference({
          admin,
          listingId: listing.id,
          catalogProductId: listing.catalog_product_id,
          storagePath: replaced.storagePath,
          targetUrl: replaced.url,
        });
        if (!sharedElsewhere) await deleteGeneratedMedia(replaced.storagePath);
      }

      return NextResponse.json({ ok: true, action, listingId: listing.id, coverUrl, image: { url: stored.url, storagePath: stored.objectPath, mimeType: parsed.mimeType } });
    }

    const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    const target = images.find((image) => image.storagePath === storagePath);
    if (!storagePath || !target) return NextResponse.json({ error: "La imagen no pertenece a este producto." }, { status: 404 });

    const now = new Date().toISOString();
    const next = removeImage(listing.metadata, storagePath);
    const currentCover = listing.cover_url === target.url ? next.coverUrl : listing.cover_url;
    const { error: updateError } = await admin
      .from("commerce_products")
      .update({ cover_url: currentCover, gallery: galleryFromMetadata(next.metadata, currentCover), metadata: next.metadata, updated_at: now })
      .eq("id", listing.id)
      .eq("spot_id", spot.id);
    if (updateError) throw new Error(updateError.message);

    const sharedElsewhere = await removeSharedCatalogReference({
      admin,
      listingId: listing.id,
      catalogProductId: listing.catalog_product_id,
      storagePath,
      targetUrl: target.url,
    });
    if (!sharedElsewhere) await deleteGeneratedMedia(storagePath);

    return NextResponse.json({
      ok: true,
      action,
      listingId: listing.id,
      deletedStoragePath: storagePath,
      coverUrl: currentCover,
      mediaDeleted: !sharedElsewhere,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo administrar la imagen." }, { status });
  }
}
