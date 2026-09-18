import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure, ingestStructureImage, rebuildStructureImageOrder } from "@/lib/structures/server";
import { extractStructureZip } from "@/lib/structures/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

const ZIP_MIME = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const MAX_DIRECT_FILES = 400;

function mimeFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "zip") return "application/zip";
  return "";
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo subir la evidencia.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    let structure = await getOwnedStructure(admin, user.id, id);
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) throw new Error("Seleccioná imágenes o un ZIP.");
    if (files.length > MAX_DIRECT_FILES) throw new Error(`Subí como máximo ${MAX_DIRECT_FILES} archivos por lote.`);

    const requestBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (requestBytes > MAX_UPLOAD_BYTES) throw new Error("El lote supera 300 MB.");

    await admin.from("structures").update({
      status: "uploading",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    const isSingleZip = files.length === 1 && (ZIP_MIME.has(files[0].type) || files[0].name.toLowerCase().endsWith(".zip"));
    const { data: batch, error: batchError } = await admin
      .from("structure_upload_batches")
      .insert({
        structure_id: id,
        source_name: files.length === 1 ? files[0].name : `${files.length} archivos`,
        source_kind: isSingleZip ? "zip" : "files",
        status: "uploading",
      })
      .select("id")
      .single();
    if (batchError || !batch) throw new Error("No se pudo abrir el lote de importación.");

    const created: string[] = [];
    const failures: Array<{ file: string; error: string }> = [];

    const ingest = async (entry: {
      fileName: string;
      originalPath: string;
      mimeType: string;
      bytes: Buffer;
    }) => {
      try {
        structure = await getOwnedStructure(admin, user.id, id);
        const row = await ingestStructureImage({
          admin,
          userId: user.id,
          structure,
          batchId: batch.id,
          bytes: entry.bytes,
          mimeType: entry.mimeType,
          fileName: entry.fileName,
          originalPath: entry.originalPath,
        });
        created.push(row.id);
      } catch (error) {
        failures.push({
          file: entry.originalPath,
          error: error instanceof Error ? error.message : "No se pudo importar.",
        });
      }
    };

    for (const file of files) {
      const mimeType = file.type || mimeFromName(file.name);
      const bytes = Buffer.from(await file.arrayBuffer());
      const isZip = ZIP_MIME.has(mimeType) || file.name.toLowerCase().endsWith(".zip");
      if (isZip) {
        let entries;
        try {
          entries = extractStructureZip(bytes);
        } catch (error) {
          failures.push({ file: file.name, error: error instanceof Error ? error.message : "ZIP inválido." });
          continue;
        }
        for (const entry of entries) {
          await ingest({
            fileName: entry.fileName,
            originalPath: entry.originalPath,
            mimeType: entry.mimeType,
            bytes: entry.bytes,
          });
        }
      } else {
        await ingest({
          fileName: file.name,
          originalPath: file.name,
          mimeType: mimeType || mimeFromName(file.name),
          bytes,
        });
      }
    }

    if (created.length) await rebuildStructureImageOrder(admin, id);

    await admin
      .from("structure_upload_batches")
      .update({
        status: created.length ? "completed" : "failed",
        file_count: created.length,
        error: failures.length ? failures.slice(0, 20).map((failure) => `${failure.file}: ${failure.error}`).join("\n") : null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", batch.id);

    await admin.from("structures").update({
      status: created.length ? "analyzing" : "review",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    return NextResponse.json({
      batchId: batch.id,
      imported: created.length,
      imageIds: created,
      failures,
    }, { status: created.length ? 201 : 400 });
  } catch (error) {
    return responseError(error);
  }
}
