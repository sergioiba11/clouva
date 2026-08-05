import "react-native-url-polyfill/auto";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { createClient, type Session } from "@supabase/supabase-js";
import { Dimensions, Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;
export const API_URL = (extra.clouvaApiUrl ?? "https://clouva.com.ar").replace(/\/$/, "");
const SUPABASE_URL = extra.supabaseUrl ?? "";
const SUPABASE_KEY = extra.supabasePublishableKey ?? "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("CLOUVA CONTROL no recibió la configuración pública de Supabase");
}

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Google Identity Services already works on clouva.com.ar. The native app uses
// that verified web origin as an authentication bridge and receives the
// resulting Supabase session through the registered clouvacontrol:// scheme.
const originalSignInWithOAuth = supabaseClient.auth.signInWithOAuth.bind(supabaseClient.auth);
supabaseClient.auth.signInWithOAuth = async (credentials) => {
  if (credentials.provider === "google") {
    return {
      data: {
        provider: "google",
        url: `${API_URL}/auth/clouva-control-login`,
      },
      error: null,
    };
  }
  return originalSignInWithOAuth(credentials);
};

export const supabase = supabaseClient;

export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

export type PreviewPersona =
  | "visitante"
  | "usuario_nuevo"
  | "free"
  | "vip"
  | "creador"
  | "miembro_estudio"
  | "manager_estudio"
  | "owner_estudio"
  | "admin";

export type NormalizedStatus =
  | "healthy"
  | "running"
  | "attention"
  | "failed"
  | "completed"
  | "cancelled"
  | "unknown";

export type ActivityState = "now" | "recent" | "history";

export type ScreenDefinition = {
  id: string;
  name: string;
  route: string;
  module: string;
  status: string;
  allowedRoles: string[];
  previewStates: PreviewPersona[];
  entryPoints: string[];
  exits: string[];
  enabled: boolean;
};

export type FlowDefinition = {
  id: string;
  name: string;
  description: string;
  steps: Array<{ label: string; route: string; expected: string }>;
};

export type ProcessRow = {
  id: string;
  source: string;
  category: string;
  label: string;
  description: string;
  status: string;
  normalizedStatus: NormalizedStatus;
  activityState: ActivityState;
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

export type IssueRow = {
  id: string;
  title: string;
  description: string | null;
  module: string | null;
  route: string | null;
  preview_persona: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at?: string | null;
};

export type IncidentRow = {
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

export type ActivityEvent = {
  id: string;
  title: string;
  detail: string;
  category: string;
  status: NormalizedStatus;
  occurredAt: string | null;
  route: string | null;
};

export type ServiceHealth = {
  id: string;
  name: string;
  status: "healthy" | "attention" | "unknown";
  detail: string;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  recentErrors: number;
  dependents: string[];
  verification: "direct" | "activity" | "not_checked";
};

export type CommerceOrder = {
  id: string;
  orderNumber: string | null;
  total: number;
  currency: string;
  paymentStatus: string;
  shippingStatus: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
};

export type CommerceSummary = {
  available: boolean;
  approvedPaymentsToday: number;
  pendingPayments: number;
  refundsToday: number;
  physicalOrdersToday: number;
  digitalDeliveriesToday: number;
  recentOrders: CommerceOrder[];
};

export type ControlSummary = {
  status: "operational" | "attention" | "critical";
  headline: string;
  totalSystems: number;
  healthySystems: number;
  attentionSystems: number;
  activeProcesses: number;
  openProblems: number;
  screenCount: number;
  processCount: number;
};

export type ReleaseRow = {
  id: string;
  app_name: string;
  version: string;
  build_number: number;
  file_size: number | null;
  checksum: string;
  release_notes: string | null;
  is_stable: boolean;
  minimum_required: string | null;
  created_at: string;
  published_at: string | null;
};

export type Overview = {
  generatedAt: string;
  screens: ScreenDefinition[];
  flows: FlowDefinition[];
  personas: Array<{ id: PreviewPersona; label: string }>;
  issues: IssueRow[];
  incidents: IncidentRow[];
  processes: ProcessRow[];
  activity: ActivityEvent[];
  services: ServiceHealth[];
  commerce: CommerceSummary;
  control: ControlSummary;
  releases: ReleaseRow[];
};

async function token() {
  const result = await supabase.auth.getSession();
  return result.data.session?.access_token ?? null;
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await token();
  if (!accessToken) throw new AdminApiError("La sesión administrativa no está activa", 401);
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AdminApiError(payload.error ?? `Error ${response.status}`, response.status);
  return payload as T;
}

export function previewUrl(session: Session | null, route: string, persona: PreviewPersona) {
  const next = route.startsWith("/") && !route.startsWith("//") ? route : "/matrix";
  const base = `${API_URL}/auth/mobile-preview?next=${encodeURIComponent(next)}&persona=${encodeURIComponent(persona)}`;
  if (persona === "visitante" || !session) return base;
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  return `${base}#${hash.toString()}`;
}

export function deviceEvidence() {
  const viewport = Dimensions.get("window");
  return {
    deviceModel: Device.modelName ?? Device.deviceName ?? "Android",
    resolution: `${Math.round(viewport.width)}x${Math.round(viewport.height)}@${viewport.scale}`,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "dev",
    platform: Platform.OS,
  };
}

export function compareVersions(left: string | null | undefined, right: string | null | undefined) {
  const a = String(left ?? "0").split(".").map((value) => Number(value.replace(/\D.*$/, "")) || 0);
  const b = String(right ?? "0").split(".").map((value) => Number(value.replace(/\D.*$/, "")) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export async function downloadAndInstallRelease(release: ReleaseRow) {
  const result = await adminFetch<{ signedUrl: string }>(`/api/admin/clouva-control/releases/${release.id}/download`, { method: "POST" });
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!directory) throw new Error("Android no entregó una carpeta de descarga");
  const destination = `${directory}clouva-control-${release.version}.apk`;
  const downloaded = await FileSystem.downloadAsync(result.signedUrl, destination);
  if (downloaded.status < 200 || downloaded.status >= 300) throw new Error(`La descarga respondió ${downloaded.status}`);
  const contentUri = await FileSystem.getContentUriAsync(downloaded.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
}
