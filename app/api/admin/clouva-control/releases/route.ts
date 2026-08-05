import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin } from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const result = await identity.client
      .from("mobile_app_releases")
      .select("id,app_name,platform,version,build_number,file_size,checksum,release_notes,is_stable,minimum_required,created_at,published_at")
      .eq("platform", "android")
      .order("created_at", { ascending: false })
      .limit(50);
    if (result.error) throw result.error;

    const releases = result.data ?? [];
    const latestStable = releases.find((release) => release.is_stable) ?? releases[0] ?? null;
    return Response.json({ releases, latestStable });
  } catch (error) {
    return apiError(error);
  }
}
