import { NextRequest, NextResponse } from "next/server";
import { requireMediaAdmin } from "@/lib/server/media-auth";
import { getImportJob, persistUploadProgress } from "@/lib/admin-assets/import-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json() as { jobId?: unknown; uploadedBytes?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const uploadedBytes = Number(body.uploadedBytes ?? 0);
    if (!jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });
    if (!Number.isFinite(uploadedBytes) || uploadedBytes < 0) {
      return NextResponse.json({ error: "uploadedBytes inválido." }, { status: 400 });
    }

    const job = await getImportJob(admin, jobId);
    if (job.createdBy !== user.id) return NextResponse.json({ error: "Importación no autorizada." }, { status: 403 });
    if (["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status)) {
      return NextResponse.json({ job });
    }

    const updated = await persistUploadProgress(admin, job, uploadedBytes);
    return NextResponse.json({ job: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el progreso.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
  }
}
