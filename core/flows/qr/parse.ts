import { emvCurrencyCodeToIso, parseEmvMerchantQr } from "./emv";
import type { ParsedUniversalQr, UniversalQrCapability, UniversalQrResolution } from "./types";

const MAX_QR_LENGTH = 4096;
const MP_HOSTS = new Set(["mpago.la", "www.mercadopago.com.ar", "mercadopago.com.ar"]);

function safeUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function sandboxQr(raw: string): ParsedUniversalQr | null {
  const match = raw.match(/^CLOUVA-SANDBOX:KIOSK:([^:]{1,80}):(ARS):(\d+(?:\.\d{1,2})?)$/i);
  if (!match) return null;
  return {
    type: "sandbox_merchant",
    raw,
    country: "AR",
    merchant: { name: match[1].replace(/_/g, " "), city: "TEST", merchantId: "sandbox-kiosk", mcc: "5499" },
    amount: match[3],
    currency: "ARS",
    transactionId: null,
    providerHint: "sandbox",
    dynamic: true,
    valid: true,
    executable: false,
    errors: [],
  };
}

export function parseUniversalQr(rawInput: string): ParsedUniversalQr {
  const raw = String(rawInput ?? "").trim();
  if (!raw || raw.length > MAX_QR_LENGTH) {
    return { type: "unknown", raw, valid: false, executable: false, errors: ["QR vacío o demasiado largo."] };
  }

  const sandbox = sandboxQr(raw);
  if (sandbox) return sandbox;

  if (/^CLOUVA:QR:/i.test(raw)) {
    return { type: "clouva", raw, valid: true, executable: false, errors: [], providerHint: "clouva" };
  }

  const url = safeUrl(raw);
  if (url) {
    if (/^\/q\/[^/]+\/?$/i.test(url.pathname) && /(^|\.)clouva\.com\.ar$/i.test(url.hostname)) {
      return { type: "clouva", raw, valid: true, executable: false, errors: [], providerHint: "clouva" };
    }
    if (MP_HOSTS.has(url.hostname.toLowerCase()) || /(^|\.)mercadopago\.com$/i.test(url.hostname)) {
      return { type: "mercadopago", raw, country: "AR", valid: true, executable: false, errors: [], providerHint: "mercadopago" };
    }
    return { type: "payment_link", raw, valid: true, executable: false, errors: [], providerHint: url.hostname.toLowerCase() };
  }

  if (/^\d{22}$/.test(raw)) {
    return { type: "bank_destination", raw, country: "AR", valid: true, executable: false, errors: [], providerHint: null };
  }

  if (/^000201/.test(raw)) {
    try {
      const emv = parseEmvMerchantQr(raw);
      const isoCurrency = emvCurrencyCodeToIso(emv.currencyNumeric);
      const isArgentina = emv.country === "AR" || isoCurrency === "ARS";
      const type = emv.providerHint === "mercadopago"
        ? "mercadopago"
        : isArgentina
          ? "argentina_interoperable"
          : "merchant_emv";
      return {
        type,
        raw,
        country: emv.country,
        merchant: {
          name: emv.merchantName,
          city: emv.merchantCity,
          merchantId: null,
          mcc: emv.mcc,
        },
        amount: emv.amount,
        currency: isoCurrency,
        transactionId: null,
        providerHint: emv.providerHint,
        dynamic: emv.dynamic,
        valid: true,
        executable: false,
        errors: [],
        emv: emv.map,
      };
    } catch (error) {
      return {
        type: "merchant_emv",
        raw,
        valid: false,
        executable: false,
        errors: [error instanceof Error ? error.message : "QR EMV inválido."],
      };
    }
  }

  return { type: "unknown", raw, valid: true, executable: false, errors: [], providerHint: null };
}

export function classifyParsedQr(parsed: ParsedUniversalQr, options?: { sandboxEnabled?: boolean; mercadopagoResolverEnabled?: boolean }): UniversalQrResolution {
  let capability: UniversalQrCapability = "DETECTED";
  let safeMessage: string | null = null;
  let provider = parsed.providerHint ?? null;
  let amountEditable = !parsed.amount;

  if (!parsed.valid) {
    capability = "UNSUPPORTED";
    safeMessage = parsed.errors[0] ?? "El QR no tiene un formato válido.";
  } else if (parsed.type === "clouva") {
    capability = "RESOLVABLE";
    safeMessage = "QR CLOUVA: debe continuar por el flujo interno correspondiente.";
  } else if (parsed.type === "sandbox_merchant") {
    capability = options?.sandboxEnabled ? "PAYABLE" : "NOT_AUTHORIZED";
    provider = "sandbox";
    safeMessage = options?.sandboxEnabled ? "QR de comercio de prueba listo para sandbox." : "El proveedor sandbox está deshabilitado.";
  } else if (parsed.type === "mercadopago") {
    capability = options?.mercadopagoResolverEnabled ? "RESOLVABLE" : "NOT_AUTHORIZED";
    provider = "mercadopago";
    safeMessage = options?.mercadopagoResolverEnabled
      ? "QR Mercado Pago detectado. Falta resolverlo con la API interoperable."
      : "QR Mercado Pago reconocido. CLOUVA todavía no tiene habilitado el onboarding interoperable para ejecutarlo.";
  } else if (parsed.type === "argentina_interoperable" || parsed.type === "merchant_emv") {
    capability = "NOT_AUTHORIZED";
    safeMessage = "QR de comercio reconocido. Falta un rail interoperable homologado para ejecutar el pago.";
  } else if (parsed.type === "bank_destination") {
    capability = "UNSUPPORTED";
    safeMessage = "Destino bancario detectado, pero no se trata automáticamente como una obligación merchant QR.";
  } else if (parsed.type === "payment_link") {
    capability = "UNSUPPORTED";
    safeMessage = "Link de pago detectado. Universal QR no lo ejecuta como QR interoperable sin un provider compatible.";
  } else {
    capability = "UNSUPPORTED";
    safeMessage = "QR reconocido por la cámara, pero el formato todavía no es pagable por CLOUVA.";
  }

  return { ...parsed, capability, provider, amountEditable, safeMessage, paymentMethods: [] };
}
