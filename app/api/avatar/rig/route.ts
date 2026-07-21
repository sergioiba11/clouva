import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRiggingTask, getRiggingTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_KEY = "clouva_avatar_complete_rig_job";
const PROFILE_KEY = "clouva_avatar_complete_rig_profile";
const COMPLETE_FILENAME = "clouva-complete-rigged.glb";
const MAX_JOB_AGE_MS = 30 * 60 * 1000;
const ACTIVE_TASK_STATES = new Set(["PENDING", "IN_PROGRESS"]);
const FAILED_TASK_STATES = new Set(["FAILED", "EXPIRED", "CANCELED"]);

type RigJob = {
  taskId: string;
  startedAt: number;
  sourceAvatarId: string | null;
  sourceAvatarUrl: string;
};

type RigSource = {
  avatarId: string | null;
  url: string;
  source: "user_avatars" | "profiles";
};

type RigProfile = {
  complete?: boolean;
  boneCount?: number;
  addedBones?: string[];
  fingers?: {
    complete?: boolean;
    leftChains?: number;
    rightChains?: number;
    weightedVertices?: number;
  };
  ears?: {
    complete?: boolean;
    left?: boolean;
    right?: boolean;
    weightedVertices?: number;
  };
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Sesión requerida");

  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida");
  return { supabase, user: data.user };
}

async function resolveSource(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<RigSource> {
  const { data: active, error } = await supabase
    .from("user_avatars")
    .select("id,model_url,processed_glb_url,rigged_url,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const activeUrl = typeof active?.processed_glb_url === "string" && active.processed_glb_url
    ? active.processed_glb_url
    : typeof active?.rigged_url === "string" && active.rigged_url
      ? active.rigged_url
      : typeof active?.model_url === "string" && active.model_url
        ? active.model_url
        : null;
  if (active?.id && activeUrl) {
    return { avatarId: String(active.id), url: activeUrl, source: "user_avatars" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (typeof profile?.avatar_3d_url === "string" && profile.avatar_3d_url) {
    return { avatarId: null, url: profile.avatar_3d_url, source: "profiles" };
  }
  throw new Error("No hay un avatar activo para riggear");
}

function readJob(metadata: Record<string, unknown> | null | undefined): RigJob | null {
  const raw = metadata?.[JOB_KEY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.taskId !== "string" || typeof value.startedAt !== "number" || typeof value.sourceAvatarUrl !== "string") {
    return null;
  }
  return {
    taskId: value.taskId,
    startedAt: value.startedAt,
    sourceAvatarId: typeof value.sourceAvatarId === "string" ? value.sourceAvatarId : null,
    sourceAvatarUrl: value.sourceAvatarUrl,
  };
}

function readProfile(metadata: Record<string, unknown> | null | undefined): RigProfile | null {
  const raw = metadata?.[PROFILE_KEY];
  return raw && typeof raw === "object" ? raw as RigProfile : null;
}

async function updateMetadata(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  patch: { job?: RigJob | null; profile?: RigProfile | null },
) {
  const current = await supabase.auth.admin.getUserById(userId);
  if (current.error || !current.data.user) throw current.error || new Error("Usuario no encontrado");
  const metadata = { ...(current.data.user.app_metadata ?? {}) } as Record<string, unknown>;
  if ("job" in patch) {
    if (patch.job) metadata[JOB_KEY] = patch.job;
    else delete metadata[JOB_KEY];
  }
  if ("profile" in patch) {
    if (patch.profile) metadata[PROFILE_KEY] = patch.profile;
    else delete metadata[PROFILE_KEY];
  }
  const { error } = await supabase.auth.admin.updateUserById(userId, { app_metadata: metadata });
  if (error) throw error;
}

function jobMatches(job: RigJob, source: RigSource) {
  if (job.sourceAvatarId && source.avatarId) return job.sourceAvatarId === source.avatarId;
  return job.sourceAvatarUrl === source.url;
}

function parseRigProfile(response: Response): RigProfile {
  const raw = response.headers.get("x-clouva-rig-profile");
  if (!raw) throw new Error("El Blender Worker no devolvió la validación de dedos y orejas");
  try {
    return JSON.parse(raw) as RigProfile;
  } catch {
    throw new Error("La validación del rig completo devuelta por Blender es inválida");
  }
}

async function completeRigWithWorker(sourceUrl: string) {
  const workerBaseUrl = (process.env.BLENDER_WORKER_URL || process.env.GARMENT_RIG_WORKER_URL)?.replace(/\/+$/, "");
  const workerToken = process.env.BLENDER_WORKER_TOKEN || process.env.GARMENT_RIG_WORKER_TOKEN;
  if (!workerBaseUrl) throw new Error("Falta configurar BLENDER_WORKER_URL");

  const response = await fetch(`${workerBaseUrl}/avatar/complete-rig`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
    },
    body: JSON.stringify({
      source_url: sourceUrl,
      require_fingers: true,
      require_ears: true,
      finger_segments: 3,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Blender no pudo completar el rig (${response.status})${detail ? `: ${detail.slice(0, 1000)}` : ""}`);
  }

  const profile = parseRigProfile(response);
  if (profile.complete !== true || profile.fingers?.complete !== true || profile.ears?.complete !== true) {
    throw new Error("El avatar no superó la validación de dedos y orejas");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1024 || Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Blender no devolvió un GLB completo válido");
  }
  return { bytes, profile };
}

async function persistRiggedAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  avatarId: string | null,
  bytes: ArrayBuffer,
) {
  const storagePath = `${userId}/${avatarId || "official"}/${COMPLETE_FILENAME}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const publicUrl = `${publicData.publicUrl}?v=${Date.now()}`;
  const now = new Date().toISOString();

  if (avatarId) {
    const { error: avatarError } = await supabase
      .from("user_avatars")
      .update({
        model_url: publicUrl,
        status: "ready",
        is_active: true,
        updated_at: now,
      })
      .eq("id", avatarId)
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
    const { supabase, user } = await requireUser(request);
    const body = await request.json();
    const action = String(body?.action ?? "");
    const force = Boolean(body?.force);
    const source = await resolveSource(supabase, user.id);
    const freshUser = await supabase.auth.admin.getUserById(user.id);
    if (freshUser.error || !freshUser.data.user) throw freshUser.error || new Error("Usuario no encontrado");
    const metadata = freshUser.data.user.app_metadata as Record<string, unknown> | undefined;
    const storedJob = readJob(metadata);
    const storedProfile = readProfile(metadata);
    const alreadyRigged = source.url.includes(COMPLETE_FILENAME);

    if (action === "create") {
      if (alreadyRigged && !force) {
        await updateMetadata(supabase, user.id, { job: null });
        return NextResponse.json({
          alreadyRigged: true,
          status: "SUCCEEDED",
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile ?? { complete: true },
        });
      }

      if (storedJob && jobMatches(storedJob, source)) {
        const existingTask = await getRiggingTask(storedJob.taskId);
        const ageMs = Date.now() - storedJob.startedAt;
        if (!force && ACTIVE_TASK_STATES.has(existingTask.status) && ageMs < MAX_JOB_AGE_MS) {
          return NextResponse.json({ ...storedJob, status: existingTask.status, progress: existingTask.progress, resumed: true });
        }
        if (!force && existingTask.status === "SUCCEEDED") {
          return NextResponse.json({ ...storedJob, status: "SUCCEEDED", progress: 99, resumed: true });
        }
      }

      const taskId = await createRiggingTask(source.url, 1.8);
      const job: RigJob = {
        taskId,
        startedAt: Date.now(),
        sourceAvatarId: source.avatarId,
        sourceAvatarUrl: source.url,
      };
      await updateMetadata(supabase, user.id, { job, profile: null });
      return NextResponse.json({ ...job, status: "PENDING", source: source.source });
    }

    if (action === "current") {
      if (alreadyRigged) {
        return NextResponse.json({
          active: false,
          alreadyRigged: true,
          status: "SUCCEEDED",
          newAvatarUrl: source.url,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile ?? { complete: true },
        });
      }
      if (!storedJob || !jobMatches(storedJob, source)) {
        return NextResponse.json({ active: false, status: "NOT_STARTED", sourceAvatarId: source.avatarId });
      }
      const task = await getRiggingTask(storedJob.taskId);
      return NextResponse.json({ active: ACTIVE_TASK_STATES.has(task.status), ...storedJob, ...task });
    }

    if (action === "status") {
      const taskId = String(body?.taskId ?? storedJob?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });
      const task = await getRiggingTask(taskId);
      return NextResponse.json({ ...task, taskId });
    }

    if (action === "finalize") {
      const taskId = String(body?.taskId ?? storedJob?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });
      const task = await getRiggingTask(taskId);
      if (FAILED_TASK_STATES.has(task.status)) {
        await updateMetadata(supabase, user.id, { job: null });
        return NextResponse.json({ error: task.task_error?.message || "El rigeador no pudo completar el avatar", task }, { status: 422 });
      }
      const riggedUrl = task.result?.rigged_character_glb_url;
      if (task.status !== "SUCCEEDED" || !riggedUrl) {
        return NextResponse.json({ error: "El rig base todavía no terminó", task }, { status: 409 });
      }

      const completed = await completeRigWithWorker(riggedUrl);
      const publicUrl = await persistRiggedAvatar(
        supabase,
        user.id,
        storedJob?.sourceAvatarId ?? source.avatarId,
        completed.bytes,
      );
      await updateMetadata(supabase, user.id, { job: null, profile: completed.profile });
      return NextResponse.json({
        ok: true,
        status: "SUCCEEDED",
        newAvatarUrl: publicUrl,
        sourceAvatarId: storedJob?.sourceAvatarId ?? source.avatarId,
        rigProfile: completed.profile,
      });
    }

    if (action === "clear") {
      await updateMetadata(supabase, user.id, { job: null });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (cause) {
    console.error("Complete avatar rig failed", cause);
    const message = cause instanceof Error ? cause.message : "No se pudo completar el rig del avatar";
    const status = /sesión/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
