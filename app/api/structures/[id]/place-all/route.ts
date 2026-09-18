import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure, placeStructureImage, rebuildStructureImageOrder } from "@/lib/structures/server";
import type { StructureImageRecord } from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudieron ubicar las cámaras.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);
    const body = await request.json().catch(() => ({})) as { limit?: number };
    const limit = Math.min(6, Math.max(1, Number(body.limit) || 4));

    const { data, error } = await admin
      .from("structure_images")
      .select("*")
      .eq("structure_id", id)
      .eq("placement_status", "unplaced")
      .order("manual_verified", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error("No se pudieron seleccionar referencias pendientes.");

    const images = (data ?? []) as unknown as StructureImageRecord[];
    if (!images.length) {
      const { count: blocked } = await admin
        .from("structure_images")
        .select("id", { count: "exact", head: true })
        .eq("structure_id", id)
        .in("placement_status", ["blocked", "needs_review"]);
      return NextResponse.json({ processed: 0, placed: 0, review: blocked ?? 0, remaining: 0, results: [] });
    }

    await admin.from("structures").update({
      status: "spatializing",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    const results = [];
    for (const image of images) {
      try {
        const placed = await placeStructureImage({
          admin,
          userId: user.id,
          structure,
          image,
          allowCloud: true,
        });
        results.push({
          id: image.id,
          ok: true,
          status: placed.image.placement_status,
          usedCloud: placed.usedCloud,
          needsReview: placed.needsReview,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo ubicar.";
        await admin
          .from("structure_images")
          .update({
            placement_status: "blocked",
            metadata: {
              ...(image.metadata ?? {}),
              placement: {
                ...((image.metadata?.placement && typeof image.metadata.placement === "object")
                  ? image.metadata.placement as Record<string, unknown>
                  : {}),
                attemptedAt: new Date().toISOString(),
                error: message,
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", image.id)
          .eq("structure_id", id);
        results.push({ id: image.id, ok: false, status: "blocked", error: message });
      }
    }

    await rebuildStructureImageOrder(admin, id);

    const [{ count: remaining }, { count: review }] = await Promise.all([
      admin
        .from("structure_images")
        .select("id", { count: "exact", head: true })
        .eq("structure_id", id)
        .eq("placement_status", "unplaced"),
      admin
        .from("structure_images")
        .select("id", { count: "exact", head: true })
        .eq("structure_id", id)
        .in("placement_status", ["blocked", "needs_review"]),
    ]);

    const placedCount = results.filter((item) => item.ok && item.status === "placed").length;
    await admin.from("structures").update({
      status: (remaining ?? 0) > 0 ? "spatializing" : (review ?? 0) > 0 ? "review" : "ready",
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("owner_id", user.id);

    return NextResponse.json({
      processed: results.length,
      placed: placedCount,
      review: review ?? 0,
      remaining: remaining ?? 0,
      results,
    });
  } catch (error) {
    return responseError(error);
  }
}
