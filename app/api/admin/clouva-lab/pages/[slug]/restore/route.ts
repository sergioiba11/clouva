import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const { slug } = await context.params;
    const payload = await request.json().catch(() => null) as { version?: unknown; note?: unknown } | null;
    const version = Number(payload?.version);
    if (!Number.isInteger(version) || version <= 0) {
      return Response.json({ error: "Versión inválida" }, { status: 400 });
    }
    const note = typeof payload?.note === "string" ? payload.note.slice(0, 240) : null;

    const result = await identity.client.rpc("ui_restore_page_version", {
      p_slug: slug,
      p_version_number: version,
      p_note: note,
    });
    if (result.error) throw result.error;

    return Response.json({ restoration: result.data });
  } catch (error) {
    return apiError(error);
  }
}
