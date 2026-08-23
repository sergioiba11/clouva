import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireMediaAdmin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new MediaApiError("Elegí una imagen de referencia.", 400, "file_required");
    if (file.size <= 0 || file.size > MAX_REFERENCE_BYTES) {
      throw new MediaApiError("La referencia debe pesar hasta 10 MB.", 413, "file_too_large");
    }
    if (!ALLOWED_MIME.has(file.type)) throw new MediaApiError("Usá una imagen JPG, PNG o WebP.", 415, "invalid_file_type");

    const bytes = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(bytes).metadata().catch(() => null);
    if (!metadata?.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
      throw new MediaApiError("El archivo no contiene una imagen válida.", 415, "invalid_image");
    }
    if (metadata.width < 256 || metadata.height < 256 || metadata.width > 8192 || metadata.height > 8192) {
      throw new MediaApiError("La imagen debe medir entre 256 y 8.192 px por lado.", 422, "invalid_dimensions");
    }
    const detectedMime = metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : "image/jpeg";
    const stored = await uploadGeneratedMediaObject({
      bytes,
      mimeType: detectedMime,
      pathPrefix: `media/${user.id}/references`,
    });
    return NextResponse.json({
      reference: {
        url: stored.url,
        storagePath: stored.objectPath,
        mimeType: detectedMime,
        width: metadata.width,
        height: metadata.height,
        size: bytes.length,
      },
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
