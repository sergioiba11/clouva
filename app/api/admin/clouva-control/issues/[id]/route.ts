import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin, writeClouvaControlAudit } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["detectado", "en_revision", "en_desarrollo", "listo_para_probar", "resuelto"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) return Response.json({ error: "Reporte inválido" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(body.status ?? "").trim().toLowerCase();
    if (!VALID_STATUSES.has(status)) return Response.json({ error: "Estado inválido" }, { status: 400 });

    const update = await identity.client
      .from("admin_mobile_issues")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id,title,status,priority,route,updated_at")
      .single();
    if (update.error) throw update.error;

    await writeClouvaControlAudit(
      identity,
      "issue.status_changed",
      "clouva-control",
      { type: "admin_mobile_issue", id },
      { status },
    );

    return Response.json({ issue: update.data });
  } catch (error) {
    return apiError(error);
  }
}
