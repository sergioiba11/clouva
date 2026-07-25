import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DERIVED_RIG_PATTERN = /(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)/i;

type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  error?: unknown;
};

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

export function workerError(raw: string) {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed.detail ?? parsed.error ?? parsed.message;
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
