import { NextRequest, NextResponse } from "next/server";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseDataUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Falta la imagen.");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("La imagen no tiene un formato válido.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("Usá imágenes JPG, PNG o WEBP.");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Cada imagen debe pesar hasta 5 MB.");
  return { bytes, mimeType };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      sourceIndex?: unknown;
      fileName?: unknown;
      dataUrl?: unknown;
    };
    const sourceIndex = Math.floor(Number(body.sourceIndex));
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= 80) {
      return NextResponse.json({ error: "Índice de imagen inválido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    const { data: batch, error: batchError } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,total_images")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });
    if (!["uploading", "failed"].includes(batch.status)) {
      return NextResponse.json({ error: "El lote ya comenzó a procesarse." }, { status: 409 });
    }

    const parsed = parseDataUrl(body.dataUrl);
    const stored = await uploadGeneratedMediaObject({
      bytes: parsed.bytes,
      mimeType: parsed.mimeType,
      pathPrefix: `commerce/${spot.id}/bulk-import/${batch.id}`,
    });
    const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 240) : null;

    const { data, error } = await admin
      .from("commerce_product_import_items")
      .upsert({
        batch_id: batch.id,
        spot_id: spot.id,
        source_index: sourceIndex,
        file_name: fileName,
        source_url: stored.url,
        storage_path: stored.objectPath,
        mime_type: parsed.mimeType,
        status: "uploaded",
        group_key: null,
        listing_id: null,
        recognition: {},
        error: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "batch_id,source_index" })
      .select("id,source_index,source_url,storage_path,mime_type,status")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar la imagen." }, { status });
  }
}
