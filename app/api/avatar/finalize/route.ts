import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  AvatarGenerationError,
  finalizePendingAvatarGeneration,
} from "@/lib/avatar-generation-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const body = await request.json();
    if (typeof body?.modelUrl === "string" && body.modelUrl) {
      return NextResponse.json({ error: "No se aceptan URLs de modelos enviadas por el navegador" }, { status: 400 });
    }

    const meshyTaskId = typeof body?.meshyTaskId === "string" ? body.meshyTaskId.trim() : "";
    if (!meshyTaskId) return NextResponse.json({ error: "Missing meshyTaskId" }, { status: 400 });

    const avatar = await finalizePendingAvatarGeneration(supabase, userData.user.id, meshyTaskId);
    return NextResponse.json({ ok: true, avatar });
  } catch (error) {
    console.error("Generated avatar finalization failed", error);
    const status = error instanceof AvatarGenerationError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown avatar finalization error" },
      { status },
    );
  }
}
