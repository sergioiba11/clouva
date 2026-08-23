import type { NextRequest } from "next/server";
import { normalizeRole } from "@/lib/auth";
import { createAdminSupabase, requireUser } from "@/lib/server/supabase";

export class MediaApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "media_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function requireMediaAdmin(request: NextRequest) {
  let authenticated: Awaited<ReturnType<typeof requireUser>>;
  try {
    authenticated = await requireUser(request);
  } catch (error) {
    throw new MediaApiError(error instanceof Error ? error.message : "Sesión requerida.", 401, "auth_required");
  }

  const admin = createAdminSupabase();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role, role_v2")
    .eq("id", authenticated.user.id)
    .maybeSingle();

  if (error) throw new MediaApiError("No se pudieron comprobar tus permisos.", 500, "permission_check_failed");

  const configuredEmails = new Set(
    (process.env.CLOUVA_ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const email = authenticated.user.email?.trim().toLowerCase() ?? "";
  const isAdmin = normalizeRole(profile?.role ?? profile?.role_v2) === "admin" || configuredEmails.has(email);
  if (!isAdmin) throw new MediaApiError("Esta herramienta está habilitada para administradores.", 403, "admin_required");

  return { admin, user: authenticated.user, accessToken: authenticated.accessToken };
}

export function publicMediaError(error: unknown) {
  if (error instanceof MediaApiError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }

  const message = error instanceof Error ? error.message : "No se pudo completar la operación.";
  if (/abort|timeout|timed out/i.test(message)) {
    return { status: 504, body: { error: "La generación superó el tiempo de espera.", code: "provider_timeout" } };
  }
  if (/quota|resource exhausted|rate limit/i.test(message)) {
    return { status: 429, body: { error: "La cuota del generador está agotada.", code: "provider_quota" } };
  }
  if (/billing|paid tier|payment/i.test(message)) {
    return { status: 402, body: { error: "La facturación de generación no está habilitada.", code: "billing_required" } };
  }
  if (/safety|blocked|content|policy/i.test(message)) {
    return { status: 422, body: { error: "El contenido no pudo procesarse con las políticas del generador.", code: "content_rejected" } };
  }
  if (/model.*not found|not available|unsupported model/i.test(message)) {
    return { status: 422, body: { error: "El modelo seleccionado no está disponible para este proyecto.", code: "model_unavailable" } };
  }

  const isGeminiImageError = error instanceof Error && (
    error.name === "GeminiImageError" || error.constructor?.name === "GeminiImageError"
  );
  if (isGeminiImageError) {
    const providerStatus = typeof (error as Error & { status?: unknown }).status === "number"
      ? (error as Error & { status: number }).status
      : 502;
    const safeStatus = providerStatus >= 400 && providerStatus <= 599 ? providerStatus : 502;
    return { status: safeStatus, body: { error: message.slice(0, 300), code: "gemini_image_error" } };
  }

  return { status: 500, body: { error: "La generación no pudo completarse.", code: "generation_failed" } };
}
