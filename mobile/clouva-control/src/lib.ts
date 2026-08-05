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

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL || "https://placeholder.supabase.co", SUPABASE_KEY || "placeholder", {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export type PreviewPersona = "visitante" | "usuario_nuevo" | "free" | "vip" | "creador" | "miembro_estudio" | "manager_estudio" | "owner_estudio" | "admin";

export type ScreenDefinition = {
  id: string;
  name: string;
  route: string;
  module: string;
  status: string;
  allowedRoles: string[];
  previewStates: PreviewPersona[];
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
  label: string;
  status: string;
  progress: number | null;
  userId: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
  processes: ProcessRow[];
  releases: ReleaseRow[];
};

async function token() {
  const result = await supabase.auth.getSession();
  return result.data.session?.access_token ?? null;
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = await token();
  if (!accessToken) throw new Error("La sesión administrativa no está activa");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Error ${response.status}`);
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
