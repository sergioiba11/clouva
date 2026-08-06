import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const { slug } = await context.params;
    const payload = await request.json().catch(() => ({})) as { note?: unknown };
    const note = typeof payload.note === "string" ? payload.note.slice(0, 240) : null;

    const result = await identity.client.rpc("ui_publish_page", {
      p_slug: slug,
      p_note: note,
    });
    if (result.error) throw result.error;

    return Response.json({ publication: result.data });
  } catch (error) {
    return apiError(error);
  }
}
