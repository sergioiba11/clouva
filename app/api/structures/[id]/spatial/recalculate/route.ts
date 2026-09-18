import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { recalculateStructureSpatialWorld } from "@/lib/structures/georeferencing-server";
import { getOwnedStructure } from "@/lib/structures/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const structure = await getOwnedStructure(admin, user.id, id);
    const result = await recalculateStructureSpatialWorld(admin, structure);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo recalcular la escena.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
  }
}
