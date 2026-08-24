import { NextRequest, NextResponse } from "next/server";
import { deleteGeneratedMedia } from "@/lib/gcs-media";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type ImageActionBody = {
  listingId?: unknown;
  action?: unknown;
  storagePath?: unknown;
  url?: unknown;
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
  const root = record(metadata);
  return record(root.product_images);
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as ImageActionBody;
    const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
    const action = body.action === "delete" || body.action === "set_cover" ? body.action : "";
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
      const now = new Date().toISOString();
      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: url, metadata: setCover(listing.metadata, url), updated_at: now })
        .eq("id", listing.id)
        .eq("spot_id", spot.id);
      if (updateError) throw new Error(updateError.message);

      if (listing.catalog_product_id) {
        const { data: catalog, error: catalogError } = await admin
          .from("commerce_catalog_products")
          .select("id,metadata")
          .eq("id", listing.catalog_product_id)
          .maybeSingle();
        if (catalogError) throw new Error(catalogError.message);
        if (catalog) {
          const { error: updateCatalogError } = await admin
            .from("commerce_catalog_products")
            .update({ metadata: setCover(catalog.metadata, url), updated_at: now })
            .eq("id", catalog.id);
          if (updateCatalogError) throw new Error(updateCatalogError.message);
        }
      }

      return NextResponse.json({ ok: true, action, listingId: listing.id, coverUrl: url });
    }

    const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    const target = images.find((image) => image.storagePath === storagePath);
    if (!storagePath || !target) return NextResponse.json({ error: "La imagen no pertenece a este producto." }, { status: 404 });

    const now = new Date().toISOString();
    const relatedQuery = listing.catalog_product_id
      ? admin.from("commerce_products").select("id,spot_id,cover_url,metadata").eq("catalog_product_id", listing.catalog_product_id)
      : admin.from("commerce_products").select("id,spot_id,cover_url,metadata").eq("id", listing.id);
    const { data: relatedListings, error: relatedError } = await relatedQuery;
    if (relatedError) throw new Error(relatedError.message);

    let currentCover: string | null = listing.cover_url;
    for (const related of relatedListings ?? []) {
      const next = removeImage(related.metadata, storagePath);
      const coverUrl = related.cover_url === target.url ? next.coverUrl : related.cover_url;
      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: coverUrl, metadata: next.metadata, updated_at: now })
        .eq("id", related.id);
      if (updateError) throw new Error(updateError.message);
      if (related.id === listing.id) currentCover = coverUrl;
    }

    if (listing.catalog_product_id) {
      const { data: catalog, error: catalogError } = await admin
        .from("commerce_catalog_products")
        .select("id,metadata")
        .eq("id", listing.catalog_product_id)
        .maybeSingle();
      if (catalogError) throw new Error(catalogError.message);
      if (catalog) {
        const next = removeImage(catalog.metadata, storagePath);
        const { error: updateCatalogError } = await admin
          .from("commerce_catalog_products")
          .update({ metadata: next.metadata, updated_at: now })
          .eq("id", catalog.id);
        if (updateCatalogError) throw new Error(updateCatalogError.message);
      }
    }

    await deleteGeneratedMedia(storagePath);
    return NextResponse.json({ ok: true, action, listingId: listing.id, deletedStoragePath: storagePath, coverUrl: currentCover });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo administrar la imagen." }, { status });
  }
}
