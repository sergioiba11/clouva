import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure, placeStructureImage, rebuildStructureImageOrder } from "@/lib/structures/server";
import type { StructureImageRecord } from "@/lib/structures/spatial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string; imageId: string }> };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo ubicar la cámara.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id, imageId } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);

    const { data, error } = await admin
      .from("structure_images")
      .select("*")
      .eq("id", imageId)
      .eq("structure_id", id)
      .maybeSingle();
    if (error || !data) throw new Error("Referencia no encontrada.");

    const result = await placeStructureImage({
      admin,
      userId: user.id,
      structure,
      image: data as unknown as StructureImageRecord,
      allowCloud: true,
    });

    await rebuildStructureImageOrder(admin, id);
    const { data: node } = await admin
      .from("structure_camera_nodes")
      .select("*")
      .eq("image_id", imageId)
      .eq("structure_id", id)
      .maybeSingle();

    return NextResponse.json({
      image: result.image,
      cameraNode: node,
      usedCloud: result.usedCloud,
      needsReview: result.needsReview,
    });
  } catch (error) {
    return responseError(error);
  }
}
