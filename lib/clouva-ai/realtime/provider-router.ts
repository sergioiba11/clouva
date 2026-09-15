import { ClouvaRealtimeProvider } from "./clouva-realtime-provider";
import { GeminiRealtimeProvider } from "./gemini-realtime-provider";
import type { RealtimeProvider, RealtimeProviderId, RealtimeSessionRequest } from "./types";

function configuredProvider(): RealtimeProviderId {
  const value = process.env.CLOUVA_REALTIME_PROVIDER?.trim().toLowerCase() || "gemini";
  if (value !== "gemini" && value !== "clouva") throw new Error(`CLOUVA_REALTIME_PROVIDER '${value}' no está soportado.`);
  return value;
}

function createProvider(id: RealtimeProviderId): RealtimeProvider {
  return id === "clouva" ? new ClouvaRealtimeProvider() : new GeminiRealtimeProvider();
}

export async function createRealtimeSession(request: RealtimeSessionRequest) {
  const primary = configuredProvider();
  const fallbackRaw = process.env.CLOUVA_REALTIME_FALLBACK_PROVIDER?.trim().toLowerCase();
  const fallback = fallbackRaw === "gemini" || fallbackRaw === "clouva" ? fallbackRaw as RealtimeProviderId : null;
  const candidates = Array.from(new Set([primary, fallback].filter(Boolean) as RealtimeProviderId[]));
  let lastError: unknown = new Error("No hay provider realtime disponible.");
  for (const id of candidates) {
    try { return await createProvider(id).createSession(request); }
    catch (error) { lastError = error; }
  }
  throw lastError;
}
