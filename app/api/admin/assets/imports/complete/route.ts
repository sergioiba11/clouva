import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { requireMediaAdmin } from "@/lib/server/media-auth";
import {
  enqueueImportJob,
  getImportJob,
  persistUploadProgress,
} from "@/lib/admin-assets/import-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json() as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });

    let job = await getImportJob(admin, jobId);
    if (job.createdBy !== user.id) return NextResponse.json({ error: "Importación no autorizada." }, { status: 403 });
    if (["queued", "extracting", "importing", "completed", "completed_with_errors"].includes(job.status)) {
      return NextResponse.json({ job });
    }
    if (["failed", "cancelled"].includes(job.status)) {
      return NextResponse.json({ error: job.errorMessage ?? "La importación está cerrada.", job }, { status: 409 });
    }

    const file = getStorage().bucket(job.stagingBucket).file(job.stagingPath);
    const [exists] = await file.exists();
    if (!exists) return NextResponse.json({ error: "El ZIP todavía no está completo en staging." }, { status: 409 });
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size ?? 0);
    if (storedSize !== job.sourceSize) {
      return NextResponse.json({
        error: `El ZIP en staging tiene ${storedSize} bytes y se esperaban ${job.sourceSize}.`,
        code: "staging_size_mismatch",
      }, { status: 409 });
    }

    job = await persistUploadProgress(admin, job, job.totalBytes);
    job = await enqueueImportJob(admin, job);
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar el procesamiento del ZIP.";
    const status = /Falta CLOUVA_ASSET_IMPORT|Cloud Tasks|credencial/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message.slice(0, 600) }, { status });
  }
}
