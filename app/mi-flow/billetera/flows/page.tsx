"use client";

import { ArrowLeft, ChevronDown, ChevronUp, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CloverIcon } from "@/components/clover-icon";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type MoneyValue = number | string | null | undefined;
type PlayerRef = { id: string; display_name: string | null; slug: string | null } | null;
type FundingRef = { id: string; entry_type: string; provider: string | null; payment_method: string | null; amount: MoneyValue; currency: string | null; status: string; external_payment_id: string | null; provider_fee: MoneyValue; net_amount: MoneyValue; occurred_at: string; reserve_account_id?: string | null; custody_status?: string | null; custody_reference?: string | null; custody_confirmed_at?: string | null; reference_usd_amount?: MoneyValue };
type DocumentRef = { id: string; kind: "internal_receipt" | "fiscal_document"; status: string; document_number: string | null; external_document_id: string | null; issued_at: string | null };
type MovementRef = { id: string; action: string; created_at: string };
type OperationRef = { id: string; provider: string | null; provider_payment_id: string | null; provider_reference: string; payment_method: string | null; quantity: number | string; unit_usd: MoneyValue; amount: MoneyValue; required_backing_usd?: MoneyValue; backing_amount?: MoneyValue; processing_fee_amount?: MoneyValue; processing_fee_policy?: string | null; currency: string | null; status: string; backing_status: string; confirmed_at: string | null; issued_at: string | null; created_at: string; refund_status: string | null; operation_type: string; target_asset_id: string | null; fx_rate_original_per_usd: MoneyValue; fx_pair: string | null; fx_source: string | null; fx_quoted_at: string | null; provider_fee: MoneyValue; net_amount: MoneyValue; funding?: FundingRef[] | null; documents?: DocumentRef[] | null; buyerPlayer?: PlayerRef; recipientPlayer?: PlayerRef };
type ReserveAccountRef = { id: string; name: string; provider: string; accountType: string; currency: string; status: string; isActive: boolean; authorizedForFlow: boolean } | null;
type BackingAllocationRef = { id: string; status: string; referenceUsdValue: number; allocatedAt: string; releasedAt: string | null; reserveAccount: ReserveAccountRef } | null;
type FlowAsset = { id: string; flow_number: number; status: "pending_payment" | "available" | "activated" | "transferred" | "legacy_unverified" | "reversed"; issued_at: string; backed_at: string | null; backing_operation_id: string | null; owner?: PlayerRef; originalBuyer?: PlayerRef; operation?: OperationRef | null; originOperation?: OperationRef | null; backingOperation?: OperationRef | null; backingAllocation?: BackingAllocationRef; history?: MovementRef[] | null };
type Pricing = { flowUsdValue: number; referenceCurrency: string; checkoutCurrency: string | null; fxRate: number | null; fxPair: string | null; fxSource: string | null; fxQuotedAt: string | null; quoteSourceDate?: string | null; checkoutUnitAmount: number | null; processingFeePolicy: string; processingFeeBps: number; processingFeeFixedUsd: number };
type Payload = { assets?: unknown; pricing?: Partial<Pricing> | null; recentOperations?: unknown };

const DEFAULT_PRICING: Pricing = { flowUsdValue: 1, referenceCurrency: "USD", checkoutCurrency: null, fxRate: null, fxPair: null, fxSource: null, fxQuotedAt: null, checkoutUnitAmount: null, processingFeePolicy: "clouva_absorbs", processingFeeBps: 0, processingFeeFixedUsd: 0 };
const finiteNumber = (value: unknown, fallback: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const finiteNumberOrNull = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; };
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalizePricing = (value: Partial<Pricing> | null | undefined): Pricing => ({ ...DEFAULT_PRICING, ...value, flowUsdValue: finiteNumber(value?.flowUsdValue, 1), fxRate: finiteNumberOrNull(value?.fxRate), checkoutUnitAmount: finiteNumberOrNull(value?.checkoutUnitAmount), processingFeeBps: Math.max(0, finiteNumber(value?.processingFeeBps, 0)), processingFeeFixedUsd: Math.max(0, finiteNumber(value?.processingFeeFixedUsd, 0)), processingFeePolicy: value?.processingFeePolicy === "customer_buffer" ? "customer_buffer" : "clouva_absorbs" });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const safeAssets = (value: unknown): FlowAsset[] => Array.isArray(value) ? value.filter((row): row is FlowAsset => isRecord(row) && typeof row.id === "string") : [];
const safeOperations = (value: unknown): OperationRef[] => Array.isArray(value) ? value.filter((row): row is OperationRef => isRecord(row) && typeof row.id === "string") : [];
const safeDocuments = (value: unknown): DocumentRef[] => Array.isArray(value) ? value.filter((row): row is DocumentRef => isRecord(row) && typeof row.id === "string") : [];
const safeFunding = (value: unknown): FundingRef[] => Array.isArray(value) ? value.filter((row): row is FundingRef => isRecord(row) && typeof row.id === "string") : [];
const safeHistory = (value: unknown): MovementRef[] => Array.isArray(value) ? value.filter((row): row is MovementRef => isRecord(row) && typeof row.id === "string") : [];
const when = (value: string | null | undefined) => { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; try { return date.toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };
const money = (value: unknown, currency: unknown) => { const parsed = Number(value); const amount = Number.isFinite(parsed) ? parsed : 0; const code = typeof currency === "string" ? currency.trim().toUpperCase() : ""; if (/^[A-Z]{3}$/.test(code)) { try { return new Intl.NumberFormat("es-AR", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount); } catch { /* fall through */ } } const formatted = amount.toLocaleString("es-AR", { maximumFractionDigits: 2 }); return code ? `${formatted} ${code}` : formatted; };
const player = (value: PlayerRef | undefined) => value?.slug ? `@${value.slug}` : value?.display_name || "—";
const origin = (operation: OperationRef | null | undefined) => operation?.provider === "cash" ? "Pago en efectivo" : operation?.provider === "mercadopago" ? "Mercado Pago" : operation?.provider || "Sin operación";
const method = (operation: OperationRef | null | undefined) => operation?.payment_method === "cash" ? "Efectivo" : operation?.payment_method === "mercadopago" ? "Mercado Pago" : operation?.payment_method || "—";

function operationState(operation: OperationRef) {
  if (operation.status === "confirmed" && operation.backing_status === "pending") return "Pago confirmado · respaldo pendiente";
  if (operation.status === "confirmed" && operation.backing_status === "legacy_unverified") return "Falta confirmar custodia";
  if (operation.status === "confirmed" && operation.issued_at && operation.backing_status === "verified") return "Respaldado / Disponible";
  if (operation.status === "pending" && operation.provider_payment_id) return "Pago procesándose";
  if (operation.status === "pending") return "Pendiente de pago";
  if (operation.status === "failed") return "Pago rechazado";
  if (operation.status === "cancelled") return "Pago cancelado";
  if (operation.status === "refunded") return "Reembolsado";
  return operation.status || "—";
}

function activeBacking(asset: FlowAsset) {
  const allocation = asset.backingAllocation;
  return Boolean(allocation && allocation.status === "active" && allocation.reserveAccount?.isActive && allocation.reserveAccount.authorizedForFlow && allocation.reserveAccount.status === "active");
}

function assetState(asset: FlowAsset) {
  if (asset.status === "legacy_unverified") return "PENDING_BACKING";
  if (asset.status === "reversed" || asset.operation?.backing_status === "reversed") return "Revertido";
  if (activeBacking(asset) && asset.operation?.backing_status === "verified" && asset.operation.status === "confirmed") return "Respaldado";
  if (asset.status === "pending_payment") return "Pendiente de pago";
  if (!activeBacking(asset)) return "Respaldo pendiente";
  if (asset.status === "activated") return "Activado";
  if (asset.status === "transferred") return "Transferido";
  return "Disponible";
}

export default function FlowWalletAssetsPage() {
  const { user, loading: authLoading } = useAuth();
  const [assets, setAssets] = useState<FlowAsset[]>([]);
  const [recentOperations, setRecentOperations] = useState<OperationRef[]>([]);
  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingKey, setBuyingKey] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/flows/assets");
      const payload = await readApiJson<Payload>(response);
      setAssets(safeAssets(payload?.assets));
      setPricing(normalizePricing(payload?.pricing));
      setRecentOperations(safeOperations(payload?.recentOperations));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar tus FLOWS.");
      setAssets([]);
      setRecentOperations([]);
      setPricing(DEFAULT_PRICING);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (authLoading) return; if (!user) { setLoading(false); return; } void load(); }, [authLoading, load, user]);
  useEffect(() => { if (!user || typeof window === "undefined") return; const operation = new URLSearchParams(window.location.search).get("operation"); if (!operation) return; const timers = [1500, 3500, 7000].map((delay) => window.setTimeout(() => void load(), delay)); return () => timers.forEach((timer) => window.clearTimeout(timer)); }, [load, user]);

  const pendingOperations = useMemo(() => recentOperations.filter((operation) => !(operation.status === "confirmed" && operation.issued_at && operation.backing_status === "verified")), [recentOperations]);

  async function startPurchase(body: Record<string, unknown>, key: string) {
    setBuyingKey(key);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/flows/purchase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await readApiJson<{ initPoint?: string }>(response);
      if (!payload?.initPoint) throw new Error("Mercado Pago no devolvió una URL de checkout.");
      window.location.assign(payload.initPoint);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar el pago.");
      setBuyingKey(null);
    }
  }

  const checkoutEstimate = pricing.checkoutUnitAmount && pricing.checkoutCurrency ? money(pricing.checkoutUnitAmount, pricing.checkoutCurrency) : null;
  const requiredBackingUsd = roundMoney(pricing.flowUsdValue * quantity);
  const backingAmount = pricing.fxRate ? roundMoney(requiredBackingUsd * pricing.fxRate) : null;
  const processingFeeUsd = pricing.processingFeePolicy === "customer_buffer"
    ? roundMoney((requiredBackingUsd * pricing.processingFeeBps) / 10_000 + pricing.processingFeeFixedUsd)
    : 0;
  const processingFeeAmount = pricing.fxRate ? roundMoney(processingFeeUsd * pricing.fxRate) : 0;
  const totalAmount = backingAmount == null ? null : roundMoney(backingAmount + processingFeeAmount);
  const totalCheckout = totalAmount != null && pricing.checkoutCurrency ? money(totalAmount, pricing.checkoutCurrency) : null;

  return <main className="min-h-screen bg-[#07060d] text-white"><MainNav/><div className="mx-auto max-w-5xl space-y-5 px-4 py-8 md:px-8">
    <Link href="/mi-flow/billetera" className="inline-flex items-center gap-2 text-sm text-white/50"><ArrowLeft size={15}/>Volver a Billetera</Link>
    <section className="rounded-[30px] border border-cyan-300/15 bg-gradient-to-br from-[#111b21] via-[#0b1118] to-[#08090d] p-6 md:p-8"><div className="flex items-end justify-between gap-4"><div><p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200/60">Billetera · Activos CLOUVA</p><h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold"><CloverIcon className="text-cyan-200" size={34}/>Mis FLOWS</h1><p className="mt-3 text-sm text-white/45">1 FLOW = US$ {pricing.flowUsdValue.toFixed(2)}. Solo queda disponible si tiene una asignación 1:1 dentro de una cuenta de reserva CLOUVA.</p></div><button onClick={() => void load()} disabled={loading} className="rounded-xl border border-white/10 p-2 text-white/50"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/></button></div></section>
    <section className="rounded-[24px] border border-white/[0.08] bg-[#0c0a13]/95 p-5"><div className="flex flex-wrap items-end gap-4"><div className="min-w-[240px] flex-1"><p className="font-semibold">Cargar FLOW</p><p className="mt-1 text-xs text-white/40">Cada FLOW queda respaldado 1:1 por dinero real dentro de la Reserva CLOUVA.</p>{pricing.fxRate ? <p className="mt-1 text-[11px] text-white/30">Checkout en ARS · {pricing.fxPair} {pricing.fxRate} · {pricing.fxSource}. La cotización se fija al iniciar el pago.</p> : null}<div className="mt-4 grid gap-2 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-sm sm:grid-cols-2"><Row label="Cantidad" value={`${quantity} FLOW`}/><Row label="Valor de respaldo" value={`US$ ${requiredBackingUsd.toFixed(2)}`}/><Row label="Conversión" value={backingAmount != null && pricing.checkoutCurrency ? money(backingAmount, pricing.checkoutCurrency) : "—"}/><Row label="Costo procesamiento" value={pricing.checkoutCurrency ? money(processingFeeAmount, pricing.checkoutCurrency) : "—"}/><div className="sm:col-span-2 border-t border-white/[0.07] pt-2"><Row label="Total" value={totalCheckout || "—"}/></div></div>{pricing.processingFeePolicy === "clouva_absorbs" ? <p className="mt-2 text-[11px] text-emerald-200/55">CLOUVA absorbe el costo de procesamiento. La comisión real de Mercado Pago se concilia contra el neto recibido y nunca reduce silenciosamente el respaldo.</p> : null}</div><div className="flex items-center gap-3"><input aria-label="Cantidad de FLOW" type="number" min={1} max={50} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(50, Math.trunc(Number(event.target.value) || 1))))} className="w-20 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"/><button onClick={() => void startPurchase({ quantity }, "new")} disabled={Boolean(buyingKey) || !pricing.checkoutUnitAmount} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-45">{buyingKey === "new" ? <Loader2 size={15} className="animate-spin"/> : <ShoppingBag size={15}/>}+ Cargar FLOW{totalCheckout ? ` · ${totalCheckout}` : ""}</button></div></div></section>
    {pendingOperations.length ? <section className="rounded-[24px] border border-violet-300/10 bg-violet-300/[0.035] p-4"><p className="text-xs uppercase tracking-[0.16em] text-white/40">Operaciones recientes</p><div className="mt-3 space-y-2">{pendingOperations.map((operation) => <div key={operation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-sm"><div><b>{operation.operation_type === "back_existing" ? "Respaldo de FLOW" : "Carga de FLOW"}</b><p className="mt-0.5 text-xs text-white/40">{operationState(operation)} · {when(operation.created_at)}</p></div><span>{String(operation.quantity ?? "—")} FLOW · {money(operation.amount, operation.currency)}</span></div>)}</div></section> : null}
    {error ? <p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}{loading ? <div className="grid min-h-32 place-items-center"><Loader2 className="animate-spin"/></div> : null}
    <section className="grid gap-4 md:grid-cols-2">{assets.map((asset) => {
      const operation = isRecord(asset.operation) ? asset.operation as OperationRef : null;
      const documents = safeDocuments(operation?.documents);
      const fundingRows = safeFunding(operation?.funding);
      const historyRows = safeHistory(asset.history);
      const receipt = documents.find((document) => document.kind === "internal_receipt");
      const fiscal = documents.find((document) => document.kind === "fiscal_document");
      const funding = fundingRows.find((entry) => entry.entry_type === "funding" && entry.status === "confirmed");
      const allocation = asset.backingAllocation ?? null;
      const reserveAccount = allocation?.reserveAccount ?? null;
      const expanded = open === asset.id;
      const isLegacy = asset.status === "legacy_unverified";
      const isBacked = activeBacking(asset);
      const paymentLabel = operation ? operation.status === "confirmed" ? (operation.provider === "mercadopago" ? "Aprobado" : "Confirmado") : operationState(operation) : "—";
      return <article key={asset.id} className="rounded-[24px] border border-cyan-300/10 bg-[#0c0f14] p-5"><button onClick={() => setOpen(expanded ? null : asset.id)} className="w-full text-left"><div className="flex justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Activo CLOUVA</p><h2 className="mt-1 text-2xl font-semibold">FLOW #{String(asset.flow_number ?? "—").padStart(6, "0")}</h2><p className="mt-1 text-sm text-white/45">Valor: US$ {pricing.flowUsdValue.toFixed(2)}</p></div><div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs ${!isBacked ? "border-amber-200/20 text-amber-100" : "border-cyan-200/15 text-cyan-100"}`}>{assetState(asset)}</span>{expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</div></div><div className="mt-4 grid gap-2 text-sm"><Row label="Propietario" value={player(asset.owner)}/><Row label="Origen" value={origin(operation)}/><Row label="Respaldo" value={isBacked ? "Reserva confirmada 1:1" : "No disponible para gastar"}/>{reserveAccount ? <Row label="Custodia" value={reserveAccount.name}/> : null}</div></button>
        {isLegacy ? <button onClick={() => void startPurchase({ backExistingAssetId: asset.id }, asset.id)} disabled={Boolean(buyingKey) || !pricing.checkoutUnitAmount} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-45">{buyingKey === asset.id ? <Loader2 size={15} className="animate-spin"/> : <ShoppingBag size={15}/>}Respaldar FLOW{checkoutEstimate ? ` · ${checkoutEstimate}` : ""}</button> : null}
        {expanded ? <div className="mt-5 space-y-5 border-t border-white/[0.07] pt-5"><div><p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Respaldo / Reserva</p><div className="mt-3 grid gap-2 text-sm"><Row label="Estado" value={assetState(asset)}/><Row label="Backing" value={allocation?.status === "active" ? "Confirmado" : "Pendiente"}/><Row label="Valor respaldado" value={allocation ? `US$ ${Number(allocation.referenceUsdValue).toFixed(2)}` : "—"}/><Row label="Custodia" value={reserveAccount?.name || "Sin cuenta de reserva asignada"}/><Row label="Proveedor de reserva" value={reserveAccount?.provider || "—"}/><Row label="Asignado" value={when(allocation?.allocatedAt)}/></div></div><div><p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Operación económica</p><div className="mt-3 grid gap-2 text-sm"><Row label="Método" value={method(operation)}/><Row label="Pago" value={paymentLabel}/><Row label="Backing requerido" value={operation?.required_backing_usd != null ? `US$ ${Number(operation.required_backing_usd).toFixed(2)}` : `US$ ${pricing.flowUsdValue.toFixed(2)}`}/><Row label="Monto para respaldo" value={operation?.backing_amount != null ? money(operation.backing_amount, operation.currency) : operation ? money(operation.amount, operation.currency) : "—"}/><Row label="Procesamiento" value={operation?.processing_fee_amount != null ? money(operation.processing_fee_amount, operation.currency) : "—"}/><Row label="Total cobrado" value={operation ? money(operation.amount, operation.currency) : "—"}/><Row label="Pago confirmado" value={when(operation?.confirmed_at)}/><Row label="FLOW respaldado" value={when(asset.backed_at)}/><Row label="Operación" value={operation?.id || "—"} mono/>{operation?.provider === "mercadopago" ? <Row label="Payment ID" value={operation.provider_payment_id || "—"} mono/> : null}{funding ? <><Row label="Ingreso registrado" value={`${money(funding.amount, funding.currency)} · ${when(funding.occurred_at)}`}/><Row label="Custodia funding" value={funding.custody_status || "—"}/><Row label="USD de reserva aportado" value={funding.reference_usd_amount != null ? `US$ ${Number(funding.reference_usd_amount).toFixed(2)}` : "—"}/><Row label="Fee proveedor real" value={money(funding.provider_fee || 0, funding.currency)}/><Row label="Neto registrado" value={money(funding.net_amount ?? funding.amount, funding.currency)}/></> : null}{operation?.fx_rate_original_per_usd ? <Row label="Cotización usada" value={`${operation.fx_pair || "USD/ARS"} · ${String(operation.fx_rate_original_per_usd)}`}/> : null}</div></div><div><p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Origen del activo</p><div className="mt-3 grid gap-2 text-sm"><Row label="Comprador original" value={player(asset.originalBuyer)}/><Row label="FLOW emitido" value={when(asset.issued_at)}/><Row label="Operación origen" value={asset.originOperation?.id || "—"} mono/></div></div><div><p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Comprobantes</p><div className="mt-3 grid gap-2 text-sm"><Row label="Registro interno" value={receipt?.document_number || "—"} mono/><Row label="Comprobante fiscal oficial" value={fiscal?.document_number || "No asociado todavía"}/></div></div><div><p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Historial</p><div className="mt-2 space-y-2">{historyRows.map((history) => <div key={history.id} className="flex justify-between rounded-xl bg-white/[0.035] px-3 py-2 text-xs"><span>{String(history.action || "Movimiento")}</span><span className="text-white/35">{when(history.created_at)}</span></div>)}</div></div>{!isBacked ? <p className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs text-amber-100">Este FLOW existe como activo histórico, pero no puede gastarse hasta que haya dinero real custodiado y asignado en una cuenta de reserva CLOUVA autorizada.</p> : null}{operation?.refund_status ? <p className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs text-amber-100">El respaldo fue reembolsado o revertido; el caso queda auditado y el FLOW no se borra.</p> : null}</div> : null}
      </article>;
    })}</section>
  </div></main>;
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex justify-between gap-4"><span className="text-white/35">{label}</span><span className={`break-all text-right ${mono ? "font-mono text-[11px] text-white/65" : ""}`}>{value}</span></div>;
}
