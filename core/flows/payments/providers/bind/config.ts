export type BindQrEnvironment = "staging" | "production";

export type BindQrConfig = {
  environment: BindQrEnvironment;
  baseUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  originCvu: string;
  originCuit: string;
  executionEnabled: boolean;
  webhookSourceIpWhitelist: string[];
};

const STAGING_BASE_URL = "https://gw-staging-qrbind.epays.services";
const PRODUCTION_BASE_URL = "https://api.bindpagos.com.ar";
const STAGING_TOKEN_URL = "https://login.microsoftonline.com/61ef5b89-8df3-499d-8c13-38fed5d09c72/oauth2/v2.0/token";
const PRODUCTION_TOKEN_URL = "https://login.microsoftonline.com/3ee81fb8-f2e8-4475-aef2-c5902f9fb0c3/oauth2/v2.0/token";
const STAGING_SCOPE = "api://staging-bind.epays.services/.default";
const PRODUCTION_SCOPE = "api://bindpagos.com.ar/.default";

function envBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function envCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getBindQrConfig(): BindQrConfig {
  const environment: BindQrEnvironment = process.env.BIND_PSP_QR_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? "production"
    : "staging";
  const production = environment === "production";

  return {
    environment,
    baseUrl: (process.env.BIND_PSP_QR_BASE_URL?.trim() || (production ? PRODUCTION_BASE_URL : STAGING_BASE_URL)).replace(/\/$/, ""),
    tokenUrl: process.env.BIND_PSP_QR_TOKEN_URL?.trim() || (production ? PRODUCTION_TOKEN_URL : STAGING_TOKEN_URL),
    scope: process.env.BIND_PSP_QR_SCOPE?.trim() || (production ? PRODUCTION_SCOPE : STAGING_SCOPE),
    clientId: process.env.BIND_PSP_QR_CLIENT_ID?.trim() || "",
    clientSecret: process.env.BIND_PSP_QR_CLIENT_SECRET?.trim() || "",
    originCvu: process.env.BIND_PSP_QR_ORIGIN_CVU?.trim() || "",
    originCuit: process.env.BIND_PSP_QR_ORIGIN_CUIT?.trim() || "",
    executionEnabled: envBoolean(process.env.BIND_PSP_QR_EXECUTION_ENABLED),
    webhookSourceIpWhitelist: envCsv(process.env.BIND_PSP_QR_WEBHOOK_SOURCE_IPS),
  };
}

export function getBindQrReadiness(config: BindQrConfig = getBindQrConfig()) {
  const missing: string[] = [];
  if (!config.clientId) missing.push("BIND_PSP_QR_CLIENT_ID");
  if (!config.clientSecret) missing.push("BIND_PSP_QR_CLIENT_SECRET");
  if (!config.originCvu) missing.push("BIND_PSP_QR_ORIGIN_CVU");
  if (!config.originCuit) missing.push("BIND_PSP_QR_ORIGIN_CUIT");

  const configured = missing.length === 0;
  const paymentExecutionReady = configured && config.executionEnabled;
  const productionEnabled = config.environment === "production" && paymentExecutionReady;

  return {
    provider: "bind_psp",
    environment: config.environment,
    configured,
    executionEnabled: config.executionEnabled,
    paymentExecutionReady,
    productionEnabled,
    missing,
    webhookSecurity: {
      defaultApplicationSignature: false,
      sourceIpWhitelistConfigured: config.webhookSourceIpWhitelist.length > 0,
      mtlsConfiguredByCode: false,
    },
  } as const;
}
