import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { normalizeRoleLoose } from "@/lib/auth";

export type AdminIdentity = {
  user: User;
  role: string;
  client: SupabaseClient;
};

function env(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function createClouvaControlAdminClient() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function bearerToken(request: NextRequest) {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}

export async function requireClouvaControlAdmin(request: NextRequest): Promise<AdminIdentity> {
  const token = bearerToken(request);
  if (!token) throw Object.assign(new Error("Sesión requerida"), { status: 401 });

  const client = createClouvaControlAdminClient();
  const userResult = await client.auth.getUser(token);
  if (userResult.error || !userResult.data.user) {
    throw Object.assign(new Error("Sesión inválida"), { status: 401 });
  }

  const profileResult = await client
    .from("profiles")
    .select("role, role_v2")
    .eq("id", userResult.data.user.id)
    .maybeSingle();

  if (profileResult.error) throw Object.assign(new Error(profileResult.error.message), { status: 500 });

  const role = normalizeRoleLoose(profileResult.data?.role_v2 ?? profileResult.data?.role);
  if (role !== "admin") throw Object.assign(new Error("Acceso administrativo requerido"), { status: 403 });

  return { user: userResult.data.user, role, client };
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
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
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

function rowToProcess(source: string, label: string, row: Record<string, unknown>): UnifiedProcess {
  return {
    id: String(row.id ?? ""),
    source,
    label,
    status: String(row.status ?? "unknown"),
    progress: typeof row.progress === "number" ? row.progress : row.progress == null ? null : Number(row.progress),
    userId: row.user_id ? String(row.user_id) : null,
    error: row.error_message ? String(row.error_message) : row.error ? String(row.error) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : row.completed_at ? String(row.completed_at) : null,
  };
}

export async function collectClouvaProcesses(client: SupabaseClient, limitPerSource = 15) {
  const sources = [
    { table: "avatar_analyzer_jobs", label: "Analizador de avatar", columns: "id,user_id,status,progress,error_message,created_at,updated_at" },
    { table: "ai_image_generation_jobs", label: "Generación de imágenes", columns: "id,status,created_at,completed_at" },
    { table: "vip_profile_generation_jobs", label: "Generación de identidad VIP", columns: "id,user_id,status,error_message,created_at,updated_at,completed_at" },
    { table: "social_import_sessions", label: "Importación social", columns: "id,user_id,status,error_message,created_at,updated_at,completed_at" },
    { table: "billing_payments", label: "Pagos", columns: "id,user_id,status,created_at,updated_at" },
    { table: "billing_subscriptions", label: "Suscripciones", columns: "id,user_id,status,created_at,updated_at" },
    { table: "service_orders", label: "Órdenes de servicios", columns: "id,user_id,status,created_at,updated_at" },
  ] as const;

  const results = await Promise.all(
    sources.map(async (source) => {
      const query = await client.from(source.table).select(source.columns).order("created_at", { ascending: false }).limit(limitPerSource);
      if (query.error) {
        console.warn(`CLOUVA CONTROL could not read ${source.table}`, query.error.message);
        return [] as UnifiedProcess[];
      }
      return (query.data ?? []).map((row) => rowToProcess(source.table, source.label, row as Record<string, unknown>));
    }),
  );

  return results.flat().sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
}
