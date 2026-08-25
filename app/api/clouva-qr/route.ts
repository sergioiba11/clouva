import { NextRequest, NextResponse } from "next/server";
import { getClouvaQr, getOrCreateClouvaQr, serializeClouvaQr } from "@/lib/server/clouva-qr";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

async function loadPlayer(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data, error } = await admin
    .from("players")
    .select("id,owner_user_id,slug,username,display_name,profile_image_url,is_published,publication_status,privacy_status")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await loadPlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "Tu cuenta todavía no tiene un Player asociado." }, { status: 404 });
    const qr = await getClouvaQr({ admin, entityType: "USER", entityId: user.id });
    return NextResponse.json({
      player,
      qr: qr ? serializeClouvaQr(qr, false) : null,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar tu QR." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await loadPlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "Tu cuenta todavía no tiene un Player asociado." }, { status: 404 });

    const existing = await getClouvaQr({ admin, entityType: "USER", entityId: user.id });
    const result = existing
      ? { qr: existing, created: false }
      : await getOrCreateClouvaQr({
          admin,
          entityType: "USER",
          entityId: user.id,
          actorId: user.id,
          metadata: { player_id: player.id },
        });

    return NextResponse.json({
      player,
      qr: serializeClouvaQr(result.qr, result.created),
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar tu QR." }, { status });
  }
}
