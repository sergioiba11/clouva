import "server-only";
import { createHash } from "node:crypto";

export function hashQrPayload(raw: string) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function universalQrSandboxEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.CLOUVA_UNIVERSAL_QR_SANDBOX === "1";
}

export function mercadoPagoInteroperableResolverEnabled() {
  return Boolean(
    process.env.MERCADOPAGO_INTEROPERABLE_CLIENT_ID?.trim() &&
    process.env.MERCADOPAGO_INTEROPERABLE_CLIENT_SECRET?.trim(),
  );
}
