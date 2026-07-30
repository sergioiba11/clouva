import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { buildIdentityBrief } from "@/lib/server/vip-profile-brief";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = [
  "queued", "preparing_identity", "analyzing_identity", "generating_copy",
  "generating_assets", "assembling_profile", "needs_user_input",
];

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: string };
    if (!body.playerId) return NextResponse.json({ error: "Falta playerId." }, { status: 400 });

    const admin = createAdminSupabase();
    const { entitlement } = await requireActiveVipEntitlement({ admin, userId: user.id, playerId: body.playerId });

    const { data: existingJob, error: existingJobError } = await admin
      .from("vip_profile_generation_jobs")
      .select("id,status")
      .eq("player_id", body.playerId)
      .in("status", ACTIVE_STATUSES)
      .maybeSingle();
    if (existingJobError) throw new Error(existingJobError.message);
    if (existingJob) {
      return NextResponse.json({ jobId: existingJob.id, status: existingJob.status, reused: true });
    }

    const { brief, sourceSnapshot } = await buildIdentityBrief(admin, body.playerId);

    const { data: job, error: jobError } = await admin
      .from("vip_profile_generation_jobs")
      .insert({
        user_id: user.id,
        player_id: body.playerId,
        entitlement_id: entitlement?.id ?? null,
        status: "queued",
        identity_brief: brief,
        source_snapshot: sourceSnapshot,
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
