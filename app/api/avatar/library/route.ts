import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return null;
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

export async function GET(request: NextRequest) {
  const auth = await getUser(request);
  if (!auth) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data, error } = await auth.supabase
    .from("user_avatars")
    .select("id,name,status,model_url,preview_image_url,meshy_task_id,is_active,front_rotation_y,created_at,updated_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ avatars: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await getUser(request);
  if (!auth) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const body = await request.json();
  const avatarId = typeof body?.avatarId === "string" ? body.avatarId : "";
  if (!avatarId) return NextResponse.json({ error: "Missing avatarId" }, { status: 400 });

  const { data: avatar, error: avatarError } = await auth.supabase
    .from("user_avatars")
    .select("id,model_url,status")
    .eq("id", avatarId)
    .eq("user_id", auth.user.id)
    .single();

  if (avatarError || !avatar) return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
  if (avatar.status !== "ready" || !avatar.model_url) {
    return NextResponse.json({ error: "Avatar is not ready" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: deactivateError } = await auth.supabase
    .from("user_avatars")
    .update({ is_active: false, updated_at: now })
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  if (deactivateError) return NextResponse.json({ error: deactivateError.message }, { status: 500 });

  const { data: active, error: activateError } = await auth.supabase
    .from("user_avatars")
    .update({ is_active: true, updated_at: now })
    .eq("id", avatarId)
    .eq("user_id", auth.user.id)
    .select("id,name,status,model_url,preview_image_url,is_active,front_rotation_y,updated_at")
    .single();
  if (activateError) return NextResponse.json({ error: activateError.message }, { status: 500 });

  await auth.supabase.from("profiles").update({ avatar_3d_url: active.model_url }).eq("id", auth.user.id);

  return NextResponse.json({ avatar: active });
}
