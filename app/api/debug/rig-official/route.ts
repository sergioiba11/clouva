import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRiggingTask, getRiggingTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_EMAIL = (process.env.CLOUVA_OWNER_EMAIL || "esian0116@gmail.com").trim().toLowerCase();
const RIG_JOB_KEY = "official_avatar_rig_job";
const RIGGED_FILENAME = "clouva-official-rigged.glb";
const MAX_RIG_JOB_AGE_MS = 30 * 60 * 1000;
const FAILED_TASK_STATES = new Set(["FAILED", "EXPIRED", "CANCELED"]);
const ACTIVE_TASK_STATES = new Set(["PENDING", "IN_PROGRESS"]);

type RigJob = {
  taskId: string;
  startedAt: number;
  sourceAvatarId: string | null;
  sourceAvatarUrl: string | null;
};

type RigSource = {
  avatarId: string | null;
  url: string | null;
  source: "user_avatars" | "profile" | "none";
};

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

async function resolveRigSource(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  profileUrl: string | null | undefined,
): Promise<RigSource> {
  const { data: active, error } = await supabase
    .from("user_avatars")
    .select("id, model_url, status, updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .not("model_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (active?.model_url) {
    return { avatarId: String(active.id), url: String(active.model_url), source: "user_avatars" };
  }
  if (profileUrl) return { avatarId: null, url: profileUrl, source: "profile" };
  return { avatarId: null, url: null, source: "none" };
}

async function saveRigJob(supabase: ReturnType<typeof getAdminClient>, userId: string, job: RigJob | null) {
  const { data } = await supabase.auth.admin.getUserById(userId);
  const current = data.user?.app_metadata ?? {};
  const next = { ...current } as Record<string, unknown>;
  if (job) next[RIG_JOB_KEY] = job;
  else delete next[RIG_JOB_KEY];
  const { error } = await supabase.auth.admin.updateUserById(userId, { app_metadata: next });
  if (error) throw error;
}

function readRigJob(user: { app_metadata?: Record<string, unknown> | null }): RigJob | null {
  const raw = user.app_metadata?.[RIG_JOB_KEY];
  if (!raw || typeof raw !== "object") return null;
  const job = raw as Record<string, unknown>;
  if (typeof job.taskId !== "string" || typeof job.startedAt !== "number") return null;
  return {
    taskId: job.taskId,
    startedAt: job.startedAt,
    sourceAvatarId: typeof job.sourceAvatarId === "string" ? job.sourceAvatarId : null,
    sourceAvatarUrl: typeof job.sourceAvatarUrl === "string" ? job.sourceAvatarUrl : null,
  };
}

function jobMatchesSource(job: RigJob, source: RigSource) {
  if (job.sourceAvatarId && source.avatarId) return job.sourceAvatarId === source.avatarId;
  if (job.sourceAvatarUrl && source.url) return job.sourceAvatarUrl === source.url;
  return false;
}

function taskErrorMessage(task: { task_error?: { message?: string }; error?: string }) {
  return task.task_error?.message || task.error || "Meshy no pudo riggear el avatar";
}

async function persistRiggedAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  sourceAvatarId: string | null,
  bytes: ArrayBuffer,
) {
  const storagePath = `${userId}/${sourceAvatarId || "official"}/${RIGGED_FILENAME}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;
  const now = new Date().toISOString();

  if (sourceAvatarId) {
    const { error: avatarError } = await supabase
      .from("user_avatars")
      .update({ model_url: publicUrl, status: "ready", is_active: true, updated_at: now })
      .eq("id", sourceAvatarId)
      .eq("user_id", userId);
    if (avatarError) throw avatarError;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_3d_url: publicUrl, updated_at: now })
    .eq("id", userId);
  if (profileError) throw profileError;

  return publicUrl;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, profile, user } = await requireOwner(request);
    const body = await request.json();
    const action = String(body?.action ?? "");
    const force = Boolean(body?.force);
    const source = await resolveRigSource(supabase, profile.id, profile.avatar_3d_url);
    const alreadyRigged = Boolean(source.url?.includes(RIGGED_FILENAME));

    if (action === "create") {
      if (!source.url) throw new Error("No hay un avatar activo para riggear");
      if (alreadyRigged && !force) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({
          alreadyRigged: true,
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          source: source.source,
        });
      }

      const existing = readRigJob(user);
      if (existing && !jobMatchesSource(existing, source)) {
        await saveRigJob(supabase, profile.id, null);
      } else if (existing) {
        const existingTask = await getRiggingTask(existing.taskId);
        const ageMs = Date.now() - existing.startedAt;

        if (existingTask.status === "SUCCEEDED") {
          const resumedAt = Date.now();
          const resumedJob = { ...existing, startedAt: resumedAt };
          await saveRigJob(supabase, profile.id, resumedJob);
          return NextResponse.json({ ...resumedJob, resumed: true, completed: true });
        }

        if (!force && ACTIVE_TASK_STATES.has(existingTask.status) && ageMs < MAX_RIG_JOB_AGE_MS) {
          return NextResponse.json({ ...existing, resumed: true });
        }

        await saveRigJob(supabase, profile.id, null);
      }

      const taskId = await createRiggingTask(source.url, 1.8);
      const job: RigJob = {
        taskId,
        startedAt: Date.now(),
        sourceAvatarId: source.avatarId,
        sourceAvatarUrl: source.url,
      };
      await saveRigJob(supabase, profile.id, job);
      return NextResponse.json({ ...job, source: source.source, forced: force });
    }

    if (action === "current") {
      const stored = readRigJob(user);
      if (stored && !jobMatchesSource(stored, source)) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({
          active: false,
          status: alreadyRigged ? "SUCCEEDED" : "NOT_STARTED",
          alreadyRigged,
          sourceChanged: true,
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          source: source.source,
        });
      }

      if (alreadyRigged) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({
          active: false,
          alreadyRigged: true,
          status: "SUCCEEDED",
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          source: source.source,
        });
      }

      if (!stored) {
        return NextResponse.json({
          active: false,
          status: "NOT_STARTED",
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          source: source.source,
        });
      }

      const task = await getRiggingTask(stored.taskId);
      if (task.status === "SUCCEEDED") {
        const resumedAt = Date.now() - stored.startedAt >= MAX_RIG_JOB_AGE_MS ? Date.now() : stored.startedAt;
        const resumedJob = { ...stored, startedAt: resumedAt };
        if (resumedAt !== stored.startedAt) await saveRigJob(supabase, profile.id, resumedJob);
        return NextResponse.json({
          active: true,
          ...resumedJob,
          task,
          newAvatarUrl: source.url,
          source: source.source,
        });
      }

      if (FAILED_TASK_STATES.has(task.status)) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({
          active: false,
          status: task.status,
          ...stored,
          error: taskErrorMessage(task),
          task,
          newAvatarUrl: source.url,
          source: source.source,
        });
      }

      if (Date.now() - stored.startedAt >= MAX_RIG_JOB_AGE_MS) {
        await saveRigJob(supabase, profile.id, null);
        return NextResponse.json({
          active: false,
          status: "NOT_STARTED",
          staleCleared: true,
          message: "Se descartó un proceso de rigging vencido. Ya podés generar uno nuevo.",
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          source: source.source,
        });
      }

      return NextResponse.json({
        active: true,
        ...stored,
        task,
        newAvatarUrl: source.url,
        source: source.source,
      });
    }

    if (action === "status") {
      const stored = readRigJob(user);
      const taskId = String(body?.taskId ?? stored?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });
      const task = await getRiggingTask(taskId);
      return NextResponse.json({
        ...task,
        taskId,
        startedAt: stored?.startedAt ?? null,
        sourceAvatarId: stored?.sourceAvatarId ?? null,
      });
    }

    if (action === "finalize") {
      const stored = readRigJob(user);
      const taskId = String(body?.taskId ?? stored?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });

      const task = await getRiggingTask(taskId);
      const riggedUrl = (task as any).result?.rigged_character_glb_url;
      if (task.status !== "SUCCEEDED" || !riggedUrl) {
        return NextResponse.json({ error: "Rigging todavía no terminó", task }, { status: 409 });
      }
      const remote = await fetch(riggedUrl, { cache: "no-store" });
      if (!remote.ok) throw new Error(`No se pudo descargar el GLB riggeado (${remote.status})`);
      const bytes = await remote.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
        throw new Error("Meshy no devolvió un GLB válido");
      }

      const publicUrl = await persistRiggedAvatar(
        supabase,
        profile.id,
        stored?.sourceAvatarId ?? source.avatarId,
        bytes,
      );
      await saveRigJob(supabase, profile.id, null);
      return NextResponse.json({
        ok: true,
        status: "SUCCEEDED",
        completedAt: Date.now(),
        newAvatarUrl: publicUrl,
        sourceAvatarId: stored?.sourceAvatarId ?? source.avatarId,
      });
    }

    if (action === "clear") {
      await saveRigJob(supabase, profile.id, null);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    const status = message.includes("Missing access") || message.includes("Invalid session")
      ? 401
      : message.includes("Solo el propietario")
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
