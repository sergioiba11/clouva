import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isTriptychAvatarMetadata } from "@/lib/avatar-generation-server";
import { getMultiImageTask, getTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getOwnedAvatarTask(request: NextRequest, taskId: string) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return { error: NextResponse.json({ error: "Missing access token" }, { status: 401 }) };

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return { error: NextResponse.json({ error: "Invalid session" }, { status: 401 }) };
  }

  const { data: avatar, error: avatarError } = await supabase
    .from("user_avatars")
    .select("id,metadata")
    .eq("user_id", userData.user.id)
    .eq("meshy_task_id", taskId)
    .maybeSingle();
  if (avatarError) throw avatarError;
  if (!avatar || !isTriptychAvatarMetadata(avatar.metadata)) {
    return { error: NextResponse.json({ error: "Avatar task not found" }, { status: 404 }) };
  }

  return { avatar };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");
  const kind = searchParams.get("kind");
  if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });

  try {
    if (kind === "avatar-multi-image") {
      const ownership = await getOwnedAvatarTask(request, taskId);
      if (ownership.error) return ownership.error;
      return NextResponse.json(await getMultiImageTask(taskId));
    }

    const task = kind === "multi-image" ? await getMultiImageTask(taskId) : await getTask(taskId);
    return NextResponse.json(task);
  } catch (error) {
    console.error("Meshy status lookup failed", { kind, error });
    const message = kind === "avatar-multi-image"
      ? "No se pudo consultar el estado del personaje"
      : error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
