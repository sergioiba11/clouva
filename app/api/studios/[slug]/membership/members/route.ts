import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only roster for the studio's own panel: who joined, free or paid,
// and since when. Separate from studio_members (staff) on purpose -- this
// is studio_fan_memberships, the socios/fans this feature is about.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });

    const { data, error } = await admin
      .from("studio_fan_memberships")
      .select("id,status,source,joined_at,plan:studio_membership_plans(name,is_free,price,currency),profile:profiles(full_name,username,email)")
      .eq("studio_id", studioId)
      .order("joined_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    return NextResponse.json({ members: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron cargar los socios.";
    return NextResponse.json({ error: message }, { status });
  }
}
