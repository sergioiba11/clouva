export type ProviderErrorCode =
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_BILLING_DEPLETED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_BAD_RESPONSE";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(args: {
    code: ProviderErrorCode;
    message: string;
    provider: string;
    status?: number;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "ProviderError";
    this.code = args.code;
    this.status = args.status ?? 502;
    this.provider = args.provider;
    this.retryable = args.retryable ?? true;
  }
}

export function classifyProviderError(provider: string, status: number, message: string, cause?: unknown): ProviderError {
  const normalized = message.toLowerCase();
  if (
    status === 402
    || /prepayment credits? (?:are )?depleted|billing|insufficient[_ ]quota|credit balance|payment required/.test(normalized)
  ) {
    return new ProviderError({
      code: "PROVIDER_BILLING_DEPLETED",
      message: "El proveedor de IA configurado no tiene crédito disponible.",
      provider,
      status: 503,
      cause,
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderError({
      code: "PROVIDER_AUTH_ERROR",
      message: "El proveedor de IA rechazó la autenticación del servicio.",
      provider,
      status: 503,
      cause,
    });
  }
  if (status === 429) {
    return new ProviderError({
      code: "PROVIDER_RATE_LIMITED",
      message: "El proveedor de IA alcanzó temporalmente su límite de solicitudes.",
      provider,
      status: 503,
      cause,
    });
  }
  if (status === 408 || status === 504 || /timeout|timed out|tard[oó] demasiado/.test(normalized)) {
    return new ProviderError({
      code: "PROVIDER_TIMEOUT",
      message: "El proveedor de IA tardó demasiado en responder.",
      provider,
      status: 504,
      cause,
    });
  }
  if ((status === 404 || status === 400) && /model|modelo/.test(normalized)) {
    return new ProviderError({
      code: "MODEL_UNAVAILABLE",
      message: "El modelo solicitado no está disponible en el proveedor configurado.",
      provider,
      status: 503,
      cause,
    });
  }
  if (status >= 500 || /overload|unavailable|temporar|high demand|connection|econn/.test(normalized)) {
    return new ProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: "El proveedor de IA no está disponible en este momento.",
      provider,
      status: 503,
      cause,
    });
  }
  return new ProviderError({
    code: "PROVIDER_BAD_RESPONSE",
    message: message || "El proveedor de IA devolvió una respuesta inválida.",
    provider,
    status: status >= 400 && status < 600 ? status : 502,
    retryable: false,
    cause,
  });
}

export function normalizeProviderError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const candidate = error as Error & { status?: number };
  return classifyProviderError(provider, candidate?.status ?? 500, candidate?.message ?? String(error), error);
}

export function publicProviderError(error: unknown) {
  const normalized = error instanceof ProviderError
    ? error
    : new ProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: error instanceof Error ? error.message : "ClouAI no pudo completar la respuesta.",
        provider: "unknown",
      });
  return { code: normalized.code, message: normalized.message, status: normalized.status };
}
