import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DERIVED_RIG_PATTERN = /(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)/i;

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
    if (parts.length) return parts.join(" · ");
  }
  return "No se pudo analizar el avatar";
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

async function requireUser(request: NextRequest) {
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

async function resolveOriginalAvatar(
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
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};
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

function decodeAnalysisSummary(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function workerError(raw: string) {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.detail ?? parsed.error ?? parsed.message;
    return typeof value === "string" ? value : JSON.stringify(value ?? parsed);
  } catch {
    return raw;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const avatar = await resolveOriginalAvatar(supabase, user.id);
    const workerBaseUrl = (process.env.BLENDER_WORKER_URL || process.env.GARMENT_RIG_WORKER_URL)?.replace(/\/+$/, "");
    const workerToken = process.env.BLENDER_WORKER_TOKEN || process.env.GARMENT_RIG_WORKER_TOKEN;
    if (!workerBaseUrl) throw new Error("Falta configurar BLENDER_WORKER_URL");

    const response = await fetch(`${workerBaseUrl}/avatar/analyze-v4-preview`, {
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
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`Blender no pudo analizar el avatar (${response.status})${raw ? `: ${workerError(raw).slice(0, 1200)}` : ""}`);
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength < 1024 || Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
      throw new Error("El Worker no devolvió un GLB diagnóstico válido");
    }

    const summaryHeader = response.headers.get("x-clouva-analysis-summary");
    const summary = decodeAnalysisSummary(summaryHeader);
    const runId = String(summary?.runId ?? response.headers.get("x-clouva-analysis-run-id") ?? "");
    if (avatar.avatarId && /^[a-f0-9]{32}$/.test(runId)) {
      const { error: metadataError } = await supabase
        .from("user_avatars")
        .update({
          metadata: {
            ...avatar.metadata,
            avatar_analyzer_v4: {
              runId,
              analyzerVersion: String(summary?.analyzerVersion ?? "clouva-avatar-analyzer-v4.1"),
              mapVersion: "clouva-anatomical-map-v4.1",
              sourceSha256: String(summary?.sourceSha256 ?? ""),
              status: String(summary?.status ?? "needs_review"),
              requestedRigProfile: String(summary?.requestedRigProfile ?? "BODY_BASIC"),
              updatedAt: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", avatar.avatarId)
        .eq("user_id", user.id);
      if (metadataError) {
        console.error("Avatar Analyzer V4 metadata persistence failed", metadataError);
      }
    }

    const headers = new Headers({
      "Content-Type": "model/gltf-binary",
      "Content-Disposition": 'inline; filename="clouva-avatar-diagnostic-v4.glb"',
      "Cache-Control": "no-store",
    });
    for (const name of [
      "x-clouva-avatar-analyzer-version",
      "x-clouva-map-version",
      "x-clouva-analysis-status",
      "x-clouva-analysis-run-id",
      "x-clouva-analysis-summary",
      "x-clouva-face-analysis",
      "x-clouva-left-hand-analysis",
      "x-clouva-right-hand-analysis",
      "x-clouva-requested-rig-profile",
      "x-clouva-supported-rig-profiles",
      "x-clouva-rig-readiness",
      "x-clouva-rig-readiness-approved",
      "x-clouva-rig-modified",
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(bytes, { status: 200, headers });
  } catch (cause) {
    console.error("Avatar Analyzer preview failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
