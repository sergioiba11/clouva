import type { ClouvaAIProviderId } from "./types";
import { ProviderError } from "./errors";

const PROVIDERS = new Set<ClouvaAIProviderId>(["clouva", "gemini"]);
export const CLOUVA_AI_MODEL_COOKIE = "clouva_ai_model";
export const LEGACY_GEMINI_MODEL_COOKIE = "clouva_gemini_model";

export type ProviderConfig = {
  id: ClouvaAIProviderId;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  fallbackModel: string | null;
};

export type AIProviderConfig = {
  primary: ProviderConfig;
  fallback: ProviderConfig | null;
};

function providerId(value: string | undefined, fallback: ClouvaAIProviderId): ClouvaAIProviderId {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (!PROVIDERS.has(normalized as ClouvaAIProviderId)) {
    throw new ProviderError({
      code: "PROVIDER_UNAVAILABLE",
      provider: normalized,
      status: 500,
      retryable: false,
      message: `CLOUVA AI provider '${normalized}' no está soportado.`,
    });
  }
  return normalized as ClouvaAIProviderId;
}

function trimUrl(value: string | undefined) {
  const normalized = value?.trim().replace(/\/+$/, "") ?? "";
  return normalized || null;
}

export function configForProvider(id: ClouvaAIProviderId): ProviderConfig {
  if (id === "clouva") {
    const baseUrl = trimUrl(process.env.CLOUVA_AI_BASE_URL);
    const model = process.env.CLOUVA_AI_MODEL?.trim() ?? "";
    if (!baseUrl || !model) {
      throw new ProviderError({
        code: "PROVIDER_UNAVAILABLE",
        provider: id,
        status: 503,
        retryable: false,
        message: "El provider CLOUVA requiere CLOUVA_AI_BASE_URL y CLOUVA_AI_MODEL.",
      });
    }
    return {
      id,
      baseUrl,
      apiKey: process.env.CLOUVA_AI_API_KEY?.trim() || null,
      model,
      fallbackModel: process.env.CLOUVA_AI_FALLBACK_MODEL?.trim() || null,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim() || null;
  if (!apiKey) {
    throw new ProviderError({
      code: "PROVIDER_AUTH_ERROR",
      provider: id,
      status: 503,
      retryable: false,
      message: "El provider Gemini no está configurado en este servicio.",
    });
  }
  return {
    id,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL?.trim() || "gemini-3.1-flash-lite",
  };
}

export function getAIProviderConfig(): AIProviderConfig {
  // Backward compatible deployment default: existing installations remain on
  // Gemini until CLOUVA_AI_PROVIDER is explicitly switched to `clouva`.
  const primaryId = providerId(process.env.CLOUVA_AI_PROVIDER, "gemini");
  const fallbackRaw = process.env.CLOUVA_AI_FALLBACK_PROVIDER?.trim();
  const fallbackId = fallbackRaw ? providerId(fallbackRaw, primaryId) : null;
  return {
    primary: configForProvider(primaryId),
    fallback: fallbackId && fallbackId !== primaryId ? configForProvider(fallbackId) : null,
  };
}

export function selectedModelFromRequest(request: Request, configuredModel: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const current = cookie.match(/(?:^|;\s*)clouva_ai_model=([^;]+)/);
  const legacy = cookie.match(/(?:^|;\s*)clouva_gemini_model=([^;]+)/);
  const selected = current?.[1] ?? legacy?.[1] ?? "";
  if (!selected) return configuredModel;
  try {
    const decoded = decodeURIComponent(selected).trim();
    if (/^[A-Za-z0-9._:/-]{1,160}$/.test(decoded)) return decoded;
  } catch {
    // Ignore malformed historical cookies and use the configured model.
  }
  return configuredModel;
}
