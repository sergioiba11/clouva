import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    await requireManagedSpot({ admin, userId: user.id, studioId });

    const q = (request.nextUrl.searchParams.get("q") || "").trim();
    if (q.length < 2) return NextResponse.json({ users: [] });
    const safe = q.replace(/[,%()]/g, " ").trim();
    if (!safe) return NextResponse.json({ users: [] });

    const { data, error } = await admin
      .from("players")
      .select("id,owner_user_id,slug,username,display_name,profile_image_url,privacy_status,is_published,publication_status")
      .not("owner_user_id", "is", null)
      .or(`display_name.ilike.%${safe}%,username.ilike.%${safe}%,slug.ilike.%${safe}%`)
      .order("display_name")
      .limit(12);
    if (error) throw new Error(error.message);

    return NextResponse.json({
      users: (data ?? []).map((player) => ({
        userId: player.owner_user_id,
        playerId: player.id,
        slug: player.slug,
        username: player.username,
        displayName: player.display_name,
        avatarUrl: player.profile_image_url,
        public: player.is_published === true && player.publication_status === "published" && player.privacy_status !== "private",
      })),
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron buscar usuarios." }, { status });
  }
}
