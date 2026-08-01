import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { uploadGeneratedMedia } from "@/lib/gcs-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 3;

// Upload-only step, decoupled from a generation job (a job doesn't exist yet
// at this point) -- the client accumulates the returned URLs and passes them
// as referenceImageUrls to POST /api/vip-profile/generate afterwards. Same
// GCS bucket/helper as Gemini's own generated output (uploadGeneratedMedia),
// just a different path prefix, so the storage side needs nothing new.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const form = await request.formData();
    const playerId = typeof form.get("playerId") === "string" ? String(form.get("playerId")) : "";
    const studioId = typeof form.get("studioId") === "string" ? String(form.get("studioId")) : "";
    if (!playerId && !studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (playerId && studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: playerId || undefined, studioId: studioId || undefined });

    const files = form.getAll("images").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) return NextResponse.json({ error: "No se recibió ninguna imagen." }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Máximo ${MAX_FILES} imágenes.` }, { status: 400 });
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Usá PNG, JPG o WEBP." }, { status: 415 });
      if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "Cada imagen debe pesar hasta 8 MB." }, { status: 413 });
    }

    const subjectPrefix = playerId ? `players/${playerId}` : `studios/${studioId}`;
    const urls = await Promise.all(
      files.map(async (file) => {
        const bytes = Buffer.from(await file.arrayBuffer());
        return uploadGeneratedMedia({ bytes, mimeType: file.type, pathPrefix: `reference-images/${subjectPrefix}` });
      }),
    );

    return NextResponse.json({ urls });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron subir las imágenes.";
    return NextResponse.json({ error: message }, { status });
  }
}
