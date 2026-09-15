import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { resolveIdentityAssetState } from "@/lib/studio-identity-assets";
import { isVipProfileFidelityStatus, selectVipProfileJobState } from "@/lib/vip-profile-job-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VersionRow = { id: string; version_number: number; status: string } & Record<string, unknown>;
type JobRow = {
  id: string;
  status: string;
  layout_analysis?: unknown;
  error_message?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
} & Record<string, unknown>;

function resolveVersionState(versions: VersionRow[]) {
  const publishedVersion = versions.find((version) => version.status === "published") ?? null;
  const publishedNumber = publishedVersion?.version_number ?? 0;
  const drafts = versions.filter((version) => version.status === "draft");
  return {
    publishedVersion,
    draftVersion: drafts.find((version) => version.version_number > publishedNumber) ?? null,
    staleDrafts: drafts.filter((version) => version.version_number <= publishedNumber),
  };
}

function normalizeClientJob(job: JobRow | null) {
  if (!job) return null;
  const referenceFidelity = job.layout_analysis && typeof job.layout_analysis === "object"
    ? (job.layout_analysis as Record<string, unknown>).referenceFidelity ?? null
    : null;

  if (isVipProfileFidelityStatus(job.status)) {
    return {
      ...job,
      status: "assembling_profile",
      fidelity_status: job.status,
      reference_fidelity: referenceFidelity,
    };
  }

  return {
    ...job,
    fidelity_status: null,
    reference_fidelity: referenceFidelity,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const playerId = request.nextUrl.searchParams.get("playerId")?.trim() || null;
    const studioId = request.nextUrl.searchParams.get("studioId")?.trim() || null;
    if (!playerId && !studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });

    const admin = createAdminSupabase();
    let subjectLogoUrl: string | null = null;

    if (playerId) {
      const [{ data: player, error: playerError }, { data: membership, error: membershipError }] = await Promise.all([
        admin.from("players").select("id,owner_user_id,logo_url").eq("id", playerId).maybeSingle(),
        admin.from("player_members").select("role").eq("player_id", playerId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
      ]);
      if (playerError) throw new Error(playerError.message);
      if (membershipError) throw new Error(membershipError.message);
      if (!player) return NextResponse.json({ error: "El Player no existe." }, { status: 404 });
      if (player.owner_user_id !== user.id && !membership) return NextResponse.json({ error: "No tenés permiso para ver este Player." }, { status: 403 });
      subjectLogoUrl = typeof player.logo_url === "string" ? player.logo_url : null;
    } else {
      const [{ data: studio, error: studioError }, { data: membership, error: membershipError }] = await Promise.all([
        admin.from("studios").select("id,owner_id,logo_url").eq("id", studioId).maybeSingle(),
        admin.from("studio_members").select("role").eq("studio_id", studioId).eq("profile_id", user.id).eq("status", "active").maybeSingle(),
      ]);
      if (studioError) throw new Error(studioError.message);
      if (membershipError) throw new Error(membershipError.message);
      if (!studio) return NextResponse.json({ error: "El Estudio no existe." }, { status: 404 });
      if (studio.owner_id !== user.id && !membership) return NextResponse.json({ error: "No tenés permiso para ver este Estudio." }, { status: 403 });
      subjectLogoUrl = typeof studio.logo_url === "string" ? studio.logo_url : null;
    }

    const subjectColumn = playerId ? "player_id" : "studio_id";
    const subjectId = playerId || studioId;
    const [{ data: jobs, error: jobsError }, { data: versions, error: versionsError }] = await Promise.all([
      admin
        .from("vip_profile_generation_jobs")
        .select("id,status,generated_copy,generated_assets,layout_variants,layout_analysis,error_message,actual_cost_usd,created_at,completed_at")
        .eq(subjectColumn, subjectId)
        .order("created_at", { ascending: false })
        .limit(25),
      admin
        .from("player_profile_versions")
        .select("id,version_number,status,profile_level,copy_config,layout_config,asset_references,brand_asset_version_id,created_at,published_at")
        .eq(subjectColumn, subjectId)
        .order("version_number", { ascending: false }),
    ]);
    if (jobsError) throw new Error(jobsError.message);
    if (versionsError) throw new Error(versionsError.message);

    const normalizedVersions = (versions ?? []) as VersionRow[];
    const versionState = resolveVersionState(normalizedVersions);
    const identityAssets = resolveIdentityAssetState({
      publishedVersion: versionState.publishedVersion,
      draftVersion: versionState.draftVersion,
      subjectLogoUrl,
    });
    const jobRows = (jobs ?? []) as JobRow[];
    const jobState = selectVipProfileJobState(jobRows);
    const activeJob = normalizeClientJob(jobState.activeJob);
    const latestJob = normalizeClientJob(jobState.latestJob);
    const lastFailedJob = normalizeClientJob(jobState.lastFailedJob);

    return NextResponse.json({
      // Backwards-compatible operational alias. Historical terminal jobs never
      // masquerade as the current generation state.
      job: activeJob,
      activeJob,
      latestJob,
      lastFailedJob,
      versions: normalizedVersions,
      publishedVersion: versionState.publishedVersion,
      draftVersion: versionState.draftVersion,
      staleDrafts: versionState.staleDrafts,
      ...identityAssets,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el estado.";
    return NextResponse.json({ error: message }, { status });
  }
}
