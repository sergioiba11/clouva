import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

const RUN_ID_PATTERN = /^[a-f0-9]{32}$/;
const ASSET_PATH_PATTERN = /^[a-zA-Z0-9._/-]+$/;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAvatarAnalyzerUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Sesión requerida");
  const supabase = adminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida");
  return data.user;
}

export function avatarAnalyzerWorkerConfig() {
  const baseUrl = (process.env.BLENDER_WORKER_URL || process.env.GARMENT_RIG_WORKER_URL)?.replace(/\/+$/, "");
  const token = process.env.BLENDER_WORKER_TOKEN || process.env.GARMENT_RIG_WORKER_TOKEN;
  if (!baseUrl) throw new Error("Falta configurar BLENDER_WORKER_URL");
  return { baseUrl, token };
}

export function safeAnalyzerRunId(runId: string) {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Identificador de análisis inválido");
  return runId;
}

export function safeAnalyzerAssetPath(parts: string[]) {
  const value = parts.map((part) => decodeURIComponent(part)).join("/");
  if (!value || !ASSET_PATH_PATTERN.test(value) || value.includes("..") || value.startsWith("/")) {
    throw new Error("Ruta de diagnóstico inválida");
  }
  return value;
}

export async function fetchAvatarAnalyzerWorker(path: string, init?: RequestInit) {
  const { baseUrl, token } = avatarAnalyzerWorkerConfig();
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
}

export function avatarAnalyzerError(cause: unknown) {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "string" && cause.trim()) return cause.trim();
  return "No se pudo consultar el diagnóstico anatómico";
}
