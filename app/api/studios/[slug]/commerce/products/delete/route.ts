import { NextRequest, NextResponse } from "next/server";
import { deleteGeneratedMedia } from "@/lib/gcs-media";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteBody = { listingId?: unknown };
type JsonRecord = Record<string, unknown>;

type StoredImage = {
  url?: string;
  storage_path?: string;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function storedImages(metadata: unknown): StoredImage[] {
  const productImages = record(record(metadata).product_images);
  const source = Array.isArray(productImages.source_photos) ? productImages.source_photos : [];
  const generated = Array.isArray(productImages.generated_images) ? productImages.generated_images : [];
  return [...source, ...generated]
    .map((value) => record(value))
    .map((value) => ({
      url: typeof value.url === "string" ? value.url : undefined,
      storage_path: typeof value.storage_path === "string" ? value.storage_path : undefined,
    }));
}

function removeStoragePaths(metadata: unknown, removedPaths: Set<string>) {
  const root = { ...record(metadata) };
  const current = record(root.product_images);
  if (!Object.keys(current).length) return root;

  const filterImages = (value: unknown) => (Array.isArray(value) ? value : []).filter((item) => {
    const path = record(item).storage_path;
    return typeof path !== "string" || !removedPaths.has(path);
  });

  const sourcePhotos = filterImages(current.source_photos);
  const generatedImages = filterImages(current.generated_images);
  const removedUrls = new Set<string>();
  for (const item of [...(Array.isArray(current.source_photos) ? current.source_photos : []), ...(Array.isArray(current.generated_images) ? current.generated_images : [])]) {
    const row = record(item);
    if (typeof row.storage_path === "string" && removedPaths.has(row.storage_path) && typeof row.url === "string") removedUrls.add(row.url);
  }

  const nextCover = typeof current.cover_image === "string" && !removedUrls.has(current.cover_image)
    ? current.cover_image
    : (generatedImages.map(record).find((item) => item.kind === "front_catalog")?.url
      ?? generatedImages.map(record)[0]?.url
      ?? sourcePhotos.map(record).find((item) => item.label === "Frente")?.url
      ?? sourcePhotos.map(record)[0]?.url
      ?? null);

  root.product_images = {
    ...current,
    source_photos: sourcePhotos,
    generated_images: generatedImages,
    cover_image: typeof nextCover === "string" ? nextCover : null,
  };
  return root;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as DeleteBody;
    const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
    if (!listingId) return NextResponse.json({ error: "Falta el producto a eliminar." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });

    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,name,metadata")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });

    const deletedImages = storedImages(listing.metadata);
    const deletedPaths = new Set(deletedImages.map((image) => image.storage_path).filter((value): value is string => Boolean(value)));

    const { data: deleted, error: deleteError } = await admin.rpc("hard_delete_commerce_listing", {
      p_spot_id: spot.id,
      p_listing_id: listing.id,
    });
    if (deleteError) throw new Error(deleteError.message);

    // A catalog identity can be reused by another Spot. Only remove media that
    // is no longer referenced by another live listing of the same identity.
    let orphanPaths = new Set(deletedPaths);
    if (listing.catalog_product_id && deletedPaths.size) {
      const { data: remaining, error: remainingError } = await admin
        .from("commerce_products")
        .select("id,metadata")
        .eq("catalog_product_id", listing.catalog_product_id);
      if (remainingError) throw new Error(remainingError.message);

      const referenced = new Set<string>();
      for (const row of remaining ?? []) {
        for (const image of storedImages(row.metadata)) if (image.storage_path) referenced.add(image.storage_path);
      }
      orphanPaths = new Set([...deletedPaths].filter((path) => !referenced.has(path)));

      if (orphanPaths.size) {
        const { data: catalog, error: catalogError } = await admin
          .from("commerce_catalog_products")
          .select("id,metadata")
          .eq("id", listing.catalog_product_id)
          .maybeSingle();
        if (catalogError) throw new Error(catalogError.message);
        if (catalog) {
          const { error: updateCatalogError } = await admin
            .from("commerce_catalog_products")
            .update({ metadata: removeStoragePaths(catalog.metadata, orphanPaths), updated_at: new Date().toISOString() })
            .eq("id", catalog.id);
          if (updateCatalogError) throw new Error(updateCatalogError.message);
        }
      }
    }

    const mediaErrors: string[] = [];
    await Promise.all([...orphanPaths].map(async (path) => {
      try {
        await deleteGeneratedMedia(path);
      } catch (error) {
        mediaErrors.push(error instanceof Error ? error.message : `No se pudo borrar ${path}`);
      }
    }));

    return NextResponse.json({
      ok: true,
      listingId: listing.id,
      catalogProductId: listing.catalog_product_id,
      deleted,
      deletedMedia: orphanPaths.size - mediaErrors.length,
      mediaWarnings: mediaErrors,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el producto." }, { status });
  }
}
