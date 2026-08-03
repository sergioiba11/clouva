import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public/commercial memberships are intentionally separate from studio_members,
// which remains the private staff/permission roster.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireStudioManager({ admin, userId: user.id, studioId });

    const { data, error } = await admin
      .from("studio_memberships")
      .select("id,user_id,player_id,status,source,public_role_label,area_label,joined_at,plan:studio_membership_plans(name,is_free,price,currency)")
      .eq("studio_id", studioId)
      .order("joined_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
    const { data: profiles, error: profilesError } = userIds.length
      ? await admin.from("profiles").select("id,full_name,username,email").in("id", userIds)
      : { data: [] as { id: string; full_name: string | null; username: string | null; email: string | null }[], error: null };
    if (profilesError) throw new Error(profilesError.message);
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    const members = (data ?? []).map((row) => ({ ...row, profile: profileById.get(row.user_id) ?? null }));
    return NextResponse.json({ members });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron cargar los miembros.";
    return NextResponse.json({ error: message }, { status });
  }
}
