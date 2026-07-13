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
      .select("id,role,avatar_3d_url")
      .eq("role", "admin")
      .limit(20);

    if (adminError) throw adminError;

    const adminWithProfileAvatar = admins?.find((profile) => Boolean(profile.avatar_3d_url));
    if (adminWithProfileAvatar?.avatar_3d_url) {
      return NextResponse.json(
        {
          modelUrl: adminWithProfileAvatar.avatar_3d_url,
          source: "admin-profile",
          adminId: adminWithProfileAvatar.id,
        },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const adminIds = (admins ?? []).map((profile) => profile.id).filter(Boolean);
    if (adminIds.length) {
      const { data: avatars, error: avatarError } = await supabase
        .from("user_avatars")
        .select("id,user_id,model_url,is_active,status,updated_at")
        .in("user_id", adminIds)
        .eq("status", "ready")
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (avatarError) throw avatarError;

      const selected = avatars?.find((avatar) => avatar.is_active) ?? avatars?.[0];
      if (selected?.model_url) {
        return NextResponse.json(
          {
            modelUrl: selected.model_url,
            source: "admin-avatar",
            avatarId: selected.id,
            adminId: selected.user_id,
          },
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
      {
        modelUrl: `${officialFallbackUrl()}?v=${Date.now()}`,
        source: "official-fallback",
        error: error instanceof Error ? error.message : String(error),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
