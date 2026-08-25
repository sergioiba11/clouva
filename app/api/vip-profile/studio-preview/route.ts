import { NextRequest, NextResponse } from "next/server";
import { resolveStudioIdentityById } from "@/lib/server/public-identity-data";
import { buildStudioProposal, type StudioVersionSnapshot } from "@/lib/server/studio-version-preview";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const studioId = request.nextUrl.searchParams.get("studioId")?.trim();
    if (!studioId) return NextResponse.json({ error: "Falta studioId." }, { status: 400 });

    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });

    const [current, versionsResult] = await Promise.all([
      resolveStudioIdentityById(admin, studioId),
      admin
        .from("player_profile_versions")
        .select("id,version_number,status,copy_config,visual_config,layout_config,asset_references,created_at,published_at")
        .eq("studio_id", studioId)
        .in("status", ["published", "draft"])
        .order("version_number", { ascending: false }),
    ]);
    if (!current) return NextResponse.json({ error: "El Estudio no existe." }, { status: 404 });
    if (versionsResult.error) throw new Error(versionsResult.error.message);

    const versions = (versionsResult.data ?? []) as StudioVersionSnapshot[];
    const publishedVersion = versions.find((item) => item.status === "published") ?? null;
    const draftVersion = versions.find((item) => item.status === "draft") ?? null;

    return NextResponse.json({
      studioId,
      canonicalPath: `/studios/${current.canonicalAlias}`,
      current,
      proposal: draftVersion ? buildStudioProposal(current, draftVersion) : null,
      publishedVersion,
      draftVersion,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el Preview de identidad.";
    return NextResponse.json({ error: message }, { status });
  }
}
