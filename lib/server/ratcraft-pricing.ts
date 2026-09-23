type BcraDetail = { codigoMoneda?: string; tipoCotizacion?: number };
type BcraResult = { fecha?: string; detalle?: BcraDetail[] };

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getRatcraftUsdArsRate() {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 10);

  const sourceUrl = new URL("https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD");
  sourceUrl.searchParams.set("fechaDesde", formatDate(since));
  sourceUrl.searchParams.set("fechaHasta", formatDate(until));
  sourceUrl.searchParams.set("limit", "20");

  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json", "user-agent": "CLOUVA-RATCRAFT/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`BCRA respondió ${response.status}.`);

  const payload = (await response.json()) as { results?: BcraResult[] };
  const latest = (payload.results ?? [])
    .flatMap((result) => (result.detalle ?? []).map((detail) => ({ date: result.fecha, detail })))
    .filter((entry) => entry.date && entry.detail.codigoMoneda === "USD" && Number(entry.detail.tipoCotizacion) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  if (!latest?.date) throw new Error("BCRA no devolvió una cotización USD utilizable.");

  return {
    localPerUsd: Number(latest.detail.tipoCotizacion),
    quotedAt: `${latest.date}T15:00:00-03:00`,
    source: "BCRA_ESTADISTICAS_CAMBIARIAS_USD",
  };
}

export function ratcraftArsAmount(priceUsd: number, localPerUsd: number) {
  return Math.round(priceUsd * localPerUsd * 100) / 100;
}
