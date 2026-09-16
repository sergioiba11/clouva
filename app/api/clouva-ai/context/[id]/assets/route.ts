import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { getContextPack } from "@/lib/clouva-ai/media/context-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeName(value: string) {
  return value.replace(/[\\/\u0000-\u001f]+/g, "-").trim().slice(0, 180) || "reference";
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const pack = await getContextPack(admin, user.id, id);
    if (!pack) return NextResponse.json({ error: "El contexto no existe.", code: "context_not_found" }, { status: 404 });

    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File).slice(0, MAX_FILES_PER_UPLOAD);
    if (!files.length) return NextResponse.json({ error: "Seleccioná al menos una imagen.", code: "files_required" }, { status: 400 });

    let position = pack.assets.reduce((max, asset) => Math.max(max, asset.position), -1) + 1;
    const inserted = [];
    for (const file of files) {
      if (!ALLOWED_MIME.has(file.type)) {
        return NextResponse.json({ error: `${file.name}: formato no compatible. Usá PNG, JPG o WebP.`, code: "invalid_mime" }, { status: 415 });
      }
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name}: cada imagen debe pesar hasta 12 MB.`, code: "file_too_large" }, { status: 413 });
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      if (!metadata.width || !metadata.height) {
        return NextResponse.json({ error: `${file.name}: no se pudo validar como imagen.`, code: "invalid_image" }, { status: 422 });
      }
      const stored = await uploadGeneratedMediaObject({
        bytes,
        mimeType: file.type,
        pathPrefix: `clouai/contexts/${user.id}/${id}`,
      });
      const { data, error } = await admin.from("clouai_context_assets").insert({
        context_id: id,
        user_id: user.id,
        kind: "image",
        name: safeName(file.name),
        storage_path: stored.objectPath,
        public_url: stored.url,
        mime_type: file.type,
        width: metadata.width,
        height: metadata.height,
        byte_size: bytes.length,
        position,
        priority: 0,
        is_primary: pack.assets.length === 0 && inserted.length === 0,
        metadata_json: {},
      }).select("id,context_id,name,kind,storage_path,public_url,mime_type,width,height,byte_size,position,priority,is_primary,metadata_json,created_at").single();
      if (error || !data) throw new Error(`No se pudo registrar ${file.name}.`);
      inserted.push(data);
      position += 1;
    }

    await admin.from("clouai_contexts").update({ summary_state: "stale", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    return NextResponse.json({ assets: inserted }, { status: 201 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
