import { createHash } from "node:crypto";
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

export type NormalizedStatus =
  | "healthy"
  | "running"
  | "attention"
  | "failed"
  | "completed"
  | "cancelled"
  | "unknown";

export type UnifiedProcess = {
  id: string;
  source: string;
  category: string;
  label: string;
  description: string;
  status: string;
  normalizedStatus: NormalizedStatus;
  activityState: "now" | "recent" | "history";
  progress: number | null;
  currentStage: string | null;
  userId: string | null;
  resourceId: string | null;
  affectedArea: string | null;
  route: string | null;
  humanMessage: string;
  technicalMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  availableActions: string[];
};

export type ControlIncident = {
  fingerprint: string;
  title: string;
  summary: string;
  category: string;
  source: string;
  severity: "critical" | "attention" | "informative";
  count: number;
  firstSeen: string | null;
  lastSeen: string | null;
  affectedIds: string[];
  affectedUsers: string[];
  route: string | null;
  technicalMessage: string | null;
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
  completed_at?: unknown;
};

const RUNNING_STATUSES = new Set([
  "processing",
  "running",
  "queued",
  "in_progress",
  "analyzing",
  "generating",
  "classifying_reference",
  "generating_variants",
  "generating_variant_assets",
  "generating_assets",
]);
const COMPLETED_STATUSES = new Set([
  "completed",
  "complete",
  "approved",
  "paid",
  "pagado",
  "delivered",
  "entregado",
  "success",
  "succeeded",
]);
const ATTENTION_STATUSES = new Set([
  "pending",
  "pendiente",
  "review_ready",
  "awaiting_variant_selection",
  "requires_action",
  "confirmed",
  "confirmado",
]);
const FAILED_STATUSES = new Set([
  "failed",
  "error",
  "rejected",
  "rechazado",
  "payment_failed",
  "checkout_error",
]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "cancelado"]);

function normalizedStatus(status: string): NormalizedStatus {
  const value = status.trim().toLowerCase();
  if (FAILED_STATUSES.has(value) || value.includes("fail") || value.includes("error")) return "failed";
  if (CANCELLED_STATUSES.has(value) || value.includes("cancel")) return "cancelled";
  if (RUNNING_STATUSES.has(value) || value.includes("processing") || value.includes("progress")) return "running";
  if (COMPLETED_STATUSES.has(value)) return "completed";
  if (ATTENTION_STATUSES.has(value) || value.includes("review")) return "attention";
  if (value === "active" || value === "activo") return "healthy";
  return "unknown";
}

function sourcePresentation(source: string) {
  switch (source) {
    case "avatar_analyzer_jobs":
      return { category: "Avatar", description: "Análisis corporal y diagnóstico del avatar.", route: "/avatar-analyzer-v4", area: "Avatar y Creator Studio" };
    case "ai_image_generation_jobs":
      return { category: "IA", description: "Generación de recursos visuales con inteligencia artificial.", route: "/creator-studio", area: "Creator Studio" };
    case "vip_profile_generation_jobs":
      return { category: "Identidad VIP", description: "Generación de identidad y diseño VIP.", route: "/profile/edit", area: "Players e identidad VIP" };
    case "social_import_sessions":
      return { category: "Importaciones", description: "Importación de información y contenido social.", route: "/profile/edit", area: "Players" };
    case "billing_payments":
      return { category: "Pagos", description: "Confirmación y seguimiento de pagos.", route: "/vip", area: "Pagos" };
    case "billing_subscriptions":
      return { category: "Suscripciones", description: "Altas, renovaciones y estados de membresía.", route: "/vip", area: "Suscripciones" };
    case "service_orders":
      return { category: "Servicios", description: "Órdenes de servicios contratados dentro de CLOUVA.", route: "/studio-dashboard", area: "Servicios" };
    case "store_orders":
      return { category: "Pedidos físicos", description: "Pago, preparación y envío de merch físico.", route: "/tienda", area: "Marketplace" };
    default:
      return { category: "Sistema", description: "Proceso interno de CLOUVA.", route: null, area: "Sistema" };
  }
}

function humanMessage(source: string, status: string, state: NormalizedStatus, technical: string | null) {
  const lowerTechnical = technical?.toLowerCase() ?? "";
  if (source === "vip_profile_generation_jobs" && lowerTechnical.includes("status_check")) {
    return "La identidad VIP terminó una etapa, pero no pudo guardar el nuevo estado.";
  }
  if (source === "avatar_analyzer_jobs") {
    if (state === "completed") return "Un avatar terminó de analizarse y su diagnóstico quedó disponible.";
    if (state === "running") return "Un avatar se está analizando ahora.";
    if (state === "cancelled") return "Un análisis de avatar fue cancelado antes de terminar.";
    if (state === "failed") return "El analizador no pudo completar un avatar.";
  }
  if (source === "vip_profile_generation_jobs") {
    if (status.toLowerCase().includes("review_ready")) return "Una identidad VIP quedó lista para revisión.";
    if (state === "running") return "CLOUVA está generando una identidad VIP.";
    if (state === "failed") return "Una identidad VIP no pudo completar su generación.";
  }
  if (source === "social_import_sessions") {
    if (state === "completed") return "Una importación social terminó correctamente.";
    if (state === "running") return "CLOUVA está importando información social.";
    if (state === "failed") return "Una importación social necesita atención.";
  }
  if (source === "billing_payments") {
    if (state === "completed") return "Un pago fue aprobado.";
    if (state === "attention") return "Un pago está esperando confirmación.";
    if (state === "failed") return "Un pago no pudo completarse.";
  }
  if (source === "billing_subscriptions") {
    if (state === "completed") return "Una suscripción quedó activa.";
    if (state === "attention") return "Una suscripción está pendiente de confirmación.";
    if (state === "failed") return "Una suscripción no pudo activarse.";
  }
  if (source === "store_orders") {
    if (status.toLowerCase().includes("entregado")) return "Un pedido físico fue entregado.";
    if (status.toLowerCase().includes("pagado")) return "Un pedido físico recibió el pago y está listo para preparar.";
    if (state === "running") return "Un pedido físico avanza por producción o envío.";
    if (state === "attention") return "Un pedido físico espera una acción.";
    if (state === "failed") return "Un pedido físico encontró un problema.";
  }
  if (state === "running") return "El proceso se está ejecutando ahora.";
  if (state === "completed") return "El proceso terminó correctamente.";
  if (state === "attention") return "El proceso requiere revisión o una confirmación.";
  if (state === "failed") return "El proceso falló y necesita atención.";
  if (state === "cancelled") return "El proceso fue cancelado.";
  return "No hay suficiente información para interpretar este estado.";
}

function currentStage(status: string) {
  return status
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseDate(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function activityState(state: NormalizedStatus, createdAt: string | null, updatedAt: string | null) {
  if (state === "running") return "now" as const;
  const latest = parseDate(updatedAt) ?? parseDate(createdAt);
  if (!latest) return "history" as const;
  const age = Date.now() - latest;
  if ((state === "attention" || state === "failed") && age <= 6 * 60 * 60 * 1000) return "now" as const;
  if (age <= 24 * 60 * 60 * 1000) return "recent" as const;
  return "history" as const;
}

function rowToProcess(row: ProcessRpcRow): UnifiedProcess {
  const id = String(row.id ?? "");
  const source = String(row.source ?? "unknown");
  const label = String(row.label ?? "Proceso");
  const status = String(row.status ?? "unknown");
  const state = normalizedStatus(status);
  const presentation = sourcePresentation(source);
  const createdAt = row.created_at ? String(row.created_at) : null;
  const updatedAt = row.updated_at ? String(row.updated_at) : null;
  const completedAt = row.completed_at ? String(row.completed_at) : state === "completed" ? updatedAt : null;
  const rawMessage = row.error ? String(row.error) : null;
  const technicalMessage = state === "failed" || state === "cancelled" || rawMessage?.toLowerCase().includes("constraint") ? rawMessage : null;

  return {
    id,
    source,
    category: presentation.category,
    label,
    description: presentation.description,
    status,
    normalizedStatus: state,
    activityState: activityState(state, createdAt, updatedAt),
    progress: typeof row.progress === "number" ? row.progress : row.progress == null ? null : Number(row.progress),
    currentStage: currentStage(status),
    userId: row.user_id ? String(row.user_id) : null,
    resourceId: id || null,
    affectedArea: presentation.area,
    route: presentation.route,
    humanMessage: humanMessage(source, status, state, rawMessage),
    technicalMessage,
    createdAt,
    updatedAt,
    completedAt,
    availableActions: ["view_details", ...(presentation.route ? ["open_area"] : [])],
  };
}

export async function collectClouvaProcesses(client: SupabaseClient, limitPerSource = 20) {
  const result = await client.rpc("clouva_control_processes", { limit_per_source: limitPerSource });
  if (result.error) throw new Error(result.error.message);
  if (!Array.isArray(result.data)) return [] as UnifiedProcess[];
  return (result.data as ProcessRpcRow[]).map(rowToProcess);
}

function incidentKey(process: UnifiedProcess) {
  const technical = process.technicalMessage?.replace(/[0-9a-f-]{20,}/gi, "<id>").trim().toLowerCase() ?? process.status.toLowerCase();
  return `${process.source}|${technical}`;
}

export function groupControlIncidents(processes: UnifiedProcess[]): ControlIncident[] {
  const groups = new Map<string, UnifiedProcess[]>();
  for (const process of processes) {
    if (!["failed", "cancelled"].includes(process.normalizedStatus)) continue;
    const key = incidentKey(process);
    groups.set(key, [...(groups.get(key) ?? []), process]);
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const first = rows[0];
      if (!first) return null;
      const dates = rows
        .map((row) => row.updatedAt ?? row.createdAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      const fingerprint = createHash("sha256").update(key).digest("hex").slice(0, 24);
      return {
        fingerprint,
        title: rows.length > 1 ? `${rows.length} procesos presentan el mismo problema` : first.humanMessage,
        summary: first.humanMessage,
        category: first.category,
        source: first.source,
        severity: first.normalizedStatus === "failed" ? "critical" as const : "attention" as const,
        count: rows.length,
        firstSeen: dates.at(0) ?? null,
        lastSeen: dates.at(-1) ?? null,
        affectedIds: rows.map((row) => row.id).filter(Boolean).slice(0, 50),
        affectedUsers: [...new Set(rows.map((row) => row.userId).filter((value): value is string => Boolean(value)))].slice(0, 50),
        route: first.route,
        technicalMessage: first.technicalMessage,
      };
    })
    .filter((value): value is ControlIncident => value !== null)
    .sort((left, right) => String(right.lastSeen ?? "").localeCompare(String(left.lastSeen ?? "")));
}

export function buildActivity(processes: UnifiedProcess[]) {
  return processes
    .filter((process) => process.activityState !== "history")
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
    .slice(0, 25)
    .map((process) => ({
      id: `${process.source}:${process.id}`,
      title: process.humanMessage,
      detail: `${process.category} · ${process.currentStage ?? process.status}`,
      category: process.category,
      status: process.normalizedStatus,
      occurredAt: process.updatedAt ?? process.createdAt,
      route: process.route,
    }));
}
