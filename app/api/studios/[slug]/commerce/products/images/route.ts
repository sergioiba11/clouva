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
  approved?: unknown;
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

function stringUrls(value: unknown, limit = 24) {
  if (!Array.isArray(value)) return [];
  const urls = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
  return Array.from(new Set(urls)).slice(0, limit);
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

function publicationMasterGallery(metadata: unknown) {
  const master = record(productImages(metadata).publication_master);
  return stringUrls(master.gallery);
}

function approvedGallery(args: { gallery: unknown; metadata: unknown; coverUrl: string | null }) {
  const canonical = stringUrls(args.gallery);
  const fromMaster = publicationMasterGallery(args.metadata);
  const base = canonical.length ? canonical : fromMaster;
  return Array.from(new Set([
    ...(args.coverUrl ? [args.coverUrl] : []),
    ...base,
  ])).slice(0, 24);
}

function syncPublicationMetadata(metadata: unknown, coverUrl: string | null, gallery: string[]) {
  const root = { ...record(metadata) };
  const current = productImages(root);
  const normalizedGallery = Array.from(new Set([
    ...(coverUrl ? [coverUrl] : []),
    ...gallery.filter(Boolean),
  ])).slice(0, 24);
  root.product_images = {
    ...current,
    cover_image: coverUrl,
    publication_master: {
      cover_url: coverUrl,
      gallery: normalizedGallery,
      selected_at: new Date().toISOString(),
    },
  };
  return { metadata: root, gallery: normalizedGallery };
}

function removeImage(metadata: unknown, storagePath: string) {
  const root = { ...record(metadata) };
  const current = productImages(root);
  if (!Object.keys(current).length) return { metadata: root, removedUrl: null as string | null };

  let removedUrl: string | null = null;
  const filter = (value: unknown) => (Array.isArray(value) ? value : []).filter((raw) => {
    const item = record(raw);
    if (item.storage_path === storagePath) {
      if (typeof item.url === "string") removedUrl = item.url;
      return false;
    }
    return true;
  });

  root.product_images = {
    ...current,
    source_photos: filter(current.source_photos),
    generated_images: filter(current.generated_images),
  };

  return { metadata: root, removedUrl };
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
    const action = body.action === "delete"
      || body.action === "set_cover"
      || body.action === "set_publication"
      || body.action === "add"
      || body.action === "replace"
      ? body.action
      : "";
    if (!listingId || !action) return NextResponse.json({ error: "Faltan datos para administrar la imagen." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,cover_url,gallery,metadata")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });

    const images = catalogImages(listing.metadata);
    const currentGallery = approvedGallery({ gallery: listing.gallery, metadata: listing.metadata, coverUrl: listing.cover_url });

    if (action === "set_cover") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url || !images.some((image) => image.url === url)) {
        return NextResponse.json({ error: "La portada debe ser una imagen guardada en este producto." }, { status: 400 });
      }
      const nextGallery = [url, ...currentGallery.filter((candidate) => candidate !== url)];
      const synced = syncPublicationMetadata(listing.metadata, url, nextGallery);
      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: url, gallery: synced.gallery, metadata: synced.metadata, updated_at: new Date().toISOString() })
        .eq("id", listing.id)
        .eq("spot_id", spot.id);
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ ok: true, action, listingId: listing.id, coverUrl: url, gallery: synced.gallery });
    }

    if (action === "set_publication") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const approved = body.approved === true;
      if (!url || !images.some((image) => image.url === url)) {
        return NextResponse.json({ error: "La imagen debe pertenecer a este producto." }, { status: 400 });
      }

      let nextGallery = approved
        ? Array.from(new Set([...currentGallery, url]))
        : currentGallery.filter((candidate) => candidate !== url);
      let nextCover = listing.cover_url;
      if (approved && !nextCover) nextCover = url;
      if (!approved && nextCover === url) nextCover = nextGallery[0] ?? null;
      if (nextCover) nextGallery = [nextCover, ...nextGallery.filter((candidate) => candidate !== nextCover)];

      const synced = syncPublicationMetadata(listing.metadata, nextCover, nextGallery);
      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: nextCover, gallery: synced.gallery, metadata: synced.metadata, updated_at: new Date().toISOString() })
        .eq("id", listing.id)
        .eq("spot_id", spot.id);
      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ ok: true, action, approved, listingId: listing.id, coverUrl: nextCover, gallery: synced.gallery });
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
      let nextGallery = [...currentGallery];
      let replaced: CatalogImage | null = null;
      let replacedWasApproved = false;
      let replacedWasCover = false;

      if (action === "replace") {
        const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
        replaced = images.find((image) => image.storagePath === storagePath) ?? null;
        if (!replaced) {
          await deleteGeneratedMedia(stored.objectPath);
          return NextResponse.json({ error: "La imagen a reemplazar no pertenece al producto." }, { status: 404 });
        }
        replacedWasApproved = currentGallery.includes(replaced.url);
        replacedWasCover = coverUrl === replaced.url;
        const removed = removeImage(metadata, replaced.storagePath);
        metadata = removed.metadata;
        if (replacedWasApproved) {
          nextGallery = nextGallery.map((candidate) => candidate === replaced!.url ? stored.url : candidate);
        }
        if (replacedWasCover) coverUrl = stored.url;
      }

      metadata = addManualImage(metadata, { url: stored.url, storagePath: stored.objectPath, mimeType: parsed.mimeType }, replaced?.label || label);
      if (!coverUrl) {
        coverUrl = stored.url;
        nextGallery = [stored.url, ...nextGallery];
      } else if (replacedWasCover && !nextGallery.includes(stored.url)) {
        nextGallery = [stored.url, ...nextGallery];
      }

      const synced = syncPublicationMetadata(metadata, coverUrl, nextGallery);
      const { error: updateError } = await admin
        .from("commerce_products")
        .update({ cover_url: coverUrl, gallery: synced.gallery, metadata: synced.metadata, updated_at: new Date().toISOString() })
        .eq("id", listing.id)
        .eq("spot_id", spot.id);
      if (updateError) {
        await deleteGeneratedMedia(stored.objectPath);
        throw new Error(updateError.message);
      }

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

      return NextResponse.json({
        ok: true,
        action,
        listingId: listing.id,
        coverUrl,
        gallery: synced.gallery,
        image: { url: stored.url, storagePath: stored.objectPath, mimeType: parsed.mimeType, approved: synced.gallery.includes(stored.url) },
      });
    }

    const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    const target = images.find((image) => image.storagePath === storagePath);
    if (!storagePath || !target) return NextResponse.json({ error: "La imagen no pertenece a este producto." }, { status: 404 });

    const now = new Date().toISOString();
    const next = removeImage(listing.metadata, storagePath);
    let nextGallery = currentGallery.filter((candidate) => candidate !== target.url);
    const currentCover = listing.cover_url === target.url ? (nextGallery[0] ?? null) : listing.cover_url;
    if (currentCover) nextGallery = [currentCover, ...nextGallery.filter((candidate) => candidate !== currentCover)];
    const synced = syncPublicationMetadata(next.metadata, currentCover, nextGallery);
    const { error: updateError } = await admin
      .from("commerce_products")
      .update({ cover_url: currentCover, gallery: synced.gallery, metadata: synced.metadata, updated_at: now })
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
      gallery: synced.gallery,
      mediaDeleted: !sharedElsewhere,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo administrar la imagen." }, { status });
  }
}