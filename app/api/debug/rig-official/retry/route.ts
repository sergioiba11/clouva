import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRiggingTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_EMAIL = (process.env.CLOUVA_OWNER_EMAIL || "esian0116@gmail.com").trim().toLowerCase();
const RIG_JOB_KEY = "official_avatar_rig_job";

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
      .select("id, role, avatar_3d_url")
      .eq("id", userId)
      .single();
    if (profileError || !profile) throw new Error("Perfil no encontrado");

    const email = (sessionData.user.email || "").trim().toLowerCase();
    const role = String(profile.role || "").trim().toLowerCase();
    const allowed = email === OWNER_EMAIL || role === "admin" || role === "owner" || role === "super_admin";
    if (!allowed) throw new Error("Solo el propietario puede hacer esto");
    if (!profile.avatar_3d_url) throw new Error("No hay avatar oficial activo");

    const { data: freshUserData, error: freshUserError } = await supabase.auth.admin.getUserById(userId);
    if (freshUserError || !freshUserData.user) throw new Error("No se pudo leer el estado del usuario");

    const metadata = { ...(freshUserData.user.app_metadata ?? {}) } as Record<string, unknown>;
    delete metadata[RIG_JOB_KEY];
    const { error: clearError } = await supabase.auth.admin.updateUserById(userId, { app_metadata: metadata });
    if (clearError) throw clearError;

    const taskId = await createRiggingTask(profile.avatar_3d_url, 1.8);
    const startedAt = Date.now();

    const nextMetadata = { ...metadata, [RIG_JOB_KEY]: { taskId, startedAt } };
    const { error: saveError } = await supabase.auth.admin.updateUserById(userId, { app_metadata: nextMetadata });
    if (saveError) throw saveError;

    return NextResponse.json({ taskId, startedAt, forced: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message.includes("Missing access") || message.includes("Invalid session") ? 401 : message.includes("Solo el propietario") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
