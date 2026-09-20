import { NextRequest, NextResponse } from "next/server";
import { enqueueFacebookPublisherBatch } from "@/lib/server/cloud-tasks";
import {
  failPublicationJob,
  markPublicationJobWaiting,
  refreshPublicationBatchSummary,
} from "@/lib/server/facebook-publisher";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = (process.env.CLOUVA_FACEBOOK_PUBLISHER_TASK_SECRET || process.env.CLOUVA_ASSET_IMPORT_WORKER_SECRET)?.trim();
  const received = request.headers.get("x-clouva-facebook-publisher-secret")?.trim();
  return Boolean(expected && received && expected === received);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { batchId?: string };
  const batchId = body.batchId?.trim();
  if (!batchId) return NextResponse.json({ error: "Falta batchId." }, { status: 400 });

  const admin = createAdminSupabase();
  let claimedJob: Record<string, unknown> | null = null;

  try {
    const batch = await admin
      .from("publication_batches")
      .select("id,status,user_id,spot_id")
      .eq("id", batchId)
      .maybeSingle();
    if (batch.error) throw new Error(batch.error.message);
    if (!batch.data) return NextResponse.json({ ok: true, finished: true, reason: "batch_not_found" });
    if (["paused", "cancelled", "completed", "failed"].includes(String(batch.data.status))) {
      return NextResponse.json({ ok: true, finished: true, status: batch.data.status });
    }

    const claim = await admin.rpc("claim_next_publication_job", { p_batch_id: batchId });
    if (claim.error) throw new Error(claim.error.message);
    claimedJob = claim.data && typeof claim.data === "object" ? claim.data as Record<string, unknown> : null;

    if (!claimedJob?.id) {
      const summary = await refreshPublicationBatchSummary(admin, batchId);
      return NextResponse.json({ ok: true, finished: true, batch: summary });
    }

    const destination = await admin
      .from("facebook_destinations")
      .select("id,name,type,facebook_url,facebook_id,cooldown_minutes,last_published_at,enabled")
      .eq("id", String(claimedJob.destination_id))
      .eq("user_id", String(claimedJob.user_id))
      .maybeSingle();
    if (destination.error) throw new Error(destination.error.message);
    if (!destination.data || !destination.data.enabled) {
      await failPublicationJob(admin, String(claimedJob.id), "DESTINATION_DISABLED", "El destino de Facebook está desactivado.");
      await enqueueFacebookPublisherBatch(batchId);
      return NextResponse.json({ ok: true, jobId: claimedJob.id, status: "failed" });
    }

    const cooldownMinutes = Math.max(15, Number(destination.data.cooldown_minutes || 0));
    const duplicateCutoff = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
    const duplicate = await admin
      .from("publication_jobs")
      .select("id,published_url,completed_at")
      .eq("product_id", String(claimedJob.product_id))
      .eq("destination_id", String(claimedJob.destination_id))
      .eq("content_hash", String(claimedJob.content_hash))
      .eq("status", "published")
      .neq("id", String(claimedJob.id))
      .gte("completed_at", duplicateCutoff)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (duplicate.error) throw new Error(duplicate.error.message);

    if (duplicate.data) {
      const now = new Date().toISOString();
      const skipped = await admin
        .from("publication_jobs")
        .update({
          status: "skipped",
          completed_at: now,
          published_url: duplicate.data.published_url,
          error_code: "RECENT_DUPLICATE",
          error_message: "Se evitó una publicación duplicada reciente con el mismo contenido y destino.",
          updated_at: now,
        })
        .eq("id", String(claimedJob.id));
      if (skipped.error) throw new Error(skipped.error.message);
      await refreshPublicationBatchSummary(admin, batchId);
      await enqueueFacebookPublisherBatch(batchId);
      return NextResponse.json({ ok: true, jobId: claimedJob.id, status: "skipped" });
    }

    const channel = String(claimedJob.channel);
    if (channel === "facebook_marketplace") {
      await markPublicationJobWaiting(
        admin,
        claimedJob,
        "Facebook Marketplace requiere tu confirmación final. CLOUVA dejó título, precio, descripción e imágenes listos para abrir el formulario oficial.",
      );
    } else if (channel === "facebook_group") {
      await markPublicationJobWaiting(
        admin,
        claimedJob,
        "Facebook Groups no ofrece publicación oficial por API. CLOUVA dejó el contenido listo y abre el grupo exacto para que confirmes la publicación.",
      );
    } else {
      await markPublicationJobWaiting(
        admin,
        claimedJob,
        "La publicación automática en Facebook Pages requiere una conexión Meta con permisos de Page válida. Hasta entonces este job queda asistido y no se marca como publicado.",
      );
    }

    await enqueueFacebookPublisherBatch(batchId);
    return NextResponse.json({ ok: true, jobId: claimedJob.id, status: "waiting_confirmation" });
  } catch (error) {
    if (claimedJob?.id) {
      try {
        await failPublicationJob(
          admin,
          String(claimedJob.id),
          "RUNNER_ERROR",
          error instanceof Error ? error.message : "Error desconocido del runner.",
        );
        await enqueueFacebookPublisherBatch(batchId);
      } catch {
        // Preserve the original runner error response.
      }
    }
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo procesar el lote.",
    }, { status: 500 });
  }
}
