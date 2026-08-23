import { NextRequest, NextResponse } from "next/server";
import { getClouvaQr, getOrCreateClouvaQr, serializeClouvaQr } from "@/lib/server/clouva-qr";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as { userId?: string };
    if (!body.userId) return NextResponse.json({ error: "Elegí un usuario." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id,owner_user_id,slug,username,display_name,profile_image_url,is_published,publication_status,privacy_status")
      .eq("owner_user_id", body.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (playerError) throw new Error(playerError.message);
    if (!player) return NextResponse.json({ error: "Ese usuario todavía no tiene un Player asociado." }, { status: 404 });

    const existing = await getClouvaQr({ admin, entityType: "USER", entityId: body.userId });
    const result = existing
      ? { qr: existing, created: false }
      : await getOrCreateClouvaQr({
          admin,
          entityType: "USER",
          entityId: body.userId,
          actorId: user.id,
          metadata: { player_id: player.id, generated_from_spot_id: spot.id },
        });

    return NextResponse.json({
      player: {
        id: player.id,
        slug: player.slug,
        username: player.username,
        displayName: player.display_name,
        avatarUrl: player.profile_image_url,
        public: player.is_published === true && player.publication_status === "published" && player.privacy_status !== "private",
      },
      qr: serializeClouvaQr(result.qr, result.created),
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar el QR del usuario." }, { status });
  }
}
