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
const DERIVED_RIG_PATTERN = /(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)/i;

type RigJob = {
  taskId: string;
  startedAt: number;
  sourceAvatarId: string | null;
  sourceAvatarUrl: string;
};

type RigSource = {
  avatarId: string | null;
  originalUrl: string;
  currentUrl: string;
  storagePath: string | null;
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

function asHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function looksDerivedRig(value: string | null) {
  return Boolean(value && DERIVED_RIG_PATTERN.test(value));
}

async function resolveStoredOriginalUrl(
  supabase: ReturnType<typeof getAdminClient>,
  storagePath: string,
) {
  const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(storagePath, 60 * 60);
  if (signed?.signedUrl) return signed.signedUrl;

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  return asHttpsUrl(publicData.publicUrl);
}

async function resolveSource(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<RigSource> {
  const { data: active, error } = await supabase
    .from("user_avatars")
    .select("id,model_url,processed_glb_url,rigged_url,storage_path,metadata,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  if (active?.id) {
    const currentUrl = asHttpsUrl(active.rigged_url)
      ?? asHttpsUrl(active.processed_glb_url)
      ?? asHttpsUrl(active.model_url);

    const storagePath = typeof active.storage_path === "string" && active.storage_path.trim()
      ? active.storage_path.trim()
      : null;
    const metadata = active.metadata && typeof active.metadata === "object"
      ? active.metadata as Record<string, unknown>
      : {};
    const storedOriginal = storagePath
      ? await resolveStoredOriginalUrl(supabase, storagePath)
      : null;
    const meshyOriginal = asHttpsUrl(metadata.original_meshy_url);
    const modelFallback = asHttpsUrl(active.model_url);
    const originalUrl = storedOriginal
      ?? meshyOriginal
      ?? (modelFallback && !looksDerivedRig(modelFallback) ? modelFallback : null);

    if (!currentUrl) throw new Error("El avatar activo no tiene un GLB disponible");
    if (!originalUrl) {
      throw new Error(
        "No encontramos el GLB original limpio del avatar. El rig viejo no se usará como fuente; restaurá el avatar original antes de reintentar.",
      );
    }

    return {
      avatarId: String(active.id),
      originalUrl,
      currentUrl,
      storagePath,
      source: "user_avatars",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const profileUrl = asHttpsUrl(profile?.avatar_3d_url);
  if (profileUrl && !looksDerivedRig(profileUrl)) {
    return {
      avatarId: null,
      originalUrl: profileUrl,
      currentUrl: profileUrl,
      storagePath: null,
      source: "profiles",
    };
  }

  throw new Error("No hay un avatar original limpio para riggear");
}

function readJob(metadata: Record<string, unknown> | null | undefined): RigJob | null {
  const raw = metadata?.[JOB_KEY];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.taskId !== "string"
    || typeof value.startedAt !== "number"
    || typeof value.sourceAvatarUrl !== "string"
  ) {
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
  return job.sourceAvatarUrl === source.originalUrl;
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

function workerErrorDetail(raw: string) {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.detail ?? parsed.error ?? parsed.message ?? parsed.technicalError;
    if (typeof value === "string") return value;
    return JSON.stringify(value ?? parsed);
  } catch {
    return raw;
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
    const raw = await response.text().catch(() => "");
    const detail = workerErrorDetail(raw).slice(0, 1200);
    throw new Error(`Blender no pudo completar el rig (${response.status})${detail ? `: ${detail}` : ""}`);
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
        rigged_url: publicUrl,
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
  let stage = "inicio";

  try {
    stage = "sesión";
    const { supabase, user } = await requireUser(request);
    const body = await request.json();
    const action = String(body?.action ?? "");
    const force = Boolean(body?.force);

    stage = "buscar-glb-original";
    const source = await resolveSource(supabase, user.id);

    const freshUser = await supabase.auth.admin.getUserById(user.id);
    if (freshUser.error || !freshUser.data.user) throw freshUser.error || new Error("Usuario no encontrado");
    const metadata = freshUser.data.user.app_metadata as Record<string, unknown> | undefined;
    const storedJob = readJob(metadata);
    const storedProfile = readProfile(metadata);
    const alreadyRigged = source.currentUrl.includes(COMPLETE_FILENAME);

    if (action === "create") {
      if (alreadyRigged && !force) {
        await updateMetadata(supabase, user.id, { job: null });
        return NextResponse.json({
          alreadyRigged: true,
          status: "SUCCEEDED",
          newAvatarUrl: source.currentUrl,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile ?? { complete: true },
          sourceKind: "current-complete-rig",
        });
      }

      if (force) {
        stage = "limpiar-intento-anterior";
        await updateMetadata(supabase, user.id, { job: null, profile: null });
      } else if (storedJob && jobMatches(storedJob, source)) {
        stage = "revisar-intento-existente";
        const existingTask = await getRiggingTask(storedJob.taskId);
        const ageMs = Date.now() - storedJob.startedAt;
        if (ACTIVE_TASK_STATES.has(existingTask.status) && ageMs < MAX_JOB_AGE_MS) {
          return NextResponse.json({
            ...storedJob,
            status: existingTask.status,
            progress: existingTask.progress,
            resumed: true,
          });
        }
        if (existingTask.status === "SUCCEEDED") {
          return NextResponse.json({ ...storedJob, status: "SUCCEEDED", progress: 99, resumed: true });
        }
      }

      stage = "rig-base-desde-original";
      const taskId = await createRiggingTask(source.originalUrl, 1.8);
      const job: RigJob = {
        taskId,
        startedAt: Date.now(),
        sourceAvatarId: source.avatarId,
        sourceAvatarUrl: source.originalUrl,
      };
      await updateMetadata(supabase, user.id, { job, profile: null });
      return NextResponse.json({
        ...job,
        status: "PENDING",
        source: source.source,
        sourceKind: "original-clean-glb",
        freshRig: true,
      });
    }

    if (action === "current") {
      if (alreadyRigged) {
        return NextResponse.json({
          active: false,
          alreadyRigged: true,
          status: "SUCCEEDED",
          newAvatarUrl: source.currentUrl,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile ?? { complete: true },
        });
      }
      if (!storedJob || !jobMatches(storedJob, source)) {
        return NextResponse.json({ active: false, status: "NOT_STARTED", sourceAvatarId: source.avatarId });
      }

      stage = "estado-rig-base";
      const task = await getRiggingTask(storedJob.taskId);
      return NextResponse.json({ active: ACTIVE_TASK_STATES.has(task.status), ...storedJob, ...task });
    }

    if (action === "status") {
      const taskId = String(body?.taskId ?? storedJob?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId", stage: "estado-rig-base" }, { status: 400 });

      stage = "estado-rig-base";
      const task = await getRiggingTask(taskId);
      return NextResponse.json({ ...task, taskId });
    }

    if (action === "finalize") {
      const taskId = String(body?.taskId ?? storedJob?.taskId ?? "");
      if (!taskId) return NextResponse.json({ error: "Falta taskId", stage: "finalizar-rig" }, { status: 400 });

      stage = "validar-rig-base";
      const task = await getRiggingTask(taskId);
      if (FAILED_TASK_STATES.has(task.status)) {
        await updateMetadata(supabase, user.id, { job: null });
        return NextResponse.json(
          {
            error: task.task_error?.message || "El rigeador base no pudo completar el avatar",
            stage,
            task,
          },
          { status: 422 },
        );
      }

      const riggedUrl = task.result?.rigged_character_glb_url;
      if (task.status !== "SUCCEEDED" || !riggedUrl) {
        return NextResponse.json({ error: "El rig base todavía no terminó", stage, task }, { status: 409 });
      }

      stage = "completar-dedos-y-orejas";
      const completed = await completeRigWithWorker(riggedUrl);

      stage = "guardar-rig-completo";
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
        sourceKind: "original-clean-glb",
        freshRig: true,
      });
    }

    if (action === "clear") {
      await updateMetadata(supabase, user.id, { job: null, profile: null });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción inválida", stage: "entrada" }, { status: 400 });
  } catch (cause) {
    console.error("Complete avatar rig failed", { stage, cause });
    const message = cause instanceof Error ? cause.message : "No se pudo completar el rig del avatar";
    const status = /sesión/i.test(message) ? 401 : /original limpio|GLB original/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message, stage }, { status });
  }
}
