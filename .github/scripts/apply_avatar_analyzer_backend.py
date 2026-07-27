from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"missing replacement anchor in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"regex replacement count={count} in {path}: {pattern}")
    target.write_text(updated, encoding="utf-8")


write("app/api/avatar/analyze/_shared.ts", r'''
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DERIVED_RIG_PATTERN = /(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)/i;
const METADATA_UPDATE_ATTEMPTS = 3;

type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  error?: unknown;
};

type MetadataRecord = Record<string, unknown>;

export type AnalyzerPendingJob = {
  jobId: string;
  avatarId: string;
  requestedRigProfile: "BODY_BASIC";
  startedAt: string;
  sourceKind: "active_avatar_original";
  status: "pending" | "error";
  error?: string;
  updatedAt: string;
};

function asMetadata(value: unknown): MetadataRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : {};
}

function asRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "string" && cause.trim()) return cause.trim();
  if (cause && typeof cause === "object") {
    const value = cause as ErrorLike;
    const parts = [value.message, value.details, value.hint, value.error]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .map((part) => part.trim());
    if (parts.length) return parts.join(" · ");
  }
  return "No se pudo analizar el avatar";
}

export function asHttpsUrl(value: unknown) {
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

export async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Sesión requerida");
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida");
  return { supabase, user: data.user };
}

async function signedAvatarUrl(
  supabase: ReturnType<typeof getAdminClient>,
  storagePath: string,
) {
  const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(storagePath, 60 * 60);
  if (signed?.signedUrl) return asHttpsUrl(signed.signedUrl);
  return asHttpsUrl(supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl);
}

export async function resolveOriginalAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
) {
  const active = await supabase
    .from("user_avatars")
    .select("id,model_url,storage_path,metadata,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!active.error && active.data) {
    const row = active.data as Record<string, unknown>;
    const storagePath = typeof row.storage_path === "string" && row.storage_path.trim()
      ? row.storage_path.trim()
      : null;
    const metadata = asMetadata(row.metadata);
    const storedOriginal = storagePath && !looksDerivedRig(storagePath)
      ? await signedAvatarUrl(supabase, storagePath)
      : null;
    const meshyOriginal = asHttpsUrl(metadata.original_meshy_url);
    const modelUrl = asHttpsUrl(row.model_url);
    const originalUrl = storedOriginal
      ?? meshyOriginal
      ?? (modelUrl && !looksDerivedRig(modelUrl) ? modelUrl : null);
    if (originalUrl) {
      return {
        avatarId: typeof row.id === "string" ? row.id : null,
        metadata,
        sourceUrl: originalUrl,
      };
    }
  }

  const profile = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error) throw new Error(`No se pudo leer el avatar: ${errorMessage(profile.error)}`);
  const profileUrl = asHttpsUrl(profile.data?.avatar_3d_url);
  if (profileUrl && !looksDerivedRig(profileUrl)) {
    return { avatarId: null, metadata: {}, sourceUrl: profileUrl };
  }
  throw new Error("No encontramos el GLB original limpio del avatar para analizar");
}

async function mutateAvatarMetadata(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  avatarId: string,
  mutate: (metadata: MetadataRecord) => MetadataRecord,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < METADATA_UPDATE_ATTEMPTS; attempt += 1) {
    const current = await supabase
      .from("user_avatars")
      .select("metadata,updated_at")
      .eq("id", avatarId)
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error || !current.data) throw current.error || new Error("Avatar activo no encontrado");

    const updatedAt = new Date().toISOString();
    const nextMetadata = mutate(asMetadata(current.data.metadata));
    const baseUpdate = supabase
      .from("user_avatars")
      .update({ metadata: nextMetadata, updated_at: updatedAt })
      .eq("id", avatarId)
      .eq("user_id", userId);
    const result = current.data.updated_at
      ? await baseUpdate.eq("updated_at", current.data.updated_at).select("id").maybeSingle()
      : await baseUpdate.select("id").maybeSingle();
    if (!result.error && result.data) return nextMetadata;
    lastError = result.error || new Error("La metadata cambió durante la actualización");
    await sleep(60 * (attempt + 1));
  }
  throw lastError || new Error("No se pudo actualizar la metadata del Analyzer");
}

export async function persistPendingAnalyzerJob(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
  startedAt?: string;
}) {
  const startedAt = args.startedAt || new Date().toISOString();
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => ({
    ...metadata,
    avatar_analyzer_v4_pending: {
      jobId: args.jobId,
      avatarId: args.avatarId,
      requestedRigProfile: "BODY_BASIC",
      startedAt,
      sourceKind: "active_avatar_original",
      status: "pending",
      updatedAt: new Date().toISOString(),
    } satisfies AnalyzerPendingJob,
  }));
}

export async function findAvatarForAnalyzerJob(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("user_avatars")
    .select("id,metadata,updated_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  for (const row of data || []) {
    const metadata = asMetadata(row.metadata);
    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (pending?.jobId === jobId) return { avatarId: row.id as string, metadata };
  }
  return null;
}

export async function persistCompletedAnalyzerJob(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
  runId: string;
  summary: MetadataRecord;
}) {
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => {
    const next = { ...metadata };
    const pending = asRecord(next.avatar_analyzer_v4_pending);
    if (!pending || pending.jobId === args.jobId) delete next.avatar_analyzer_v4_pending;
    next.avatar_analyzer_v4 = {
      runId: args.runId,
      analyzerVersion: String(args.summary.analyzerVersion ?? "clouva-avatar-analyzer-v4.1"),
      mapVersion: "clouva-anatomical-map-v4.1",
      sourceSha256: String(args.summary.sourceSha256 ?? ""),
      status: String(args.summary.status ?? "needs_review"),
      requestedRigProfile: String(args.summary.requestedRigProfile ?? "BODY_BASIC"),
      updatedAt: new Date().toISOString(),
    };
    return next;
  });
}

export async function persistAnalyzerJobError(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
  error: string;
}) {
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => {
    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (!pending || pending.jobId !== args.jobId) return metadata;
    return {
      ...metadata,
      avatar_analyzer_v4_pending: {
        ...pending,
        status: "error",
        error: args.error.slice(0, 1000),
        updatedAt: new Date().toISOString(),
      },
    };
  });
}

export function workerError(raw: string) {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const detail = asRecord(parsed.detail);
    const value = detail?.message ?? parsed.detail ?? parsed.error ?? parsed.message;
    return typeof value === "string" ? value : JSON.stringify(value ?? parsed);
  } catch {
    return raw;
  }
}

export function workerBaseUrlAndToken() {
  const workerBaseUrl = (process.env.BLENDER_WORKER_URL || process.env.GARMENT_RIG_WORKER_URL)?.replace(/\/+$/, "");
  const workerToken = process.env.BLENDER_WORKER_TOKEN || process.env.GARMENT_RIG_WORKER_TOKEN;
  if (!workerBaseUrl) throw new Error("Falta configurar BLENDER_WORKER_URL");
  return { workerBaseUrl, workerToken };
}
''')

write("app/api/avatar/analyze/route.ts", r'''
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  persistPendingAnalyzerJob,
  requireUser,
  resolveOriginalAvatar,
  workerBaseUrlAndToken,
  workerError,
} from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const avatar = await resolveOriginalAvatar(supabase, user.id);
    const { workerBaseUrl, workerToken } = workerBaseUrlAndToken();

    const response = await fetch(`${workerBaseUrl}/avatar/analyze-v4-preview-async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({
        source_url: avatar.sourceUrl,
        include_renders: true,
        requested_rig_profile: "BODY_BASIC",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30 * 1000),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(
        `No se pudo iniciar el análisis (${response.status})${raw ? `: ${workerError(raw).slice(0, 1200)}` : ""}`,
      );
    }

    const data = await response.json() as { jobId?: string };
    if (!data.jobId) throw new Error("El worker no devolvió un jobId");

    let pendingPersisted = false;
    if (avatar.avatarId) {
      try {
        await persistPendingAnalyzerJob({
          supabase,
          userId: user.id,
          avatarId: avatar.avatarId,
          jobId: data.jobId,
        });
        pendingPersisted = true;
      } catch (cause) {
        console.error("Avatar Analyzer pending job persistence failed", {
          jobId: data.jobId,
          cause: errorMessage(cause),
        });
      }
    }
    return NextResponse.json({ jobId: data.jobId, pendingPersisted });
  } catch (cause) {
    console.error("Avatar Analyzer kickoff failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
''')

write("app/api/avatar/analyze/job/[jobId]/route.ts", r'''
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  findAvatarForAnalyzerJob,
  persistAnalyzerJobError,
  persistCompletedAnalyzerJob,
  requireUser,
  workerBaseUrlAndToken,
  workerError,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

type WorkerJobStatus = {
  status: "pending" | "done" | "error";
  runId?: string;
  summary?: Record<string, unknown>;
  detail?: string;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "jobId inválido" }, { status: 400 });
    }
    const { workerBaseUrl, workerToken } = workerBaseUrlAndToken();

    const response = await fetch(`${workerBaseUrl}/avatar/analyze-v4/job/${jobId}`, {
      headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(15 * 1000),
    });
    if (response.status === 404) {
      return NextResponse.json({ error: "Job no encontrado", code: "ANALYZER_JOB_NOT_FOUND" }, { status: 404 });
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`No se pudo consultar el estado del análisis (${response.status})${raw ? `: ${workerError(raw).slice(0, 800)}` : ""}`);
    }
    const job = await response.json() as WorkerJobStatus;
    const avatar = await findAvatarForAnalyzerJob(supabase, user.id, jobId).catch(() => null);

    if (job.status === "done" && job.runId && /^[a-f0-9]{32}$/.test(job.runId) && avatar) {
      await persistCompletedAnalyzerJob({
        supabase,
        userId: user.id,
        avatarId: avatar.avatarId,
        jobId,
        runId: job.runId,
        summary: job.summary || {},
      }).catch((cause) => {
        console.error("Avatar Analyzer V4 completion persistence failed", {
          jobId,
          runId: job.runId,
          cause: errorMessage(cause),
        });
      });
    } else if (job.status === "error" && avatar) {
      await persistAnalyzerJobError({
        supabase,
        userId: user.id,
        avatarId: avatar.avatarId,
        jobId,
        error: job.detail || "El Worker no pudo completar el análisis",
      }).catch((cause) => {
        console.error("Avatar Analyzer V4 error persistence failed", { jobId, cause: errorMessage(cause) });
      });
    }

    return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Avatar Analyzer job status failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
''')

write("app/api/avatar/analyze/latest/route.ts", r'''
import { NextRequest, NextResponse } from "next/server";
import { errorMessage, requireUser } from "../_shared";
import { safeAnalyzerRunId } from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetadataRecord = Record<string, unknown>;

function asRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : null;
}

export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const { data, error } = await supabase
      .from("user_avatars")
      .select("id,metadata,updated_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const metadata = asRecord(data?.metadata) || {};
    const stored = asRecord(metadata.avatar_analyzer_v4);
    if (stored && typeof stored.runId === "string") {
      return NextResponse.json({
        available: true,
        pending: false,
        runId: safeAnalyzerRunId(stored.runId),
        analyzerVersion: stored.analyzerVersion,
        mapVersion: stored.mapVersion,
        sourceSha256: stored.sourceSha256,
        status: stored.status,
        requestedRigProfile: stored.requestedRigProfile,
        updatedAt: stored.updatedAt,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (pending && typeof pending.jobId === "string") {
      return NextResponse.json({
        available: false,
        pending: true,
        jobId: pending.jobId,
        startedAt: pending.startedAt,
        pendingStatus: pending.status,
        pendingError: pending.error,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ available: false, pending: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
''')

result_route = ROOT / "app/api/avatar/analyze/result/[runId]/route.ts"
result_source = result_route.read_text(encoding="utf-8")
helper = r'''

const FORWARDED_WORKER_STATUSES = new Set([404, 409, 410, 422, 429, 502, 503]);

function workerErrorPayload(raw: string, status: number) {
  try {
    const parsed = JSON.parse(raw) as JsonRecord;
    const detail = asRecord(parsed.detail);
    const code = String(detail?.code ?? parsed.code ?? (status === 503 ? "ANALYZER_RESULT_STILL_PERSISTING" : "ANALYZER_WORKER_ERROR"));
    const messageValue = detail?.message ?? parsed.error ?? parsed.message ?? parsed.detail;
    const message = typeof messageValue === "string"
      ? messageValue
      : status === 503
        ? "El diagnóstico todavía se está guardando."
        : `El Worker no pudo devolver el diagnóstico (${status}).`;
    return { error: message, code, retryable: [429, 502, 503].includes(status) };
  } catch {
    return {
      error: status === 503
        ? "El diagnóstico todavía se está guardando."
        : `El Worker no pudo devolver el diagnóstico (${status}).`,
      code: status === 503 ? "ANALYZER_RESULT_STILL_PERSISTING" : "ANALYZER_WORKER_ERROR",
      retryable: [429, 502, 503].includes(status),
    };
  }
}
'''
if "FORWARDED_WORKER_STATUSES" not in result_source:
    result_source = result_source.replace("type JsonRecord = Record<string, unknown>;", "type JsonRecord = Record<string, unknown>;" + helper, 1)
result_source = re.sub(
    r'export async function GET\(\n  request: NextRequest,\n  context: \{ params: Promise<\{ runId: string \}> \},\n\) \{.*?\n\}',
    r'''export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    await requireAvatarAnalyzerUser(request);
    const { runId: rawRunId } = await context.params;
    const runId = safeAnalyzerRunId(rawRunId);
    const response = await fetchAvatarAnalyzerWorker(`/avatar/analyze-v4/result/${runId}`);
    const raw = await response.text();
    if (!response.ok) {
      const status = FORWARDED_WORKER_STATUSES.has(response.status) ? response.status : 502;
      const headers = new Headers({ "Cache-Control": "no-store" });
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) headers.set("Retry-After", retryAfter);
      return NextResponse.json(workerErrorPayload(raw, status), { status, headers });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({
        error: "El Worker devolvió un diagnóstico incompleto. Reintentá la carga del detalle.",
        code: "ANALYZER_RESULT_INVALID_JSON",
        retryable: true,
      }, { status: 502, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
    }
    return NextResponse.json(normalizePayload(parsed), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: avatarAnalyzerError(cause), code: "ANALYZER_REQUEST_REJECTED", retryable: false }, { status: 422 });
  }
}''',
    result_source,
    count=1,
    flags=re.S,
)
result_route.write_text(result_source, encoding="utf-8")

replace_once(
    "worker/garment-rig/app_v17.py",
    '''INCOMPLETE_RUN_GRACE_SECONDS = 120\n\n\ndef _cleanup_expired_runs():\n    RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)\n    cutoff = time.time() - RUN_TTL_SECONDS\n    incomplete_cutoff = time.time() - INCOMPLETE_RUN_GRACE_SECONDS\n    for child in RUN_CACHE_ROOT.iterdir():\n        try:\n            if not child.is_dir():\n                continue\n            mtime = child.stat().st_mtime\n            # A run still being persisted (see _persist_run_v4) has no\n            # expires_at.json yet; only treat that as abandoned once it has\n            # had time to finish, so an in-flight commit is never swept.\n            incomplete = not (child / "expires_at.json").is_file() and mtime < incomplete_cutoff\n            if incomplete or mtime < cutoff:\n                shutil.rmtree(child, ignore_errors=True)\n        except OSError:\n            continue\n''',
    '''INCOMPLETE_RUN_GRACE_SECONDS = 120\n\n\ndef _cache_event(run_id: str, state: str, reason: str, age_seconds: float):\n    print(json.dumps({\n        "event": "avatar_analyzer_run_cache",\n        "runId": run_id,\n        "state": state,\n        "reason": reason,\n        "ageSeconds": round(max(0.0, age_seconds), 3),\n    }, separators=(",", ":")), flush=True)\n\n\ndef _cleanup_expired_runs():\n    RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)\n    now = time.time()\n    cutoff = now - RUN_TTL_SECONDS\n    incomplete_cutoff = now - INCOMPLETE_RUN_GRACE_SECONDS\n    for child in RUN_CACHE_ROOT.iterdir():\n        try:\n            if not child.is_dir():\n                continue\n            mtime = child.stat().st_mtime\n            marker = child / "expires_at.json"\n            age = now - mtime\n            if not marker.is_file():\n                if mtime >= incomplete_cutoff:\n                    continue\n                _cache_event(child.name, "abandoned", "commit_marker_missing_after_grace", age)\n                shutil.rmtree(child, ignore_errors=True)\n                continue\n            if mtime < cutoff:\n                _cache_event(child.name, "expired", "ttl_elapsed", age)\n                shutil.rmtree(child, ignore_errors=True)\n        except OSError as exc:\n            _cache_event(child.name, "cleanup_error", type(exc).__name__, 0.0)\n            continue\n''',
)

app_v18 = ROOT / "worker/garment-rig/app_v18.py"
source = app_v18.read_text(encoding="utf-8")
source = source.replace(
    'V4_DURABLE_SUFFIXES = {".glb", ".json", ".png"}\n',
    'V4_DURABLE_SUFFIXES = {".glb", ".json", ".png"}\nV4_REQUIRED_FILES = ("avatar_analysis.json", "diagnostic_report.json", "diagnostic_landmarks.glb")\nPUBLIC_RESULT_BUDGET_BYTES = 24 * 1024 * 1024\nRESULT_RETRY_AFTER_SECONDS = 3\n',
    1,
)
source = re.sub(
    r'def _persist_run_v4\(output_dir: Path, analysis: dict\[str, Any\], source_path: Path\):.*?\n\ndef _public_result\(run_dir: Path\):.*?\n\ndef _assert_profile_ready',
    r'''def _validate_staged_run(staging: Path, run_id: str) -> None:
    missing = [name for name in V4_REQUIRED_FILES if not (staging / name).is_file()]
    if missing:
        raise RuntimeError(f"Avatar Analyzer V4 durable result incomplete: {', '.join(missing)}")
    staged_analysis = json.loads((staging / "avatar_analysis.json").read_text(encoding="utf-8"))
    json.loads((staging / "diagnostic_report.json").read_text(encoding="utf-8"))
    if str(staged_analysis.get("runId") or "") != run_id:
        raise RuntimeError("Avatar Analyzer V4 staged runId does not match its destination")
    if (staging / "diagnostic_landmarks.glb").stat().st_size < 1024:
        raise RuntimeError("Avatar Analyzer V4 diagnostic GLB is empty")


def _persist_run_v4(output_dir: Path, analysis: dict[str, Any], source_path: Path):
    """Validate a local staging tree and publish it with a final commit marker."""
    run_id = str(analysis.get("runId") or "")
    if not v32.RUN_ID_PATTERN.fullmatch(run_id):
        raise RuntimeError("Avatar Analyzer V4 returned an invalid runId")
    v32._cleanup_expired_runs()
    v32.RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    destination = v32.RUN_CACHE_ROOT / run_id
    staging = Path(tempfile.mkdtemp(prefix=f"clouva-run-staging-{run_id}-"))
    started = time.perf_counter()
    try:
        for source_file in output_dir.rglob("*"):
            if not source_file.is_file() or source_file.suffix.lower() not in V4_DURABLE_SUFFIXES:
                continue
            target = staging / source_file.relative_to(output_dir)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, target)
        source_dir = staging / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, source_dir / "avatar-original-clean.glb")
        _validate_staged_run(staging, run_id)
        shutil.rmtree(destination, ignore_errors=True)
        shutil.move(str(staging), str(destination))
        marker = destination / "expires_at.json"
        marker_tmp = destination / ".expires_at.json.tmp"
        marker_tmp.write_text(json.dumps({
            "runId": run_id,
            "createdAt": time.time(),
            "expiresAt": time.time() + v32.RUN_TTL_SECONDS,
            "state": "completed",
        }, separators=(",", ":")), encoding="utf-8")
        marker_tmp.replace(marker)
        print(json.dumps({
            "event": "avatar_analyzer_run_persisted",
            "runId": run_id,
            "state": "completed",
            "durationMs": round((time.perf_counter() - started) * 1000, 3),
            "persistentBytes": sum(path.stat().st_size for path in destination.rglob("*") if path.is_file()),
        }, separators=(",", ":")), flush=True)
        return destination
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        if destination.is_dir() and not (destination / "expires_at.json").is_file():
            shutil.rmtree(destination, ignore_errors=True)
        raise


def _strip_public_debug(value: Any):
    if isinstance(value, list):
        return [_strip_public_debug(item) for item in value]
    if not isinstance(value, dict):
        return value
    omitted = {
        "initialAttempt", "finalAttempt", "stdout", "stderr", "subprocessLogs",
        "phaseLogs", "rawDetectorOutput", "rawDetections", "detectorDump",
    }
    return {
        key: _strip_public_debug(item)
        for key, item in value.items()
        if key not in omitted
    }


def _public_result(run_dir: Path):
    analysis_path = run_dir / "avatar_analysis.json"
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    if analysis.get("version") != ANALYZER_VERSION or analysis.get("mapVersion") != MAP_VERSION:
        raise HTTPException(status_code=410, detail={
            "code": "ANALYZER_RESULT_STALE",
            "message": "El resultado fue invalidado porque cambió el Analyzer o el mapa anatómico.",
            "storedAnalyzerVersion": analysis.get("version"),
            "currentAnalyzerVersion": ANALYZER_VERSION,
            "storedMapVersion": analysis.get("mapVersion"),
            "currentMapVersion": MAP_VERSION,
        })
    report_path = run_dir / "diagnostic_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    public_analysis = _strip_public_debug(analysis)
    public_report = _strip_public_debug(report)
    renders = []
    for directory_name in ("renders_v4", "renders_temporales", "renders_initial"):
        directory = run_dir / directory_name
        if directory.is_dir():
            renders.extend(
                f"{directory_name}/{path.name}"
                for path in sorted(directory.iterdir())
                if path.is_file() and path.suffix.lower() in {".png", ".json"}
            )
    payload = {
        "id": analysis.get("runId"),
        "runId": analysis.get("runId"),
        "createdAt": analysis.get("createdAt") or analysis.get("timestamp"),
        "source": analysis.get("source") or {},
        "summary": _summary(analysis),
        "analysis": public_analysis,
        "report": public_report,
        "assets": {"diagnosticGlb": "diagnostic_landmarks.glb", "renders": renders},
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > PUBLIC_RESULT_BUDGET_BYTES:
        public_analysis.pop("diagnostics", None)
        if isinstance(public_report, dict):
            public_report.pop("diagnostics", None)
            public_report.pop("debug", None)
        payload["publicPayloadTrimmed"] = True
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > PUBLIC_RESULT_BUDGET_BYTES:
        essential = {
            "version", "mapVersion", "runId", "createdAt", "timestamp", "source",
            "overall_status", "status", "requested_rig_profile", "supported_rig_profiles",
            "rigReadinessScore", "rigReadinessApproved", "rigReadinessGates",
            "bodyBaseConfidence", "humanoidConfidence", "criticalLandmarksVerified",
            "bodyAnalysis", "faceAnalysis", "leftHandAnalysis", "rightHandAnalysis",
            "landmarks", "warnings", "bodySubsystems", "detectionCoverage", "dimensions",
            "metrics", "orientation", "root_causes", "blocking_reasons",
            "recommended_next_action", "topology_capabilities", "diagnostic_fingerprint",
        }
        payload["analysis"] = {key: value for key, value in public_analysis.items() if key in essential}
        payload["report"] = {"publicPayloadTrimmed": True}
        payload["publicPayloadTrimmed"] = True
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > PUBLIC_RESULT_BUDGET_BYTES:
        raise HTTPException(status_code=413, detail={
            "code": "ANALYZER_PUBLIC_RESULT_BUDGET_EXCEEDED",
            "message": "El diagnóstico supera el presupuesto público aun después de eliminar evidencia regenerable.",
            "publicBytes": len(encoded),
            "budgetBytes": PUBLIC_RESULT_BUDGET_BYTES,
        })
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    print(json.dumps({
        "event": "avatar_analyzer_public_result",
        "runId": analysis.get("runId"),
        "persistedAnalysisBytes": analysis_path.stat().st_size,
        "persistedReportBytes": report_path.stat().st_size,
        "publicBytes": len(encoded),
        "landmarkCount": len(landmarks),
        "renderCount": len(renders),
        "trimmed": bool(payload.get("publicPayloadTrimmed")),
    }, separators=(",", ":")), flush=True)
    return payload


def _assert_profile_ready''',
    source,
    count=1,
    flags=re.S,
)
source = re.sub(
    r'@app.get\("/avatar/analyze-v4/result/\{run_id\}"\)\ndef avatar_analyze_v4_result\(run_id: str\):.*?\n\n@app.get\("/avatar/analyze-v4/result/\{run_id\}/asset/\{asset_path:path\}"\)',
    r'''def _result_still_persisting(run_id: str):
    raise HTTPException(
        status_code=503,
        detail={
            "code": "ANALYZER_RESULT_STILL_PERSISTING",
            "message": "El diagnóstico todavía se está guardando. Probá de nuevo en unos segundos.",
            "runId": run_id,
            "retryAfterSeconds": RESULT_RETRY_AFTER_SECONDS,
        },
        headers={"Retry-After": str(RESULT_RETRY_AFTER_SECONDS)},
    )


@app.get("/avatar/analyze-v4/result/{run_id}")
def avatar_analyze_v4_result(run_id: str):
    v32._cleanup_expired_runs()
    run_dir = v32._safe_run_dir(run_id)
    if not (run_dir / "expires_at.json").is_file():
        _result_still_persisting(run_id)
    try:
        return JSONResponse(_public_result(run_dir))
    except HTTPException:
        raise
    except (json.JSONDecodeError, FileNotFoundError, OSError) as exc:
        _result_still_persisting(run_id)
        raise exc


@app.get("/avatar/analyze-v4/result/{run_id}/asset/{asset_path:path}")''',
    source,
    count=1,
    flags=re.S,
)
source = source.replace(
    '''def avatar_analyze_v4_asset(run_id: str, asset_path: str):\n    run_dir = v32._safe_run_dir(run_id)\n    requested = (run_dir / asset_path).resolve()\n''',
    '''def avatar_analyze_v4_asset(run_id: str, asset_path: str):\n    run_dir = v32._safe_run_dir(run_id)\n    if not (run_dir / "expires_at.json").is_file():\n        _result_still_persisting(run_id)\n    requested = (run_dir / asset_path).resolve()\n''',
    1,
)
app_v18.write_text(source, encoding="utf-8")

write("worker/garment-rig/test_avatar_analyzer_v4_persistence.py", r'''
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time
import unittest

import app_v18


class AvatarAnalyzerV4PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.previous_root = app_v18.v32.RUN_CACHE_ROOT
        app_v18.v32.RUN_CACHE_ROOT = self.root / "runs"
        app_v18.v32.RUN_CACHE_ROOT.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        app_v18.v32.RUN_CACHE_ROOT = self.previous_root
        self.temp.cleanup()

    def _fixture(self, run_id="a" * 32, debug_size=2_000_000):
        output = self.root / "output"
        output.mkdir(parents=True, exist_ok=True)
        analysis = {
            "version": app_v18.ANALYZER_VERSION,
            "mapVersion": app_v18.MAP_VERSION,
            "runId": run_id,
            "overall_status": "needs_review",
            "source": {"sha256": "source"},
            "landmarks": {"pelvis": {"accepted": True, "state": "verified"}},
            "metrics": {"verifiedLandmarkCount": 1},
            "diagnostics": {
                "initialAttempt": {"stdout": "x" * debug_size},
                "finalAttempt": {"stderr": "y" * debug_size},
                "kept": {"value": 1},
            },
        }
        (output / "avatar_analysis.json").write_text(json.dumps(analysis), encoding="utf-8")
        (output / "diagnostic_report.json").write_text(json.dumps({"debug": {"stdout": "z" * debug_size}}), encoding="utf-8")
        (output / "diagnostic_landmarks.glb").write_bytes(b"glTF" + b"0" * 4096)
        renders = output / "renders_v4"
        renders.mkdir()
        (renders / "hand_l_palm.png").write_bytes(b"png")
        (renders / "technical.npy").write_bytes(b"npy")
        source = self.root / "source.glb"
        source.write_bytes(b"glTF" + b"1" * 4096)
        return output, source, analysis

    def test_commit_marker_is_written_after_validated_publish(self):
        output, source, analysis = self._fixture()
        destination = app_v18._persist_run_v4(output, analysis, source)
        self.assertTrue((destination / "expires_at.json").is_file())
        self.assertEqual(json.loads((destination / "avatar_analysis.json").read_text())["runId"], analysis["runId"])
        self.assertEqual(source.read_bytes(), b"glTF" + b"1" * 4096)

    def test_public_payload_removes_duplicate_and_regenerable_debug(self):
        output, source, analysis = self._fixture(debug_size=4_000_000)
        destination = app_v18._persist_run_v4(output, analysis, source)
        payload = app_v18._public_result(destination)
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.assertLess(len(encoded), app_v18.PUBLIC_RESULT_BUDGET_BYTES)
        self.assertNotIn("acceptedLandmarks", payload)
        self.assertNotIn("rejectedLandmarks", payload)
        self.assertNotIn("initialAttempt", payload["analysis"].get("diagnostics", {}))
        self.assertNotIn("finalAttempt", payload["analysis"].get("diagnostics", {}))
        self.assertFalse(any(path.endswith(".npy") for path in payload["assets"]["renders"]))

    def test_cleanup_keeps_writing_run_during_grace_and_removes_abandoned(self):
        run = app_v18.v32.RUN_CACHE_ROOT / ("b" * 32)
        run.mkdir()
        app_v18.v32._cleanup_expired_runs()
        self.assertTrue(run.exists())
        old = time.time() - app_v18.v32.INCOMPLETE_RUN_GRACE_SECONDS - 5
        os.utime(run, (old, old))
        app_v18.v32._cleanup_expired_runs()
        self.assertFalse(run.exists())

    def test_result_without_commit_marker_is_retryable_503(self):
        run_id = "c" * 32
        run = app_v18.v32.RUN_CACHE_ROOT / run_id
        run.mkdir()
        with self.assertRaises(app_v18.HTTPException) as captured:
            app_v18.avatar_analyze_v4_result(run_id)
        self.assertEqual(captured.exception.status_code, 503)
        self.assertEqual(captured.exception.detail["code"], "ANALYZER_RESULT_STILL_PERSISTING")
        self.assertEqual(captured.exception.headers["Retry-After"], str(app_v18.RESULT_RETRY_AFTER_SECONDS))


if __name__ == "__main__":
    unittest.main()
''')

replace_once(
    "worker/garment-rig/Dockerfile",
    '    && test -f /app/test_worker_api_v4.py \\\n',
    '    && test -f /app/test_worker_api_v4.py \\\n    && test -f /app/test_avatar_analyzer_v4_persistence.py \\\n',
)
replace_once(
    "worker/garment-rig/Dockerfile",
    'RUN cd /app && python3 -m unittest -v test_avatar_analyzer_v4_contract.py test_avatar_analyzer_v41.py test_analysis_glb_sanitizer.py\n',
    'RUN cd /app && python3 -m unittest -v test_avatar_analyzer_v4_contract.py test_avatar_analyzer_v41.py test_analysis_glb_sanitizer.py test_avatar_analyzer_v4_persistence.py\n',
)

package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
package["scripts"]["test:avatar-analyzer:python"] = "cd worker/garment-rig && python -m unittest test_avatar_analyzer_v4_contract.py test_avatar_analyzer_v41.py test_avatar_analyzer_v4_persistence.py"
(ROOT / "package.json").write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "tests-avatar-analyzer-v4.mjs",
    '  assert.match(source, /partial-/);\n',
    '  assert.match(source, /clouva-run-staging-/);\n  assert.match(source, /ANALYZER_RESULT_STILL_PERSISTING/);\n  assert.match(source, /PUBLIC_RESULT_BUDGET_BYTES/);\n  assert.doesNotMatch(source, /"acceptedLandmarks": accepted/);\n  assert.doesNotMatch(source, /"rejectedLandmarks": rejected/);\n',
)

backend_test = r'''

test("Avatar Analyzer preserves retryable HTTP states and pending jobs across devices", () => {
  const resultRoute = read("./app/api/avatar/analyze/result/[runId]/route.ts");
  const kickoff = read("./app/api/avatar/analyze/route.ts");
  const job = read("./app/api/avatar/analyze/job/[jobId]/route.ts");
  const latest = read("./app/api/avatar/analyze/latest/route.ts");
  const shared = read("./app/api/avatar/analyze/_shared.ts");
  assert.match(resultRoute, /FORWARDED_WORKER_STATUSES/);
  assert.match(resultRoute, /Retry-After/);
  assert.match(resultRoute, /ANALYZER_RESULT_INVALID_JSON/);
  assert.match(kickoff, /persistPendingAnalyzerJob/);
  assert.match(job, /persistCompletedAnalyzerJob/);
  assert.match(job, /findAvatarForAnalyzerJob/);
  assert.match(latest, /pendingStatus/);
  assert.match(shared, /METADATA_UPDATE_ATTEMPTS/);
  assert.match(shared, /avatar_analyzer_v4_pending/);
});
'''
with (ROOT / "tests-avatar-analyzer-v4.mjs").open("a", encoding="utf-8") as handle:
    handle.write(backend_test)

print("Avatar Analyzer backend hardening applied")
