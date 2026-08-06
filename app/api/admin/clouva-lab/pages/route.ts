import type { NextRequest } from "next/server";
import { apiError, requireClouvaControlAdmin } from "@/lib/server/clouva-control";
import { sanitizeMobileHomeConfig } from "@/lib/clouva-lab/mobile-home-config";

export const dynamic = "force-dynamic";

type VersionRow = {
  id: string;
  page_id: string;
  version_number: number;
  status: string;
  source_version: number | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
};

function sanitizeConfig(slug: string, config: unknown) {
  if (slug === "mobile-home") return sanitizeMobileHomeConfig(config);
  return config;
}

export async function GET(request: NextRequest) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const pagesResult = await identity.client
      .from("ui_pages")
      .select("id,slug,name,route,platform,draft_config,published_config,draft_revision,published_version,updated_at,published_at")
      .order("name", { ascending: true });
    if (pagesResult.error) throw pagesResult.error;

    const pageIds = (pagesResult.data ?? []).map((page) => page.id);
    const versionsResult = pageIds.length
      ? await identity.client
          .from("ui_page_versions")
          .select("id,page_id,version_number,status,source_version,note,created_at,created_by")
          .in("page_id", pageIds)
          .order("version_number", { ascending: false })
      : { data: [] as VersionRow[], error: null };
    if (versionsResult.error) throw versionsResult.error;

    const versionsByPage = new Map<string, VersionRow[]>();
    for (const version of (versionsResult.data ?? []) as VersionRow[]) {
      const current = versionsByPage.get(version.page_id) ?? [];
      current.push(version);
      versionsByPage.set(version.page_id, current);
    }

    const pages = (pagesResult.data ?? []).map((page) => ({
      ...page,
      draft_config: sanitizeConfig(page.slug, page.draft_config),
      published_config: sanitizeConfig(page.slug, page.published_config),
      versions: versionsByPage.get(page.id) ?? [],
    }));

    return Response.json({ pages });
  } catch (error) {
    return apiError(error);
  }
}
