import type { NextRequest } from "next/server";
import { CLOUVA_FLOWS, CLOUVA_SCREENS, PREVIEW_PERSONAS } from "@/lib/clouva-control/screens";
import { apiError, collectClouvaProcesses, requireClouvaControlAdmin } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const identity = await requireClouvaControlAdmin(request);

    const [issuesResult, releasesResult, processes] = await Promise.all([
      identity.client
        .from("admin_mobile_issues")
        .select("id,title,description,module,route,preview_persona,status,priority,screenshot_path,device_model,resolution,app_version,web_version,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(100),
      identity.client
        .from("mobile_app_releases")
        .select("id,app_name,platform,version,build_number,file_size,checksum,release_notes,is_stable,minimum_required,created_at,published_at")
        .eq("platform", "android")
        .order("created_at", { ascending: false })
        .limit(30),
      collectClouvaProcesses(identity.client),
    ]);

    if (issuesResult.error) throw issuesResult.error;
    if (releasesResult.error) throw releasesResult.error;

    return Response.json({
      generatedAt: new Date().toISOString(),
      admin: { id: identity.user.id, email: identity.user.email ?? null, role: identity.role },
      screens: CLOUVA_SCREENS,
      flows: CLOUVA_FLOWS,
      personas: PREVIEW_PERSONAS,
      issues: issuesResult.data ?? [],
      processes,
      releases: releasesResult.data ?? [],
    });
  } catch (error) {
    return apiError(error);
  }
}
