import "server-only";

const BCRA_USD_QUOTE_URL = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD";
const FX_SOURCE = "BCRA_ESTADISTICAS_CAMBIARIAS_V1";

export type FlowCheckoutQuote = {
  checkoutCurrency: "ARS";
  fxRateOriginalPerUsd: number;
  fxPair: "USD/ARS";
  fxSource: typeof FX_SOURCE;
  fxQuotedAt: string;
  sourceDate: string | null;
};

function finitePositive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function getFlowCheckoutQuote(): Promise<FlowCheckoutQuote> {
  const response = await fetch(BCRA_USD_QUOTE_URL, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`No se pudo obtener la cotización oficial USD/ARS (BCRA HTTP ${response.status}).`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { results?: Array<{ fecha?: unknown; detalle?: Array<{ codigoMoneda?: unknown; tipoCotizacion?: unknown }> }> }
    | null;
  const result = payload?.results?.[0];
  const usd = result?.detalle?.find((entry) => String(entry.codigoMoneda || "").toUpperCase() === "USD");
  const rate = finitePositive(usd?.tipoCotizacion);
  if (!rate) throw new Error("La cotización oficial USD/ARS recibida del BCRA es inválida.");

  return {
    checkoutCurrency: "ARS",
    fxRateOriginalPerUsd: rate,
    fxPair: "USD/ARS",
    fxSource: FX_SOURCE,
    fxQuotedAt: new Date().toISOString(),
    sourceDate: typeof result?.fecha === "string" ? result.fecha : null,
  };
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
