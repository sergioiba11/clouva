import { getBindQrConfig, getBindQrReadiness, type BindQrConfig } from "./config";

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
  cacheKey: string;
};

let cachedToken: CachedToken | null = null;

function cacheKey(config: BindQrConfig) {
  return `${config.environment}:${config.clientId}:${config.scope}`;
}

export async function getBindQrAccessToken(config: BindQrConfig = getBindQrConfig()) {
  const readiness = getBindQrReadiness(config);
  if (!readiness.configured) {
    throw new Error(`BIND PSP QR no está configurado: faltan ${readiness.missing.join(", ")}.`);
  }

  const key = cacheKey(config);
  const now = Date.now();
  if (cachedToken && cachedToken.cacheKey === key && cachedToken.expiresAtMs - now > 60_000) {
    return cachedToken.accessToken;
  }

  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: config.scope,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !body?.access_token) {
    const safeReason = body?.error || `HTTP ${response.status}`;
    throw new Error(`No se pudo autenticar BIND PSP QR (${safeReason}).`);
  }

  const expiresInSeconds = Number.isFinite(body.expires_in) && Number(body.expires_in) > 0
    ? Number(body.expires_in)
    : 3600;

  cachedToken = {
    accessToken: body.access_token,
    expiresAtMs: now + expiresInSeconds * 1000,
    cacheKey: key,
  };

  return cachedToken.accessToken;
}

export function clearBindQrTokenCache() {
  cachedToken = null;
}
