import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRiggingTask, getRiggingTask } from "@/lib/meshy";

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

async function requireOwner(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Missing access token");

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error("Invalid session");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, avatar_3d_url")
    .eq("id", userData.user.id)
    .single();
  if (profileError || !profile) throw new Error("Perfil no encontrado");

  const email = (userData.user.email || "").trim().toLowerCase();
  const role = String(profile.role || "").trim().toLowerCase();
  const allowed = email === OWNER_EMAIL || role === "admin" || role === "owner" || role === "super_admin";
  if (!allowed) throw new Error("Solo el propietario puede hacer esto");

  return { supabase, profile, user: userData.user };
}

async function saveRigJob(supabase: ReturnType<typeof getAdminClient>, userId: string, job: Record<string, unknown> | null) {
  const { data } = await supabase.auth.admin.getUserById(userId);
  const current = data.user?.app_metadata ?? {};
  const next = { ...current } as Record<string, unknown>;
  if (job) next[RIG_JOB_KEY] = job;
  else delete next[RIG_JOB_KEY];
  const { error } = await supabase.auth.admin.updateUserById(userId, { app_metadata: next });
  if (error) throw error;
}

function readRigJob(user: { app_metadata?: Record<string, unknown> | null }) {
  const raw = user.app_metadata?.[RIG_JOB_KEY];
  if (!raw || typeof raw !== "object") return null;
  const job = raw as { taskId?: unknown; startedAt?: unknown };
  if (typeof job.taskId !== "string" || typeof job.startedAt !== "number") return null;
  return { taskId: job.taskId, startedAt: job.startedAt };
}

function taskErrorMessage(task: { task_error?: { message?: string }; error?: string }) {
  return task.task_error?.message || task.error || "Meshy no pudo riggear el avatar";
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, profile, user } = await requireOwner(request);
    const body = await request.json();
    const action = String(body?.action ?? "");
    const alreadyRigged = Boolean(profile.avatar_3d_url?.includes(RIGGED_FILENAME));

    if (action === "create") {
      if (!profile.avatar_3d_url) throw new Error("No hay avatar oficial activo");
      if (alreadyRigged) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({ alreadyRigged: true, newAvatarUrl: profile.avatar_3d_url });
      }

      const existing = readRigJob(user);
      if (existing) {
        const existingTask = await getRiggingTask(existing.taskId);
        if (existingTask.status !== "FAILED" && existingTask.status !== "EXPIRED") {
          return NextResponse.json({ taskId: existing.taskId, startedAt: existing.startedAt, resumed: true });
        }
      }

      const taskId = await createRiggingTask(profile.avatar_3d_url, 1.8);
      const startedAt = Date.now();
      await saveRigJob(supabase, profile.id, { taskId, startedAt });
      return NextResponse.json({ taskId, startedAt, sourceUrl: profile.avatar_3d_url });
    }

    if (action === "current") {
      if (alreadyRigged) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({
          active: false,
          alreadyRigged: true,
          status: "SUCCEEDED",
          newAvatarUrl: profile.avatar_3d_url,
        });
      }

      const job = readRigJob(user);
      if (!job) return NextResponse.json({ active: false, status: "NOT_STARTED" });
      const task = await getRiggingTask(job.taskId);

      if (task.status === "FAILED" || task.status === "EXPIRED") {
        return NextResponse.json({
          active: false,
          status: task.status,
          taskId: job.taskId,
          startedAt: job.startedAt,
          error: taskErrorMessage(task),
          task,
        });
      }

      return NextResponse.json({ active: true, taskId: job.taskId, startedAt: job.startedAt, task });
    }

    if (action === "status") {
      const stored = readRigJob(user);
      const taskId = String(body?.taskId ?? stored?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });
      const task = await getRiggingTask(taskId);
      return NextResponse.json({ ...task, taskId, startedAt: stored?.startedAt ?? null });
    }

    if (action === "finalize") {
      const stored = readRigJob(user);
      const taskId = String(body?.taskId ?? stored?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });

      const task = await getRiggingTask(taskId);
      if (task.status !== "SUCCEEDED" || !task.model_urls?.glb) {
        return NextResponse.json({ error: "Rigging todavía no terminó", task }, { status: 409 });
      }

      const remote = await fetch(task.model_urls.glb, { cache: "no-store" });
      if (!remote.ok) throw new Error(`No se pudo descargar el GLB riggeado (${remote.status})`);
      const bytes = await remote.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
        throw new Error("Meshy no devolvió un GLB válido");
      }

      const storagePath = `${profile.id}/official/${RIGGED_FILENAME}`;
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
        .eq("id", profile.id);
      if (updateError) throw updateError;

      await saveRigJob(supabase, profile.id, null);
      return NextResponse.json({ ok: true, status: "SUCCEEDED", completedAt: Date.now(), newAvatarUrl: publicData.publicUrl });
    }

    if (action === "clear") {
      await saveRigJob(supabase, profile.id, null);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message.includes("Missing access") || message.includes("Invalid session") ? 401 : message.includes("Solo el propietario") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
