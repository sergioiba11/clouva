import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type BcraDetail = { codigoMoneda?: string; tipoCotizacion?: number };
type BcraResult = { fecha?: string; detalle?: BcraDetail[] };

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function refreshBcraUsdRate(args: {
  admin: SupabaseClient;
  spot: { id: string; currency: string; fx_source: string };
}) {
  if (args.spot.currency !== "ARS" || args.spot.fx_source !== "BCRA_ESTADISTICAS_CAMBIARIAS_USD") {
    throw new Error("El proveedor automático configurado no corresponde a ARS/BCRA.");
  }
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 10);
  const sourceUrl = new URL("https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD");
  sourceUrl.searchParams.set("fechaDesde", formatDate(since));
  sourceUrl.searchParams.set("fechaHasta", formatDate(until));
  sourceUrl.searchParams.set("limit", "20");

  const response = await fetch(sourceUrl, {
    headers: { accept: "application/json", "user-agent": "CLOUVA/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`BCRA respondió ${response.status}.`);
  const payload = (await response.json()) as { results?: BcraResult[] };
  const quotes = (payload.results ?? [])
    .flatMap((result) => (result.detalle ?? []).map((detail) => ({ date: result.fecha, detail })))
    .filter((entry) => entry.date && entry.detail.codigoMoneda === "USD" && Number(entry.detail.tipoCotizacion) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = quotes[0];
  if (!latest?.date) throw new Error("BCRA no devolvió una cotización USD utilizable.");
  const localPerUsd = Number(latest.detail.tipoCotizacion);
  const idempotencyKey = `bcra:usd:${latest.date}:${localPerUsd}`;
  const { data, error } = await args.admin.rpc("record_commerce_fx_rate", {
    p_spot_id: args.spot.id,
    p_local_currency: args.spot.currency,
    p_local_per_usd: localPerUsd,
    p_source: "BCRA_ESTADISTICAS_CAMBIARIAS_USD",
    p_source_reference: sourceUrl.toString(),
    p_quoted_at: `${latest.date}T15:00:00-03:00`,
    p_raw_snapshot: {
      sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      result: { fecha: latest.date, detalle: latest.detail },
    },
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; local_per_quote: number; quoted_at: string };
}

export async function latestOrRefreshSpotFxRate(args: {
  admin: SupabaseClient;
  spot: { id: string; currency: string; fx_source: string };
}) {
  const { data, error } = await args.admin
    .from("commerce_fx_rates")
    .select("id,local_per_quote,quoted_at,source")
    .eq("spot_id", args.spot.id)
    .eq("local_currency", args.spot.currency)
    .eq("quote_currency", "USD")
    .order("quoted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? refreshBcraUsdRate(args);
}

