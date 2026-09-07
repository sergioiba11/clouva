import "server-only";
import type { UniversalQrResolution } from "@/core/flows/qr/types";
import { classifyParsedQr, parseUniversalQr } from "@/core/flows/qr/parse";

const API = "https://api.mercadopago.com";

type OAuthToken = { access_token?: string; expires_in?: number };
type ResolveResponse = {
  status?: string;
  administrator?: { name?: string; identification_number?: string };
  collector?: { name?: string; identification_number?: string; account?: string; mcc?: string; postal_code?: string };
  order?: { id?: string; total_amount?: number | string; items?: Array<{ currency_id?: string }> };
  payment_methods_allowed?: Array<{ id?: string }>;
  additional_info?: unknown;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function credentials() {
  const clientId = process.env.MERCADOPAGO_INTEROPERABLE_CLIENT_ID?.trim();
  const clientSecret = process.env.MERCADOPAGO_INTEROPERABLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const value = credentials();
  if (!value) throw new Error("MERCADOPAGO_INTEROPERABLE_NOT_AUTHORIZED");
  const response = await fetch(`${API}/oauth/token`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: value.clientId, client_secret: value.clientSecret, grant_type: "client_credentials" }),
  });
  const body = (await response.json().catch(() => ({}))) as OAuthToken & { message?: string };
  if (!response.ok || !body.access_token) throw new Error(body.message || `Mercado Pago OAuth HTTP ${response.status}`);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Math.max(60, Number(body.expires_in) || 21_600) * 1000 };
  return cachedToken.value;
}

export function mercadoPagoInteroperableConfigured() {
  return Boolean(credentials());
}

export async function resolveMercadoPagoInteroperableQr(raw: string): Promise<UniversalQrResolution> {
  const parsed = parseUniversalQr(raw);
  if (parsed.type !== "mercadopago" && parsed.type !== "argentina_interoperable" && parsed.type !== "merchant_emv") {
    return classifyParsedQr(parsed, { mercadopagoResolverEnabled: false });
  }
  if (!credentials()) return classifyParsedQr(parsed, { mercadopagoResolverEnabled: false });

  const token = await accessToken();
  const response = await fetch(`${API}/instore/v2/external/resolve?data=${encodeURIComponent(raw)}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as ResolveResponse & { message?: string };
  if (!response.ok) {
    return {
      ...classifyParsedQr(parsed, { mercadopagoResolverEnabled: true }),
      capability: response.status === 404 ? "UNSUPPORTED" : "RESOLVABLE",
      provider: "mercadopago",
      safeMessage: body.message || `Mercado Pago no pudo resolver el QR (HTTP ${response.status}).`,
    };
  }

  const status = String(body.status || "").toLowerCase();
  const amount = body.order?.total_amount != null ? String(body.order.total_amount) : parsed.amount ?? null;
  const currency = body.order?.items?.find((item) => item.currency_id)?.currency_id || parsed.currency || "ARS";
  const paymentMethods = (body.payment_methods_allowed ?? []).map((method) => String(method.id || "").toUpperCase()).filter(Boolean);

  // Resolver access is not sufficient to move account money. CLOUVA intentionally
  // remains NOT_AUTHORIZED until an actual PCT/COELSA merchant-payment rail is enabled.
  return {
    ...parsed,
    type: "mercadopago",
    provider: "mercadopago",
    administrator: body.administrator?.name || null,
    merchant: {
      name: body.collector?.name || parsed.merchant?.name || null,
      city: parsed.merchant?.city || null,
      merchantId: body.collector?.identification_number || null,
      mcc: body.collector?.mcc || parsed.merchant?.mcc || null,
    },
    amount,
    currency,
    orderId: body.order?.id || null,
    transactionId: body.order?.id || null,
    dynamic: status === "closed_amount" ? true : parsed.dynamic,
    capability: status === "expired" ? "UNSUPPORTED" : "NOT_AUTHORIZED",
    executable: false,
    amountEditable: status === "opened",
    paymentMethods,
    safeMessage: status === "expired"
      ? "El QR de Mercado Pago está vencido."
      : "QR Mercado Pago resuelto. CLOUVA todavía necesita el rail PCT/COELSA homologado para pagar con saldo FLOW.",
  };
}
