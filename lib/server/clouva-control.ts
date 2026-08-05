import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export type AdminIdentity = {
  user: User;
  role: "admin";
  client: SupabaseClient;
};

function supabaseUrl() {
  const value = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  return value;
}

function supabasePublicKey() {
  const value =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error("Missing Supabase publishable key");
  return value;
}

function bearerToken(request: NextRequest) {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}

function createUserScopedClient(token: string) {
  return createClient(supabaseUrl(), supabasePublicKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function requireClouvaControlAdmin(request: NextRequest): Promise<AdminIdentity> {
  const token = bearerToken(request);
  if (!token) throw Object.assign(new Error("Sesión requerida"), { status: 401 });

  const client = createUserScopedClient(token);
  const userResult = await client.auth.getUser(token);
  if (userResult.error || !userResult.data.user) {
    throw Object.assign(new Error("Sesión inválida"), { status: 401 });
  }

  const adminResult = await client.rpc("clouva_control_is_admin");
  if (adminResult.error) {
    throw Object.assign(new Error(adminResult.error.message), { status: 500 });
  }
  if (adminResult.data !== true) {
    throw Object.assign(new Error("Acceso administrativo requerido"), { status: 403 });
  }

  return { user: userResult.data.user, role: "admin", client };
}

export async function writeClouvaControlAudit(
  identity: AdminIdentity,
  action: string,
  module: string,
  target?: { type?: string | null; id?: string | null },
  metadata?: Record<string, unknown>,
) {
  const result = await identity.client.from("admin_audit_logs").insert({
    admin_user_id: identity.user.id,
    action,
    module,
    target_type: target?.type ?? null,
    target_id: target?.id ?? null,
    metadata: metadata ?? {},
  });
  if (result.error) console.error("CLOUVA CONTROL audit failed", result.error);
}

export function apiError(error: unknown) {
  let status = 500;
  if (typeof error === "object" && error !== null && "status" in error) {
    const candidate = (error as { status?: unknown }).status;
    if (typeof candidate === "number") status = candidate;
  }
  const message = error instanceof Error ? error.message : "Error interno";
  return Response.json({ error: message }, { status });
}

export type UnifiedProcess = {
  id: string;
  source: string;
  label: string;
  status: string;
  progress: number | null;
  userId: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ProcessRpcRow = {
  id?: unknown;
  source?: unknown;
  label?: unknown;
  status?: unknown;
  progress?: unknown;
  user_id?: unknown;
  error?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

function rowToProcess(row: ProcessRpcRow): UnifiedProcess {
  return {
    id: String(row.id ?? ""),
    source: String(row.source ?? "unknown"),
    label: String(row.label ?? "Proceso"),
    status: String(row.status ?? "unknown"),
    progress: typeof row.progress === "number" ? row.progress : row.progress == null ? null : Number(row.progress),
    userId: row.user_id ? String(row.user_id) : null,
    error: row.error ? String(row.error) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function collectClouvaProcesses(client: SupabaseClient, limitPerSource = 15) {
  const result = await client.rpc("clouva_control_processes", { limit_per_source: limitPerSource });
  if (result.error) throw new Error(result.error.message);
  if (!Array.isArray(result.data)) return [] as UnifiedProcess[];
  return (result.data as ProcessRpcRow[]).map(rowToProcess);
}
