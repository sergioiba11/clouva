import { NextRequest, NextResponse } from "next/server";
import { deleteGeneratedMedia } from "@/lib/gcs-media";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getMediaJob } from "@/lib/server/media-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const job = await getMediaJob(admin, user.id, id);
    if (!job) throw new MediaApiError("La creación no existe.", 404, "job_not_found");
    if (["queued", "generating", "processing", "saving"].includes(job.status)) {
      throw new MediaApiError("Esperá a que termine la creación antes de borrarla.", 409, "job_active");
    }

    for (const objectPath of [job.output_storage_path, job.reference_storage_path]) {
      if (objectPath) await deleteGeneratedMedia(objectPath);
    }
    const { error } = await admin.from("media_generation_jobs").delete().eq("id", job.id).eq("user_id", user.id);
    if (error) throw new MediaApiError("No se pudo borrar la creación.", 500, "job_delete_failed");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
