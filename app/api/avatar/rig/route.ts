import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_KEY = "clouva_avatar_complete_rig_job";
const PROFILE_KEY = "clouva_avatar_complete_rig_profile";
const COMPLETE_FILENAME = "clouva-complete-rigged.glb";
const EXPECTED_WORKER_RIG_VERSION = "v15-anatomical-landmark-autorig";
const EXPECTED_PROFILE_VERSION = "clouva-blender-autorig-v15-skull-hand-axis";
const EXPECTED_ANALYZER_VERSION = "clouva-avatar-analyzer-v3.2";
const MIN_RIG_READINESS = 0.82;
const DERIVED_RIG_PATTERN = /(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)/i;
const MAX_ACTIVE_JOB_AGE_MS = 10 * 60 * 1000;

const RIG_STAGES = {
  preparing: "Preparando avatar original",
  analyzer: "Analizando cuerpo, rostro y manos",
  skeleton: "Creando esqueleto",
  weights: "Asignando pesos",
  ready: "Listo para Unreal",
} as const;

type RigStage = (typeof RIG_STAGES)[keyof typeof RIG_STAGES];

type RigJob = {
  jobId: string;
  startedAt: number;
  sourceAvatarId: string | null;
  sourceAvatarUrl: string;
  status: "IN_PROGRESS";
  stage: RigStage;
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
  version?: string;
  boneCount?: number;
  addedBones?: string[];
  normalization?: Record<string, unknown>;
  analyzerRunId?: string;
  analyzerVersion?: string;
  analyzerStatus?: string;
  analyzedInputSha256?: string;
  rigInputSha256?: string;
  rigReadinessScore?: number;
  criticalLandmarksVerified?: boolean;
  analysisTimestamp?: number;
  analyzerMapVersion?: string;
  analyzerSeedCount?: number;
  inputSha256?: string;
  outputSha256?: string;
  weights?: { weightedRatio?: number };
  skeletonPlanner?: { method?: string; inventedLandmarks?: number };
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

type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  error?: unknown;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "string" && cause.trim()) return cause.trim();

  if (cause && typeof cause === "object") {
    const value = cause as ErrorLike;
    const parts = [value.message, value.details, value.hint, value.error]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .map((part) => part.trim());
    const code = typeof value.code === "string" && value.code.trim() ? `Código ${value.code.trim()}` : "";
    if (parts.length || code) return [...parts, code].filter(Boolean).join(" · ");

    try {
      const serialized = JSON.stringify(cause);
      if (serialized && serialized !== "{}") return serialized.slice(0, 1200);
    } catch {
      // Fall through to the safe generic message.
    }
  }

  return "No se pudo completar el rig del avatar";
}

function asError(cause: unknown, prefix?: string) {
  const message = errorMessage(cause);
  return new Error(prefix ? `${prefix}: ${message}` : message);
}

function isMissingColumn(cause: unknown, column?: string) {
  const message = errorMessage(cause).toLowerCase();
  const columnMatch = column ? message.includes(column.toLowerCase()) : true;
  return columnMatch && (
    message.includes("does not exist")
    || message.includes("schema cache")
    || message.includes("could not find")
    || message.includes("pgrst204")
    || message.includes("42703")
  );
}

async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Sesión requerida");

  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error(`Sesión inválida${error ? `: ${errorMessage(error)}` : ""}`);
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

function profileIsAnalyzerApproved(profile: RigProfile | null) {
  return Boolean(
    profile
    && profile.complete === true
    && profile.fingers?.complete === true
    && profile.ears?.complete === true
    && profile.analyzerVersion === EXPECTED_ANALYZER_VERSION
    && ["valid", "valid_with_warnings"].includes(String(profile.analyzerStatus || ""))
    && Number(profile.rigReadinessScore ?? 0) >= MIN_RIG_READINESS
    && profile.criticalLandmarksVerified === true
    && Boolean(profile.analyzerRunId)
    && Boolean(profile.analyzedInputSha256)
    && profile.analyzedInputSha256 === profile.rigInputSha256
    && (!profile.inputSha256 || profile.inputSha256 === profile.rigInputSha256)
    && Number(profile.weights?.weightedRatio ?? 0) >= 0.995
  );
}

async function resolveStoredOriginalUrl(
  supabase: ReturnType<typeof getAdminClient>,
  storagePath: string,
) {
  const { data: signed, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(storagePath, 60 * 60);

  if (signed?.signedUrl) return signed.signedUrl;
  if (error) console.warn("Could not sign original avatar URL", errorMessage(error));

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  return asHttpsUrl(publicData.publicUrl);
}

async function readActiveAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
) {
  const richQuery = await supabase
    .from("user_avatars")
    .select("id,model_url,storage_path,metadata,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!richQuery.error) return richQuery.data as Record<string, unknown> | null;

  const optionalColumnFailure = ["storage_path", "metadata"].some((column) =>
    isMissingColumn(richQuery.error, column),
  );
  if (!optionalColumnFailure) throw asError(richQuery.error, "No se pudo leer el avatar activo");

  const legacyQuery = await supabase
    .from("user_avatars")
    .select("id,model_url,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (legacyQuery.error) throw asError(legacyQuery.error, "No se pudo leer el avatar activo");
  return legacyQuery.data as Record<string, unknown> | null;
}

async function resolveSource(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
): Promise<RigSource> {
  const active = await readActiveAvatar(supabase, userId);

  if (active?.id) {
    const currentUrl = asHttpsUrl(active.model_url);
    const storagePath = typeof active.storage_path === "string" && active.storage_path.trim()
      ? active.storage_path.trim()
      : null;
    const metadata = active.metadata && typeof active.metadata === "object"
      ? active.metadata as Record<string, unknown>
      : {};

    const storedOriginal = storagePath && !looksDerivedRig(storagePath)
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
        "No encontramos el GLB original limpio del avatar. El reintento nunca usará un rig parcial como fuente.",
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
  if (profileError) throw asError(profileError, "No se pudo leer el avatar del perfil");

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
    typeof value.jobId !== "string"
    || typeof value.startedAt !== "number"
    || typeof value.sourceAvatarUrl !== "string"
    || value.status !== "IN_PROGRESS"
    || typeof value.stage !== "string"
  ) {
    return null;
  }
  return {
    jobId: value.jobId,
    startedAt: value.startedAt,
    sourceAvatarId: typeof value.sourceAvatarId === "string" ? value.sourceAvatarId : null,
    sourceAvatarUrl: value.sourceAvatarUrl,
    status: "IN_PROGRESS",
    stage: value.stage as RigStage,
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
  if (current.error || !current.data.user) {
    throw asError(current.error || new Error("Usuario no encontrado"), "No se pudo leer el trabajo de rig");
  }

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
  if (error) throw asError(error, "No se pudo guardar el estado del rig");
}

function jobMatches(job: RigJob, source: RigSource) {
  if (job.sourceAvatarId && source.avatarId) return job.sourceAvatarId === source.avatarId;
  return job.sourceAvatarUrl === source.originalUrl;
}

function jobIsActive(job: RigJob | null, source: RigSource) {
  return Boolean(
    job
    && jobMatches(job, source)
    && Date.now() - job.startedAt < MAX_ACTIVE_JOB_AGE_MS,
  );
}

function progressForStage(stage: RigStage) {
  if (stage === RIG_STAGES.preparing) return 10;
  if (stage === RIG_STAGES.analyzer) return 28;
  if (stage === RIG_STAGES.skeleton) return 55;
  if (stage === RIG_STAGES.weights) return 80;
  return 100;
}

function parseRigProfile(response: Response): RigProfile {
  const raw = response.headers.get("x-clouva-rig-profile");
  if (!raw) throw new Error("El Blender Worker no devolvió el perfil de validación del rig");
  try {
    return JSON.parse(raw) as RigProfile;
  } catch {
    throw new Error("La validación del rig devuelta por Blender es inválida");
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
      force_analyzer: true,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const detail = workerErrorDetail(raw).slice(0, 1200);
    throw new Error(`Blender no pudo completar el rig (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const workerVersion = response.headers.get("x-clouva-rig-version") ?? "";
  const analyzerHeader = response.headers.get("x-clouva-analyzer-version") ?? "";
  const analyzedShaHeader = response.headers.get("x-clouva-analyzed-input-sha256") ?? "";
  const profile = parseRigProfile(response);
  const proof = profile as RigProfile & {
    rigSource?: string;
    inputSource?: string;
    runId?: string;
    durationMs?: number;
    handFit?: Record<string, { method?: string }>;
    landmarkFit?: { method?: string };
    headFit?: { method?: string; lengthRatio?: number };
  };

  if (workerVersion !== EXPECTED_WORKER_RIG_VERSION) {
    throw new Error(`Railway respondió con el rig ${workerVersion || "sin versión"}; se exige ${EXPECTED_WORKER_RIG_VERSION}`);
  }
  if (analyzerHeader !== EXPECTED_ANALYZER_VERSION) {
    throw new Error(`Railway respondió con ${analyzerHeader || "Analyzer sin versión"}; se exige ${EXPECTED_ANALYZER_VERSION}`);
  }
  if (
    proof.version !== EXPECTED_PROFILE_VERSION
    || proof.rigSource !== "Blender official Unreal reference"
    || proof.inputSource !== "original-clean-meshy-avatar"
    || !proof.runId
    || !proof.inputSha256
    || !proof.outputSha256
    || proof.inputSha256 === proof.outputSha256
    || Number(proof.weights?.weightedRatio ?? 0) < 0.995
    || proof.landmarkFit?.method !== "mesh-landmarks-per-chain-v15"
    || proof.handFit?.l?.method !== "target-mesh-distal-axis-and-lateral-spread-v15"
    || proof.handFit?.r?.method !== "target-mesh-distal-axis-and-lateral-spread-v15"
    || proof.headFit?.method !== "mesh-skull-base-to-crown-v15"
    || Number(proof.headFit?.lengthRatio ?? 0) < 0.10
    || Number(proof.headFit?.lengthRatio ?? 1) > 0.20
  ) {
    throw new Error("Blender devolvió un resultado sin prueba de AutoRig V15/V16 anatómico fresco; no se guardará como aprobado");
  }
  if (
    profile.complete !== true
    || profile.fingers?.complete !== true
    || profile.ears?.complete !== true
  ) {
    throw new Error("El avatar no superó la validación del esqueleto y los pesos");
  }
  if (
    profile.analyzerVersion !== EXPECTED_ANALYZER_VERSION
    || !["valid", "valid_with_warnings"].includes(String(profile.analyzerStatus || ""))
    || Number(profile.rigReadinessScore ?? 0) < MIN_RIG_READINESS
    || profile.criticalLandmarksVerified !== true
    || !profile.analyzerRunId
    || !profile.analysisTimestamp
    || profile.analyzedInputSha256 !== profile.rigInputSha256
    || profile.rigInputSha256 !== proof.inputSha256
    || analyzedShaHeader !== proof.inputSha256
    || profile.skeletonPlanner?.method !== "autorig-v16-plus-approved-analyzer-v3.2-seeds"
    || Number(profile.skeletonPlanner?.inventedLandmarks ?? 1) !== 0
  ) {
    throw new Error("Blender devolvió un rig sin prueba completa del Avatar Analyzer V3.2 sobre el mismo GLB; no se guardará como aprobado");
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1024 || Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Blender no devolvió un GLB completo válido");
  }
  return {
    bytes,
    profile,
    workerVersion,
    rigRunId: proof.runId,
    analyzerRunId: profile.analyzerRunId,
    analyzerVersion: profile.analyzerVersion,
    rigReadinessScore: Number(profile.rigReadinessScore ?? 0),
    rigDurationMs: Number(proof.durationMs ?? 0),
    inputSha256: proof.inputSha256,
    outputSha256: proof.outputSha256,
  };
}

async function updateAvatarRow(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  avatarId: string,
  publicUrl: string,
  now: string,
) {
  const basePatch = {
    model_url: publicUrl,
    status: "ready",
    is_active: true,
    updated_at: now,
  };

  const withRiggedUrl = await supabase
    .from("user_avatars")
    .update({ ...basePatch, rigged_url: publicUrl })
    .eq("id", avatarId)
    .eq("user_id", userId);

  if (!withRiggedUrl.error) return;
  if (!isMissingColumn(withRiggedUrl.error, "rigged_url")) {
    throw asError(withRiggedUrl.error, "No se pudo guardar el avatar riggeado");
  }

  const legacyUpdate = await supabase
    .from("user_avatars")
    .update(basePatch)
    .eq("id", avatarId)
    .eq("user_id", userId);

  if (legacyUpdate.error) {
    throw asError(legacyUpdate.error, "No se pudo guardar el avatar riggeado");
  }
}

async function updateProfileAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  publicUrl: string,
  now: string,
) {
  const fullUpdate = await supabase
    .from("profiles")
    .update({ avatar_3d_url: publicUrl, updated_at: now })
    .eq("id", userId);

  if (!fullUpdate.error) return;
  if (!isMissingColumn(fullUpdate.error, "updated_at")) {
    throw asError(fullUpdate.error, "No se pudo actualizar el avatar del perfil");
  }

  const legacyUpdate = await supabase
    .from("profiles")
    .update({ avatar_3d_url: publicUrl })
    .eq("id", userId);
  if (legacyUpdate.error) throw asError(legacyUpdate.error, "No se pudo actualizar el avatar del perfil");
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
  if (uploadError) throw asError(uploadError, "No se pudo guardar el GLB riggeado");

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const basePublicUrl = asHttpsUrl(publicData.publicUrl);
  if (!basePublicUrl) throw new Error("Supabase no devolvió una URL válida para el avatar riggeado");

  const publicUrl = `${basePublicUrl}?v=${Date.now()}`;
  const now = new Date().toISOString();

  if (avatarId) await updateAvatarRow(supabase, userId, avatarId, publicUrl, now);
  await updateProfileAvatar(supabase, userId, publicUrl, now);
  return publicUrl;
}

export async function POST(request: NextRequest) {
  let stage: RigStage | "sesión" | "buscar-glb-original" | "leer-estado-del-rig" = "sesión";
  let userId: string | null = null;
  let supabaseForCleanup: ReturnType<typeof getAdminClient> | null = null;

  try {
    const { supabase, user } = await requireUser(request);
    userId = user.id;
    supabaseForCleanup = supabase;
    const body = await request.json();
    const action = String(body?.action ?? "");
    const retry = action === "retry";
    const createRequested = action === "create" || retry;

    stage = "buscar-glb-original";
    const source = await resolveSource(supabase, user.id);

    stage = "leer-estado-del-rig";
    const freshUser = await supabase.auth.admin.getUserById(user.id);
    if (freshUser.error || !freshUser.data.user) {
      throw asError(freshUser.error || new Error("Usuario no encontrado"), "No se pudo leer el estado del rig");
    }

    const metadata = freshUser.data.user.app_metadata as Record<string, unknown> | undefined;
    const storedJob = readJob(metadata);
    const storedProfile = readProfile(metadata);
    const hasDerivedRig = source.currentUrl.includes(COMPLETE_FILENAME) || looksDerivedRig(source.currentUrl);
    const alreadyRigged = hasDerivedRig && profileIsAnalyzerApproved(storedProfile);

    if (createRequested) {
      if (alreadyRigged && !retry) {
        await updateMetadata(supabase, user.id, { job: null });
        return NextResponse.json({
          alreadyRigged: true,
          completed: true,
          status: "SUCCEEDED",
          progress: 100,
          stage: RIG_STAGES.ready,
          newAvatarUrl: source.currentUrl,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile,
          sourceKind: "current-analyzer-approved-rig",
        });
      }

      if (jobIsActive(storedJob, source)) {
        return NextResponse.json({
          active: true,
          resumed: true,
          taskId: storedJob!.jobId,
          status: storedJob!.status,
          progress: progressForStage(storedJob!.stage),
          stage: storedJob!.stage,
          sourceAvatarId: source.avatarId,
        });
      }

      if (storedJob) await updateMetadata(supabase, user.id, { job: null });

      let job: RigJob = {
        jobId: randomUUID(),
        startedAt: Date.now(),
        sourceAvatarId: source.avatarId,
        sourceAvatarUrl: source.originalUrl,
        status: "IN_PROGRESS",
        stage: RIG_STAGES.preparing,
      };
      await updateMetadata(
        supabase,
        user.id,
        retry || hasDerivedRig ? { job, profile: null } : { job },
      );

      stage = RIG_STAGES.analyzer;
      job = { ...job, stage };
      await updateMetadata(supabase, user.id, { job });
      const completed = await completeRigWithWorker(source.originalUrl);

      stage = RIG_STAGES.weights;
      job = { ...job, stage };
      await updateMetadata(supabase, user.id, { job });

      const publicUrl = await persistRiggedAvatar(
        supabase,
        user.id,
        source.avatarId,
        completed.bytes,
      );
      await updateMetadata(supabase, user.id, { job: null, profile: completed.profile });

      return NextResponse.json({
        ok: true,
        completed: true,
        status: "SUCCEEDED",
        progress: 100,
        stage: RIG_STAGES.ready,
        taskId: job.jobId,
        newAvatarUrl: publicUrl,
        sourceAvatarId: source.avatarId,
        rigProfile: completed.profile,
        sourceKind: "original-clean-glb-analyzed-and-rigged",
        freshRig: true,
        retried: retry,
        workerVersion: completed.workerVersion,
        rigRunId: completed.rigRunId,
        analyzerRunId: completed.analyzerRunId,
        analyzerVersion: completed.analyzerVersion,
        rigReadinessScore: completed.rigReadinessScore,
        rigDurationMs: completed.rigDurationMs,
        inputSha256: completed.inputSha256,
        outputSha256: completed.outputSha256,
      });
    }

    if (action === "current" || action === "status") {
      if (alreadyRigged) {
        return NextResponse.json({
          active: false,
          alreadyRigged: true,
          completed: true,
          status: "SUCCEEDED",
          progress: 100,
          stage: RIG_STAGES.ready,
          newAvatarUrl: source.currentUrl,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile,
        });
      }

      const requestedId = typeof body?.taskId === "string" ? body.taskId : null;
      if (jobIsActive(storedJob, source) && (!requestedId || requestedId === storedJob!.jobId)) {
        return NextResponse.json({
          active: true,
          taskId: storedJob!.jobId,
          status: storedJob!.status,
          progress: progressForStage(storedJob!.stage),
          stage: storedJob!.stage,
          sourceAvatarId: source.avatarId,
        });
      }

      if (storedJob) await updateMetadata(supabase, user.id, { job: null });
      return NextResponse.json({
        active: false,
        status: "NOT_STARTED",
        progress: 0,
        stage: RIG_STAGES.preparing,
        sourceAvatarId: source.avatarId,
        unvalidatedRig: hasDerivedRig,
        rigProfile: storedProfile,
      });
    }

    if (action === "finalize") {
      if (alreadyRigged) {
        return NextResponse.json({
          ok: true,
          completed: true,
          status: "SUCCEEDED",
          progress: 100,
          stage: RIG_STAGES.ready,
          newAvatarUrl: source.currentUrl,
          sourceAvatarId: source.avatarId,
          rigProfile: storedProfile,
        });
      }
      return NextResponse.json(
        {
          error: jobIsActive(storedJob, source)
            ? "Blender todavía está procesando el avatar"
            : hasDerivedRig
              ? "El rig existente no está aprobado por Avatar Analyzer V3.2"
              : "No hay un resultado de Blender para finalizar",
          status: jobIsActive(storedJob, source) ? "IN_PROGRESS" : "NOT_STARTED",
          stage: storedJob?.stage ?? RIG_STAGES.preparing,
          unvalidatedRig: hasDerivedRig,
        },
        { status: 409 },
      );
    }

    if (action === "clear") {
      await updateMetadata(supabase, user.id, { job: null });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Acción inválida", stage: "entrada" }, { status: 400 });
  } catch (cause) {
    const technicalError = errorMessage(cause);
    console.error("Blender avatar autorig failed", { stage, technicalError, cause });

    if (userId && supabaseForCleanup) {
      try {
        await updateMetadata(supabaseForCleanup, userId, { job: null });
      } catch (cleanupError) {
        console.error("Could not clear failed Blender avatar job", cleanupError);
      }
    }

    const message = `[${stage}] ${technicalError}`;
    const status = /sesión/i.test(technicalError)
      ? 401
      : /Avatar Analyzer|Rig readiness|mapa anatómico|no está aprobado/i.test(technicalError)
        ? 409
        : /original limpio|GLB original|no hay un avatar original/i.test(technicalError)
          ? 422
          : /Blender no pudo|validación del esqueleto/i.test(technicalError)
            ? 422
            : 500;

    return NextResponse.json({ error: message, stage, technicalError }, { status });
  }
}
