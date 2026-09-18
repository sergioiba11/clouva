import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getOwnedStructure } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo cargar el espacio.";
  return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);

    const [cameraNodes, spatialFeatures] = await Promise.all([
      admin.from("structure_camera_nodes").select("*").eq("structure_id", id),
      admin.from("structure_spatial_features").select("*").eq("structure_id", id).order("updated_at", { ascending: true }),
    ]);
    if (cameraNodes.error || spatialFeatures.error) throw new Error("No se pudo cargar la base geográfica.");

    return NextResponse.json({
      structure,
      cameraNodes: cameraNodes.data ?? [],
      spatialFeatures: spatialFeatures.data ?? [],
    });
  } catch (error) {
    return responseError(error);
  }
}
