import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function officialFallbackUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return url ? `${url}/storage/v1/object/public/avatars/official/clouva-official-v1.glb` : "/models/clouva/clouva-official-v1.glb";
}

export async function GET() {
  try {
    const supabase = getAdminClient();

    const { data: admins, error: adminError } = await supabase
      .from("profiles")
      .select("id,avatar_3d_url,updated_at")
      .eq("role", "admin")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (adminError) throw adminError;

    const directProfileAvatar = admins?.find((profile) => profile.avatar_3d_url)?.avatar_3d_url;
    if (directProfileAvatar) {
      return NextResponse.json(
        { modelUrl: directProfileAvatar, source: "admin-profile" },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const adminIds = (admins ?? []).map((profile) => profile.id).filter(Boolean);
    if (adminIds.length) {
      const { data: activeAvatar, error: activeError } = await supabase
        .from("user_avatars")
        .select("id,model_url,updated_at")
        .in("user_id", adminIds)
        .eq("status", "ready")
        .not("model_url", "is", null)
        .order("is_active", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeError) throw activeError;
      if (activeAvatar?.model_url) {
        return NextResponse.json(
          { modelUrl: activeAvatar.model_url, source: "admin-avatar", avatarId: activeAvatar.id },
          { headers: { "Cache-Control": "no-store, max-age=0" } },
        );
      }
    }

    return NextResponse.json(
      { modelUrl: `${officialFallbackUrl()}?v=${Date.now()}`, source: "official-fallback" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Could not resolve CLOUVA admin avatar", error);
    return NextResponse.json(
      { modelUrl: `${officialFallbackUrl()}?v=${Date.now()}`, source: "official-fallback" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
