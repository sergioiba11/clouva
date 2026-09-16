import { NextRequest, NextResponse } from "next/server";
import { requireMediaAdmin } from "@/lib/server/media-auth";
import { getImportJob } from "@/lib/admin-assets/import-server";
import { normalizeAssetImportItem } from "@/lib/admin-assets/import-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
    if (!jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });

    const job = await getImportJob(admin, jobId);
    if (job.createdBy !== user.id) return NextResponse.json({ error: "Importación no autorizada." }, { status: 403 });

    const { data, error } = await admin
      .from("admin_asset_import_items")
      .select("id,job_id,original_path,filename,destination_path,content_type,size,status,error_message,started_at,completed_at,created_at,updated_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({
      job,
      items: (data ?? []).map((row) => normalizeAssetImportItem(row as Record<string, unknown>)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer el detalle de la importación.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
  }
}
