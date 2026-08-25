import type { NextRequest } from "next/server";
import { CLOUVA_FLOWS, CLOUVA_SCREENS, PREVIEW_PERSONAS } from "@/lib/clouva-control/screens";
import {
  apiError,
  buildActivity,
  collectClouvaProcesses,
  groupControlIncidents,
  requireClouvaControlAdmin,
  type UnifiedProcess,
} from "@/lib/server/clouva-control";

export const dynamic = "force-dynamic";

type CommerceRpc = {
  available?: unknown;
  approvedPaymentsToday?: unknown;
  pendingPayments?: unknown;
  refundsToday?: unknown;
  physicalOrdersToday?: unknown;
  digitalDeliveriesToday?: unknown;
  recentOrders?: unknown;
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function commercePayload(value: unknown) {
  const raw = value && typeof value === "object" ? value as CommerceRpc : {};
  const recentOrders = Array.isArray(raw.recentOrders)
    ? raw.recentOrders.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object").map((row) => ({
        id: String(row.id ?? ""),
        orderNumber: row.orderNumber ? String(row.orderNumber) : null,
        total: number(row.total),
        currency: String(row.currency ?? "ARS"),
        paymentStatus: String(row.paymentStatus ?? "unknown"),
        shippingStatus: String(row.shippingStatus ?? "unknown"),
        status: String(row.status ?? "unknown"),
        createdAt: String(row.createdAt ?? new Date(0).toISOString()),
        paidAt: row.paidAt ? String(row.paidAt) : null,
      }))
    : [];

  return {
    available: raw.available === true,
    approvedPaymentsToday: number(raw.approvedPaymentsToday),
    pendingPayments: number(raw.pendingPayments),
    refundsToday: number(raw.refundsToday),
    physicalOrdersToday: number(raw.physicalOrdersToday),
    digitalDeliveriesToday: number(raw.digitalDeliveriesToday),
    recentOrders,
  };
}

function latestOf(processes: UnifiedProcess[], sources: string[]) {
  return processes
    .filter((process) => sources.includes(process.source))
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
}

function serviceFromProcesses(
  now: string,
  processes: UnifiedProcess[],
  config: { id: string; name: string; sources: string[]; dependents: string[]; emptyDetail: string },
) {
  const relevant = processes.filter((process) => config.sources.includes(process.source));
  const latest = latestOf(processes, config.sources);
  const recentErrors = relevant.filter((process) => process.activityState !== "history" && process.normalizedStatus === "failed").length;
  const recentSuccess = relevant.find((process) => process.activityState !== "history" && ["completed", "healthy"].includes(process.normalizedStatus));

  if (recentErrors > 0) {
    return {
      id: config.id,
      name: config.name,
      status: "attention" as const,
      detail: `${recentErrors} operación${recentErrors === 1 ? "" : "es"} reciente${recentErrors === 1 ? "" : "s"} necesita${recentErrors === 1 ? "" : "n"} atención.`,
      lastCheckedAt: now,
      lastSuccessAt: recentSuccess?.updatedAt ?? recentSuccess?.completedAt ?? null,
      recentErrors,
      dependents: config.dependents,
      verification: "activity" as const,
    };
  }

  if (latest) {
    return {
      id: config.id,
      name: config.name,
      status: "healthy" as const,
      detail: `Actividad real detectada: ${latest.humanMessage}`,
      lastCheckedAt: now,
      lastSuccessAt: recentSuccess?.updatedAt ?? recentSuccess?.completedAt ?? latest.updatedAt ?? latest.createdAt,
      recentErrors: 0,
      dependents: config.dependents,
      verification: "activity" as const,
    };
  }

  return {
    id: config.id,
    name: config.name,
    status: "unknown" as const,
    detail: config.emptyDetail,
    lastCheckedAt: now,
    lastSuccessAt: null,
    recentErrors: 0,
    dependents: config.dependents,
    verification: "not_checked" as const,
  };
}

function buildServices(now: string, processes: UnifiedProcess[]) {
  return [
    {
      id: "supabase-auth",
      name: "Supabase Auth",
      status: "healthy" as const,
      detail: "La sesión administrativa fue validada directamente.",
      lastCheckedAt: now,
      lastSuccessAt: now,
      recentErrors: 0,
      dependents: ["Login", "Sesiones", "Permisos"],
      verification: "direct" as const,
    },
    {
      id: "supabase-db",
      name: "Supabase Database",
      status: "healthy" as const,
      detail: "Las consultas operativas respondieron correctamente.",
      lastCheckedAt: now,
      lastSuccessAt: now,
      recentErrors: 0,
      dependents: ["Players", "Estudios", "Procesos", "Pedidos"],
      verification: "direct" as const,
    },
    {
      id: "supabase-storage",
      name: "Supabase Storage",
      status: "unknown" as const,
      detail: "Esta consulta no realiza una escritura o descarga de prueba.",
      lastCheckedAt: now,
      lastSuccessAt: null,
      recentErrors: 0,
      dependents: ["Avatares", "Merch 3D", "Capturas", "APK"],
      verification: "not_checked" as const,
    },
    {
      id: "supabase-realtime",
      name: "Supabase Realtime",
      status: "unknown" as const,
      detail: "El APK valida este canal al abrir la aplicación.",
      lastCheckedAt: now,
      lastSuccessAt: null,
      recentErrors: 0,
      dependents: ["Actividad en vivo", "Procesos", "Problemas"],
      verification: "not_checked" as const,
    },
    serviceFromProcesses(now, processes, {
      id: "mercado-pago",
      name: "Mercado Pago",
      sources: ["billing_payments", "billing_subscriptions", "store_orders"],
      dependents: ["Pagos", "Suscripciones", "Tienda", "Pedidos físicos"],
      emptyDetail: "No hubo actividad reciente suficiente para verificarlo.",
    }),
    serviceFromProcesses(now, processes, {
      id: "gemini",
      name: "Gemini",
      sources: ["ai_image_generation_jobs", "vip_profile_generation_jobs"],
      dependents: ["Identidad VIP", "Generación visual", "Estudios"],
      emptyDetail: "No hubo una generación reciente para verificarlo por actividad.",
    }),
    serviceFromProcesses(now, processes, {
      id: "meshy",
      name: "Meshy",
      sources: ["meshy_jobs", "asset_generation_jobs"],
      dependents: ["Creator Studio", "Merch 3D", "Avatares"],
      emptyDetail: "Todavía no existe una comprobación directa dentro de CLOUVA CONTROL.",
    }),
    serviceFromProcesses(now, processes, {
      id: "blender-worker",
      name: "Blender Worker",
      sources: ["rig_jobs", "avatar_analyzer_jobs"],
      dependents: ["Analizador", "Rig", "Adaptación de prendas"],
      emptyDetail: "No hubo actividad reciente suficiente para verificar el worker.",
    }),
    {
      id: "cloud-run-web",
      name: "Cloud Run / API CLOUVA",
      status: "healthy" as const,
      detail: "La API de CLOUVA CONTROL respondió esta solicitud.",
      lastCheckedAt: now,
      lastSuccessAt: now,
      recentErrors: 0,
      dependents: ["APK", "Web", "APIs administrativas"],
      verification: "direct" as const,
    },
    {
      id: "cloud-run-workers",
      name: "Cloud Run Workers",
      status: "unknown" as const,
      detail: "No se ejecutó una sonda directa a los workers de este proyecto.",
      lastCheckedAt: now,
      lastSuccessAt: null,
      recentErrors: 0,
      dependents: ["Blender Worker", "Analyzer"],
      verification: "not_checked" as const,
    },
    {
      id: "google-cloud",
      name: "Google Cloud Platform",
      status: "unknown" as const,
      detail: "No se ejecutó una sonda directa al proyecto.",
      lastCheckedAt: now,
      lastSuccessAt: null,
      recentErrors: 0,
      dependents: ["Infraestructura", "IA", "Servicios"],
      verification: "not_checked" as const,
    },
    {
      id: "notifications",
      name: "Notificaciones",
      status: "unknown" as const,
      detail: "No se envió una notificación de prueba.",
      lastCheckedAt: now,
      lastSuccessAt: null,
      recentErrors: 0,
      dependents: ["Pedidos", "Procesos", "Alertas"],
      verification: "not_checked" as const,
    },
    {
      id: "email",
      name: "Sistema de correo",
      status: "unknown" as const,
      detail: "No se envió un correo de prueba.",
      lastCheckedAt: now,
      lastSuccessAt: null,
      recentErrors: 0,
      dependents: ["Registro", "Pedidos", "Recuperación"],
      verification: "not_checked" as const,
    },
  ];
}

export async function GET(request: NextRequest) {
  try {
    const identity = await requireClouvaControlAdmin(request);
    const generatedAt = new Date().toISOString();

    const [issuesResult, releasesResult, processes, commerceResult] = await Promise.all([
      identity.client
        .from("admin_mobile_issues")
        .select("id,title,description,module,route,preview_persona,status,priority,screenshot_path,device_model,resolution,app_version,web_version,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(150),
      identity.client
        .from("mobile_app_releases")
        .select("id,app_name,platform,version,build_number,file_size,checksum,release_notes,is_stable,minimum_required,created_at,published_at")
        .eq("platform", "android")
        .order("created_at", { ascending: false })
        .limit(30),
      collectClouvaProcesses(identity.client),
      identity.client.rpc("clouva_control_commerce_summary"),
    ]);

    if (issuesResult.error) throw issuesResult.error;
    if (releasesResult.error) throw releasesResult.error;

    const issues = issuesResult.data ?? [];
    const incidents = groupControlIncidents(processes);
    const activity = buildActivity(processes);
    const services = buildServices(generatedAt, processes);
    const commerce = commerceResult.error
      ? commercePayload(null)
      : commercePayload(commerceResult.data);

    const openIssues = issues.filter((issue) => issue.status !== "resuelto");
    const activeProcesses = processes.filter((process) => process.activityState === "now" && process.normalizedStatus === "running").length;
    const attentionCategories = new Set([
      ...incidents.map((incident) => incident.category),
      ...openIssues.map((issue) => issue.module).filter((value): value is string => Boolean(value)),
      ...processes
        .filter((process) => process.activityState === "now" && ["attention", "failed"].includes(process.normalizedStatus))
        .map((process) => process.category),
    ]);
    const systemNames = new Set([
      ...CLOUVA_SCREENS.map((screen) => screen.module),
      ...processes.map((process) => process.category),
    ]);
    const critical = incidents.some((incident) => incident.severity === "critical" && incident.lastSeen && Date.now() - Date.parse(incident.lastSeen) < 24 * 60 * 60 * 1000)
      || openIssues.some((issue) => issue.priority === "critica");
    const attention = critical || attentionCategories.size > 0;
    const totalSystems = systemNames.size;
    const attentionSystems = Math.min(totalSystems, attentionCategories.size);

    return Response.json({
      generatedAt,
      admin: { id: identity.user.id, email: identity.user.email ?? null, role: identity.role },
      screens: CLOUVA_SCREENS,
      flows: CLOUVA_FLOWS,
      personas: PREVIEW_PERSONAS,
      issues,
      incidents,
      processes,
      activity,
      services,
      commerce,
      control: {
        status: critical ? "critical" : attention ? "attention" : "operational",
        headline: critical ? "CLOUVA necesita una acción" : attention ? "CLOUVA está operativa con puntos para revisar" : "CLOUVA está operativa",
        totalSystems,
        healthySystems: Math.max(0, totalSystems - attentionSystems),
        attentionSystems,
        activeProcesses,
        openProblems: incidents.length + openIssues.length,
        screenCount: CLOUVA_SCREENS.length,
        processCount: processes.length,
      },
      releases: releasesResult.data ?? [],
    });
  } catch (error) {
    return apiError(error);
  }
}
