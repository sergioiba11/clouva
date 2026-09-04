import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireSpaceInventoryAccess, resolveSpaceForStudio } from "@/lib/server/space-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ studioId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { studioId } = await params;
    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "inventory" });

    const form = await request.formData();
    const upload = form.get("file");
    if (!(upload instanceof File)) return NextResponse.json({ error: "Falta la imagen." }, { status: 400 });
    if (!MIME_EXT[upload.type]) return NextResponse.json({ error: "Usá JPG, PNG o WEBP." }, { status: 415 });
    if (upload.size <= 0 || upload.size > MAX_BYTES) return NextResponse.json({ error: "La imagen debe pesar hasta 8 MB." }, { status: 413 });

    const ext = MIME_EXT[upload.type];
    const path = `space-inventory/${space.id}/${Date.now()}-${randomUUID()}.${ext}`;
    const bytes = Buffer.from(await upload.arrayBuffer());
    const { error } = await admin.storage.from("product-images").upload(path, bytes, {
      contentType: upload.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(error.message);

    const { data } = admin.storage.from("product-images").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo subir la imagen." }, { status });
  }
}
