import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRiggingTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_EMAIL = (process.env.CLOUVA_OWNER_EMAIL || "esian0116@gmail.com").trim().toLowerCase();
const RIG_JOB_KEY = "official_avatar_rig_job";
const RIGGED_FILENAME = "clouva-official-rigged.glb";

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
    if (!accessToken) throw new Error("Missing access token");

    const supabase = getAdminClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getUser(accessToken);
    if (sessionError || !sessionData.user) throw new Error("Invalid session");

    const userId = sessionData.user.id;
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .single();
    if (profileError || !profile) throw new Error("Perfil no encontrado");

    const email = (sessionData.user.email || "").trim().toLowerCase();
    const role = String(profile.role || "").trim().toLowerCase();
    const allowed = email === OWNER_EMAIL || role === "admin" || role === "owner" || role === "super_admin";
    if (!allowed) throw new Error("Solo el propietario puede hacer esto");

    const body = await request.json();
    const taskId = String(body?.taskId || "");
    if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });

    const task = await getRiggingTask(taskId);
    const riggedGlbUrl = task.result?.rigged_character_glb_url;
    if (task.status !== "SUCCEEDED" || !riggedGlbUrl) {
      return NextResponse.json({ error: "Rigging todavía no terminó", task }, { status: 409 });
    }

    const remote = await fetch(riggedGlbUrl, { cache: "no-store" });
    if (!remote.ok) throw new Error(`No se pudo descargar el GLB riggeado (${remote.status})`);
    const bytes = await remote.arrayBuffer();
    if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
      throw new Error("Meshy no devolvió un GLB válido");
    }

    const storagePath = `${userId}/official/${RIGGED_FILENAME}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_3d_url: publicData.publicUrl })
      .eq("id", userId);
    if (updateError) throw updateError;

    const { data: freshUser } = await supabase.auth.admin.getUserById(userId);
    const metadata = { ...(freshUser.user?.app_metadata ?? {}) } as Record<string, unknown>;
    delete metadata[RIG_JOB_KEY];
    const { error: metadataError } = await supabase.auth.admin.updateUserById(userId, { app_metadata: metadata });
    if (metadataError) throw metadataError;

    return NextResponse.json({ ok: true, status: "SUCCEEDED", newAvatarUrl: publicData.publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message.includes("Missing access") || message.includes("Invalid session") ? 401 : message.includes("Solo el propietario") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
