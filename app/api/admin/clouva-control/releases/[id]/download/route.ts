import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin, writeClouvaControlAudit } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const { id } = await context.params;
    const release = await identity.client
      .from("mobile_app_releases")
      .select("id,version,storage_path")
      .eq("id", id)
      .eq("platform", "android")
      .maybeSingle();

    if (release.error) throw release.error;
    if (!release.data) return Response.json({ error: "Release inexistente" }, { status: 404 });

    const signed = await identity.client.storage.from("admin-apk-releases").createSignedUrl(release.data.storage_path, 120);
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("No se pudo firmar la descarga");

    await writeClouvaControlAudit(identity, "apk.download_url.created", "clouva-control", { type: "mobile_app_release", id }, { version: release.data.version });

    return Response.json({ signedUrl: signed.data.signedUrl, expiresIn: 120, version: release.data.version });
  } catch (error) {
    return apiError(error);
  }
}
