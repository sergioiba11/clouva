import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin, writeClouvaControlAudit } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const VALID_PRIORITIES = new Set(["baja", "media", "alta", "critica"]);

export async function GET(request: NextRequest) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const result = await identity.client
      .from("admin_mobile_issues")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);
    if (result.error) throw result.error;
    return Response.json({ issues: result.data ?? [] });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const title = String(body.title ?? "").trim();
    const description = String(body.description ?? "").trim();
    const priority = String(body.priority ?? "media").toLowerCase();

    if (!title) return Response.json({ error: "El título es obligatorio" }, { status: 400 });
    if (!VALID_PRIORITIES.has(priority)) return Response.json({ error: "Prioridad inválida" }, { status: 400 });

    let screenshotPath: string | null = null;
    const screenshotBase64 = typeof body.screenshotBase64 === "string" ? body.screenshotBase64 : null;
    if (screenshotBase64) {
      const normalized = screenshotBase64.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(normalized, "base64");
      if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
        return Response.json({ error: "La captura supera 5 MB" }, { status: 413 });
      }
      const mime = typeof body.screenshotMime === "string" ? body.screenshotMime : "image/jpeg";
      const extension = mime.includes("png") ? "png" : "jpg";
      screenshotPath = `${identity.user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const upload = await identity.client.storage.from("admin-mobile-issues").upload(screenshotPath, bytes, {
        contentType: mime,
        upsert: false,
      });
      if (upload.error) throw upload.error;
    }

    const insert = await identity.client
      .from("admin_mobile_issues")
      .insert({
        created_by: identity.user.id,
        title,
        description: description || null,
        module: typeof body.module === "string" ? body.module : null,
        route: typeof body.route === "string" ? body.route : null,
        preview_persona: typeof body.previewPersona === "string" ? body.previewPersona : null,
        screenshot_path: screenshotPath,
        device_model: typeof body.deviceModel === "string" ? body.deviceModel : null,
        resolution: typeof body.resolution === "string" ? body.resolution : null,
        app_version: typeof body.appVersion === "string" ? body.appVersion : null,
        web_version: typeof body.webVersion === "string" ? body.webVersion : null,
        priority,
        metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      })
      .select("*")
      .single();

    if (insert.error) throw insert.error;
    await writeClouvaControlAudit(identity, "issue.created", "clouva-control", { type: "admin_mobile_issue", id: insert.data.id }, { route: insert.data.route, priority });

    return Response.json({ issue: insert.data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
