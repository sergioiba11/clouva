import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin } from "@/lib/server/clouva-control";
import { sanitizeMobileHomeConfig } from "@/lib/clouva-lab/mobile-home-config";

export const dynamic = "force-dynamic";

function sanitizeConfig(slug: string, config: unknown) {
  if (slug === "mobile-home") return sanitizeMobileHomeConfig(config);
  throw Object.assign(new Error(`Página no editable todavía: ${slug}`), { status: 400 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const { slug } = await context.params;
    const payload = await request.json().catch(() => null) as { config?: unknown } | null;
    if (!payload || !("config" in payload)) {
      return Response.json({ error: "Falta la configuración" }, { status: 400 });
    }

    const config = sanitizeConfig(slug, payload.config);
    const result = await identity.client.rpc("ui_save_page_draft", {
      p_slug: slug,
      p_config: config,
    });
    if (result.error) throw result.error;

    return Response.json({ page: result.data });
  } catch (error) {
    return apiError(error);
  }
}
