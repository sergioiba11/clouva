import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MODES = new Set([
  "explore",
  "player",
  "services",
  "studio_owner",
  "studio_manager",
  "seller",
  "gamer",
]);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("profile_modes")
      .select("mode,status,activated_at,metadata")
      .eq("user_id", user.id)
      .order("activated_at");
    if (error) throw new Error(error.message);
    return NextResponse.json({ modes: data ?? [] });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus modos." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { mode?: unknown; metadata?: unknown };
    const mode = typeof body.mode === "string" ? body.mode : "";
    if (!ALLOWED_MODES.has(mode)) return NextResponse.json({ error: "Ese modo no es válido." }, { status: 400 });

    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    const admin = createAdminSupabase();
    const { error } = await admin.from("profile_modes").upsert(
      {
        user_id: user.id,
        mode,
        status: "active",
        activated_at: new Date().toISOString(),
        metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,mode" },
    );
    if (error) throw new Error(error.message);

    if (mode === "explore") {
      const { error: profileError } = await admin
        .from("profiles")
        .update({ onboarding_status: "exploring", onboarding_completed_at: new Date().toISOString() })
        .eq("id", user.id);
      if (profileError) throw new Error(profileError.message);
    }

    return NextResponse.json({ mode, active: true });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo activar este modo." }, { status });
  }
}
