import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import {
  analyzeStructureImageWithCloud,
  applyStructureAnalysis,
  getOwnedStructure,
  rebuildStructureImageOrder,
} from "@/lib/structures/server";
import type { StructureImageRecord } from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo analizar la evidencia.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as { imageId?: string; limit?: number };
    const limit = Math.min(6, Math.max(1, Number(body.limit) || 4));

    let query = admin
      .from("structure_images")
      .select("*")
      .eq("structure_id", id);

    if (body.imageId) query = query.eq("id", body.imageId);
    else query = query.in("analysis_status", ["uploaded", "metadata_ready", "failed"]).order("created_at", { ascending: true }).limit(limit);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron seleccionar imágenes pendientes.");
    const images = (data ?? []) as unknown as StructureImageRecord[];
    if (!images.length) {
      return NextResponse.json({ processed: 0, results: [], remaining: 0 });
    }

    await admin.from("structures").update({
      status: "analyzing",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    await admin
      .from("structure_images")
      .update({ analysis_status: "analyzing", updated_at: new Date().toISOString() })
      .in("id", images.map((image) => image.id))
      .eq("structure_id", id);

    const results = await Promise.all(images.map(async (image) => {
      try {
        const analysis = await analyzeStructureImageWithCloud(image);
        const updated = await applyStructureAnalysis(admin, structure, image, analysis);
        return { id: image.id, ok: true as const, status: updated.analysis_status };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falló el análisis.";
        await admin
          .from("structure_images")
          .update({
            analysis_status: "failed",
            analysis: { error: message },
            updated_at: new Date().toISOString(),
          })
          .eq("id", image.id)
          .eq("structure_id", id);
        return { id: image.id, ok: false as const, error: message };
      }
    }));

    await rebuildStructureImageOrder(admin, id);

    const [{ count: remaining }, { count: needsReview }] = await Promise.all([
      admin
        .from("structure_images")
        .select("id", { count: "exact", head: true })
        .eq("structure_id", id)
        .in("analysis_status", ["uploaded", "metadata_ready", "failed"]),
      admin
        .from("structure_images")
        .select("id", { count: "exact", head: true })
        .eq("structure_id", id)
        .eq("analysis_status", "needs_review"),
    ]);

    const nextStatus = (remaining ?? 0) > 0 ? "analyzing" : (needsReview ?? 0) > 0 ? "review" : "ready";
    await admin.from("structures").update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    return NextResponse.json({
      processed: images.length,
      results,
      remaining: remaining ?? 0,
      needsReview: needsReview ?? 0,
      projectStatus: nextStatus,
    });
  } catch (error) {
    return responseError(error);
  }
}
