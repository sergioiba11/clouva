import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief, buildStudioIdentityBrief } from "@/lib/server/vip-profile-brief";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = [
  "queued", "preparing_identity", "analyzing_identity", "generating_copy",
  "classifying_reference", "generating_assets", "generating_variants", "generating_variant_assets",
  "assembling_profile", "awaiting_variant_selection", "needs_user_input",
];

// Only ever a URL our own /api/vip-profile/reference-images upload produced
// (uploadGeneratedMedia's fixed host + our own path shape) is accepted here
// -- the process-job worker later fetch()es these server-side, so accepting
// arbitrary client-supplied URLs would be an SSRF vector.
const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;

function sanitizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((url): url is string => typeof url === "string" && REFERENCE_IMAGE_URL_RE.test(url))
    .slice(0, MAX_REFERENCE_IMAGES);
}

// Works for either subject -- playerId XOR studioId in the body, mirrors
// requireActiveVipEntitlement's own shape.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: string; studioId?: string; referenceImageUrls?: unknown };
    if (!body.playerId && !body.studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });
    if (body.playerId && body.studioId) return NextResponse.json({ error: "Elegí playerId o studioId, no ambos." }, { status: 400 });
    const referenceImageUrls = sanitizeReferenceImageUrls(body.referenceImageUrls);

    const admin = createAdminSupabase();
    const { entitlement } = await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId, studioId: body.studioId });

    const { data: existingJob, error: existingJobError } = await admin
      .from("vip_profile_generation_jobs")
      .select("id,status")
      .eq(body.playerId ? "player_id" : "studio_id", body.playerId || body.studioId)
      .in("status", ACTIVE_STATUSES)
      .maybeSingle();
    if (existingJobError) throw new Error(existingJobError.message);
    if (existingJob) {
      return NextResponse.json({ jobId: existingJob.id, status: existingJob.status, reused: true });
    }

    const { brief, sourceSnapshot } = body.playerId
      ? await buildIdentityBrief(admin, body.playerId)
      : await buildStudioIdentityBrief(admin, body.studioId as string);

    const { data: job, error: jobError } = await admin
      .from("vip_profile_generation_jobs")
      .insert({
        user_id: user.id,
        player_id: body.playerId || null,
        studio_id: body.studioId || null,
        entitlement_id: entitlement?.id ?? null,
        status: "queued",
        identity_brief: brief,
        source_snapshot: sourceSnapshot,
        reference_image_urls: referenceImageUrls,
      })
      .select("id,status")
      .single();
    if (jobError) throw new Error(jobError.message);

    await enqueueVipProfileJobStep(job.id as string);

    return NextResponse.json({ jobId: job.id, status: job.status, reused: false });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar la generación.";
    return NextResponse.json({ error: message }, { status });
  }
}
