import { NextRequest, NextResponse } from "next/server";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import { createReferenceFidelityState, inferReferenceViewport, withReferenceFidelityState } from "@/lib/server/reference-fidelity-v3";
import { fetchReferenceImages } from "@/lib/server/vip-profile-assets";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id } = await params;
    const admin = createAdminSupabase();
    const { data: version, error: versionError } = await admin
      .from("player_profile_versions")
      .select("id,studio_id,status,generation_job_id,layout_config")
      .eq("id", id)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version?.studio_id) return NextResponse.json({ error: "La versión no pertenece a un Studio." }, { status: 400 });
    if (version.status !== "draft") return NextResponse.json({ error: "Solo se puede mejorar fidelidad sobre un borrador." }, { status: 409 });
    if (!version.generation_job_id) return NextResponse.json({ error: "Este borrador no conserva su job de generación." }, { status: 409 });

    const [{ data: studio, error: studioError }, { data: membership, error: membershipError }] = await Promise.all([
      admin.from("studios").select("id,owner_id").eq("id", version.studio_id).maybeSingle(),
      admin.from("studio_members").select("role").eq("studio_id", version.studio_id).eq("profile_id", user.id).eq("status", "active").maybeSingle(),
    ]);
    if (studioError) throw new Error(studioError.message);
    if (membershipError) throw new Error(membershipError.message);
    if (!studio || (studio.owner_id !== user.id && !membership)) return NextResponse.json({ error: "No tenés permiso para modificar este Studio." }, { status: 403 });

    const { data: job, error: jobError } = await admin
      .from("vip_profile_generation_jobs")
      .select("id,status,layout_analysis,reference_image_urls")
      .eq("id", version.generation_job_id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "No se encontró el job original." }, { status: 404 });
    const urls = (job.reference_image_urls as string[] | null) ?? [];
    const images = urls.length ? await fetchReferenceImages(urls) : [];
    const viewport = inferReferenceViewport(images[0]);
    if (!viewport) return NextResponse.json({ error: "No se pudo recuperar el viewport de la referencia original." }, { status: 409 });

    const fidelity = createReferenceFidelityState(viewport, id);
    const { data: claimed, error: updateError } = await admin
      .from("vip_profile_generation_jobs")
      .update({
        status: "rendering_reference_preview",
        generated_layout: version.layout_config,
        layout_analysis: withReferenceFidelityState(job.layout_analysis, fidelity),
        completed_at: null,
        error_message: null,
      })
      .eq("id", job.id)
      .in("status", ["review_ready", "failed", "cancelled"])
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!claimed) return NextResponse.json({ error: "Ese job ya está procesando otra operación." }, { status: 409 });

    await enqueueVipProfileJobStep(job.id as string);
    return NextResponse.json({ ok: true, jobId: job.id, status: "rendering_reference_preview" });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo mejorar la fidelidad." }, { status });
  }
}
