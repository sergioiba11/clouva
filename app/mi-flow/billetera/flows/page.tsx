"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Coins,
  History,
  Loader2,
  LockKeyhole,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { FlowAppShell } from "@/components/flows/flow-app-shell";
import { FlowCoin, FlowHero, FlowMetricCard, FlowPanel, FlowStatusBadge } from "@/components/flows/flow-ui";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type MoneyValue = number | string | null | undefined;
type PlayerRef = { id: string; display_name: string | null; slug: string | null } | null;
type FundingRef = {
  id: string;
  entry_type: string;
  provider: string | null;
  payment_method: string | null;
  amount: MoneyValue;
  currency: string | null;
  status: string;
  external_payment_id: string | null;
  provider_fee: MoneyValue;
  net_amount: MoneyValue;
  occurred_at: string;
  reserve_account_id?: string | null;
  custody_status?: string | null;
  custody_stage?: string | null;
  custody_reference?: string | null;
  custody_confirmed_at?: string | null;
  reference_usd_amount?: MoneyValue;
};
type DocumentRef = {
  id: string;
  kind: "internal_receipt" | "fiscal_document";
  status: string;
  document_number: string | null;
  external_document_id: string | null;
  issued_at: string | null;
};
type MovementRef = { id: string; action: string; created_at: string };
type OperationRef = {
  id: string;
  provider: string | null;
  provider_payment_id: string | null;
  provider_reference: string;
  payment_method: string | null;
  quantity: number | string;
  unit_usd: MoneyValue;
  amount: MoneyValue;
  required_backing_usd?: MoneyValue;
  backing_amount?: MoneyValue;
  processing_fee_amount?: MoneyValue;
  processing_fee_policy?: string | null;
  currency: string | null;
  status: string;
  backing_status: string;
  confirmed_at: string | null;
  issued_at: string | null;
  created_at: string;
  refund_status: string | null;
  operation_type: string;
  target_asset_id: string | null;
  fx_rate_original_per_usd: MoneyValue;
  fx_pair: string | null;
  fx_source: string | null;
  fx_quoted_at: string | null;
  provider_fee: MoneyValue;
  net_amount: MoneyValue;
  funding?: FundingRef[] | null;
  documents?: DocumentRef[] | null;
  buyerPlayer?: PlayerRef;
  recipientPlayer?: PlayerRef;
};
type ReserveAccountRef = {
  id: string;
  name: string;
  provider: string;
  accountType: string;
  accountRole?: string;
  currency: string;
  status: string;
  isActive: boolean;
  authorizedForFlow: boolean;
} | null;
type BackingAllocationRef = {
  id: string;
  status: string;
  referenceUsdValue: number;
  allocatedAt: string;
  releasedAt: string | null;
  reserveAccount: ReserveAccountRef;
} | null;
type FlowAsset = {
  id: string;
  flow_number: number;
  status: "pending_payment" | "available" | "activated" | "transferred" | "legacy_unverified" | "reversed";
  issued_at: string;
  backed_at: string | null;
  backing_operation_id: string | null;
  owner?: PlayerRef;
  originalBuyer?: PlayerRef;
  operation?: OperationRef | null;
  originOperation?: OperationRef | null;
  backingOperation?: OperationRef | null;
  backingAllocation?: BackingAllocationRef;
  history?: MovementRef[] | null;
};
type Pricing = {
  flowUsdValue: number;
  referenceCurrency: string;
  checkoutCurrency: string | null;
  fxRate: number | null;
  fxPair: string | null;
  fxSource: string | null;
  fxQuotedAt: string | null;
  quoteSourceDate?: string | null;
  checkoutUnitAmount: number | null;
  processingFeePolicy: string;
  processingFeeBps: number;
  processingFeeFixedUsd: number;
};
type Payload = { assets?: unknown; pricing?: Partial<Pricing> | null; recentOperations?: unknown };

const DEFAULT_PRICING: Pricing = {
  flowUsdValue: 1,
  referenceCurrency: "USD",
  checkoutCurrency: null,
  fxRate: null,
  fxPair: null,
  fxSource: null,
  fxQuotedAt: null,
  checkoutUnitAmount: null,
  processingFeePolicy: "clouva_absorbs",
  processingFeeBps: 0,
  processingFeeFixedUsd: 0,
};

const finiteNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const finiteNumberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalizePricing = (value: Partial<Pricing> | null | undefined): Pricing => ({
  ...DEFAULT_PRICING,
  ...value,
  flowUsdValue: finiteNumber(value?.flowUsdValue, 1),
  fxRate: finiteNumberOrNull(value?.fxRate),
  checkoutUnitAmount: finiteNumberOrNull(value?.checkoutUnitAmount),
  processingFeeBps: Math.max(0, finiteNumber(value?.processingFeeBps, 0)),
  processingFeeFixedUsd: Math.max(0, finiteNumber(value?.processingFeeFixedUsd, 0)),
  processingFeePolicy: value?.processingFeePolicy === "customer_buffer" ? "customer_buffer" : "clouva_absorbs",
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const safeAssets = (value: unknown): FlowAsset[] =>
  Array.isArray(value) ? value.filter((row): row is FlowAsset => isRecord(row) && typeof row.id === "string") : [];
const safeOperations = (value: unknown): OperationRef[] =>
  Array.isArray(value)
    ? value.filter((row): row is OperationRef => isRecord(row) && typeof row.id === "string")
    : [];
const safeDocuments = (value: unknown): DocumentRef[] =>
  Array.isArray(value)
    ? value.filter((row): row is DocumentRef => isRecord(row) && typeof row.id === "string")
    : [];
const safeFunding = (value: unknown): FundingRef[] =>
  Array.isArray(value)
    ? value.filter((row): row is FundingRef => isRecord(row) && typeof row.id === "string")
    : [];
const safeHistory = (value: unknown): MovementRef[] =>
  Array.isArray(value)
    ? value.filter((row): row is MovementRef => isRecord(row) && typeof row.id === "string")
    : [];

const when = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return date.toLocaleString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const money = (value: unknown, currency: unknown) => {
  const parsed = Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: code,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Fall through to a readable generic representation.
    }
  }
  const formatted = amount.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  return code ? `${formatted} ${code}` : formatted;
};

const player = (value: PlayerRef | undefined) =>
  value?.slug ? `@${value.slug}` : value?.display_name || "—";
const origin = (operation: OperationRef | null | undefined) =>
  operation?.provider === "cash"
    ? "Pago en efectivo"
    : operation?.provider === "mercadopago"
      ? "Mercado Pago"
      : operation?.provider || "Sin operación";
const method = (operation: OperationRef | null | undefined) =>
  operation?.payment_method === "cash"
    ? "Efectivo"
    : operation?.payment_method === "mercadopago"
      ? "Mercado Pago"
      : operation?.payment_method || "—";

function operationStage(operation: OperationRef) {
  const funding = safeFunding(operation.funding);
  const reserveDeposit = funding.find(
    (entry) => entry.entry_type === "reserve_deposit" && entry.status === "confirmed",
  );
  const processorFunding = funding.find(
    (entry) => entry.entry_type === "funding" && entry.status === "confirmed",
  );
  if (
    operation.status === "confirmed" &&
    operation.issued_at &&
    operation.backing_status === "verified"
  )
    return "FLOW DISPONIBLE";
  if (reserveDeposit?.custody_stage === "allocated") return "FLOW DISPONIBLE";
  if (
    reserveDeposit?.custody_stage === "reserve_confirmed" ||
    reserveDeposit?.custody_status === "confirmed"
  )
    return "RESPALDO CONFIRMADO";
  if (processorFunding?.custody_stage === "transfer_pending") return "MOVIENDO A RESERVA";
  if (
    processorFunding?.custody_stage === "received_by_processor" ||
    (operation.status === "confirmed" && operation.provider === "mercadopago")
  )
    return "PAGO RECIBIDO · esperando Reserva CLOUVA";
  if (operation.status === "confirmed" && operation.backing_status === "legacy_unverified")
    return "PENDING_BACKING · falta custodia real";
  if (operation.status === "confirmed") return "PAGO RECIBIDO · respaldo pendiente";
  if (operation.status === "pending" && operation.provider_payment_id)
    return "PAGO PENDIENTE · procesándose";
  if (operation.status === "pending") return "PAGO PENDIENTE";
  if (operation.status === "failed") return "PAGO RECHAZADO";
  if (operation.status === "cancelled") return "PAGO CANCELADO";
  if (operation.status === "refunded") return "REEMBOLSADO";
  return operation.status || "—";
}

function activeBacking(asset: FlowAsset) {
  const allocation = asset.backingAllocation;
  return Boolean(
    allocation &&
      allocation.status === "active" &&
      allocation.reserveAccount?.accountRole === "reserve" &&
      allocation.reserveAccount.isActive &&
      allocation.reserveAccount.authorizedForFlow &&
      allocation.reserveAccount.status === "active",
  );
}

function isFlowAvailable(asset: FlowAsset) {
  return Boolean(
    asset.status !== "reversed" &&
      asset.status !== "legacy_unverified" &&
      activeBacking(asset) &&
      asset.operation?.backing_status === "verified" &&
      asset.operation.status === "confirmed",
  );
}

function assetState(asset: FlowAsset) {
  if (asset.status === "legacy_unverified") return "PENDING_BACKING";
  if (asset.status === "reversed" || asset.operation?.backing_status === "reversed") return "Revertido";
  if (isFlowAvailable(asset)) return "FLOW DISPONIBLE";
  if (asset.status === "pending_payment") return "Pendiente";
  if (!activeBacking(asset)) return "Respaldo pendiente";
  if (asset.status === "activated") return "Activado";
  if (asset.status === "transferred") return "Transferido";
  return "Disponible";
}

function operationName(operation: OperationRef) {
  if (operation.operation_type === "back_existing") return "Respaldo de FLOW";
  if (operation.operation_type === "purchase" || operation.operation_type === "buy") return "Carga de FLOW";
  return operation.operation_type ? operation.operation_type.replaceAll("_", " ") : "Operación FLOW";
}

export default function FlowWalletAssetsPage() {
  const { user, loading: authLoading } = useAuth();
  const [assets, setAssets] = useState<FlowAsset[]>([]);
  const [recentOperations, setRecentOperations] = useState<OperationRef[]>([]);
  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING);
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [openOperation, setOpenOperation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingKey, setBuyingKey] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);

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

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, load, user]);

  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const operation = params.get("operation");
    const returned = params.get("return");
    if (returned === "success")
      setReturnMessage(
        "Mercado Pago procesó el checkout. El FLOW seguirá bloqueado hasta que el dinero llegue y se confirme en la Reserva CLOUVA.",
      );
    else if (returned === "pending")
      setReturnMessage("El pago está pendiente en Mercado Pago. Todavía no existe FLOW disponible.");
    else if (returned === "failure")
      setReturnMessage("Mercado Pago no confirmó el pago. No se emitió ningún FLOW.");
    if (!operation) return;
    const timers = [1500, 3500, 7000].map((delay) =>
      window.setTimeout(() => void load(), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [load, user]);

  async function startPurchase(body: Record<string, unknown>, key: string) {
    setBuyingKey(key);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/flows/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readApiJson<{ initPoint?: string }>(response);
      if (!payload?.initPoint) throw new Error("Mercado Pago no devolvió una URL de checkout.");
      window.location.assign(payload.initPoint);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar el pago.");
      setBuyingKey(null);
    }
  }

  const activeAssets = useMemo(
    () => assets.filter((asset) => asset.status !== "reversed"),
    [assets],
  );
  const availableAssets = useMemo(
    () => activeAssets.filter((asset) => isFlowAvailable(asset)),
    [activeAssets],
  );
  const backedAssets = useMemo(
    () =>
      activeAssets.filter(
        (asset) =>
          activeBacking(asset) &&
          asset.operation?.backing_status === "verified" &&
          asset.operation?.status === "confirmed",
      ),
    [activeAssets],
  );
  const backingPercent = activeAssets.length
    ? Math.round((backedAssets.length / activeAssets.length) * 100)
    : 0;
  const pendingOperationCount = useMemo(
    () =>
      recentOperations.filter(
        (operation) =>
          !(
            operation.status === "confirmed" &&
            operation.issued_at &&
            operation.backing_status === "verified"
          ) &&
          !["failed", "cancelled", "refunded"].includes(operation.status),
      ).length,
    [recentOperations],
  );

  const checkoutEstimate =
    pricing.checkoutUnitAmount && pricing.checkoutCurrency
      ? money(pricing.checkoutUnitAmount, pricing.checkoutCurrency)
      : null;
  const requiredBackingUsd = roundMoney(pricing.flowUsdValue * quantity);
  const backingAmount = pricing.fxRate ? roundMoney(requiredBackingUsd * pricing.fxRate) : null;
  const processingFeeUsd =
    pricing.processingFeePolicy === "customer_buffer"
      ? roundMoney(
          (requiredBackingUsd * pricing.processingFeeBps) / 10_000 +
            pricing.processingFeeFixedUsd,
        )
      : 0;
  const processingFeeAmount = pricing.fxRate
    ? roundMoney(processingFeeUsd * pricing.fxRate)
    : 0;
  const totalAmount =
    backingAmount == null ? null : roundMoney(backingAmount + processingFeeAmount);
  const totalCheckout =
    totalAmount != null && pricing.checkoutCurrency
      ? money(totalAmount, pricing.checkoutCurrency)
      : null;

  return (
    <FlowAppShell>
      <main className="w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 xl:px-10 2xl:px-12">
        <div className="mx-auto w-full max-w-[1680px] space-y-5">
          <Link
            href="/mi-flow/billetera"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl px-1 text-sm text-white/42 transition hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
          >
            <ArrowLeft size={15} />
            Volver a Billetera
          </Link>

          <FlowHero
            flowUsdValue={pricing.flowUsdValue}
            loading={loading}
            onRefresh={() => void load()}
            pendingCount={pendingOperationCount}
          />

          {returnMessage ? (
            <p className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.055] px-4 py-3 text-sm leading-6 text-violet-100/80">
              {returnMessage}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.055] px-4 py-3 text-sm leading-6 text-rose-100"
            >
              {error}
            </p>
          ) : null}

          <section aria-label="Resumen de FLOWS" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <FlowMetricCard
              icon={<Coins size={18} />}
              label="FLOW disponible"
              value={`${availableAssets.length} FLOW`}
              detail="Solo activos confirmados y respaldados."
              tone="violet"
            />
            <FlowMetricCard
              icon={<CircleDollarSign size={18} />}
              label="Valor disponible"
              value={`US$ ${(availableAssets.length * pricing.flowUsdValue).toFixed(2)}`}
              detail={`1 FLOW = US$ ${pricing.flowUsdValue.toFixed(2)} de referencia.`}
              tone="neutral"
            />
            <FlowMetricCard
              icon={<Package size={18} />}
              label="Activos CLOUVA"
              value={String(activeAssets.length)}
              detail={`${assets.length - activeAssets.length} revertidos fuera del saldo utilizable.`}
              tone="cyan"
            />
            <FlowMetricCard
              icon={<ShieldCheck size={18} />}
              label="Respaldo"
              value={`${backingPercent}%`}
              detail={
                activeAssets.length
                  ? `${backedAssets.length} de ${activeAssets.length} activos con reserva verificada.`
                  : "Sin activos para respaldar."
              }
              tone={backingPercent === 100 && activeAssets.length > 0 ? "emerald" : "neutral"}
            />
          </section>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(350px,0.72fr)]">
            <FlowPanel
              eyebrow="Activos del Player"
              title="Tus FLOWS"
              action={
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                  {availableAssets.length} disponibles
                </span>
              }
              className="min-w-0"
            >
              {loading ? (
                <div className="grid min-h-56 place-items-center text-sm text-white/35">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Cargando FLOWS…
                  </span>
                </div>
              ) : assets.length ? (
                <div className="divide-y divide-white/[0.055]">
                  {assets.map((asset) => (
                    <FlowAssetCard
                      key={asset.id}
                      asset={asset}
                      pricing={pricing}
                      expanded={openAsset === asset.id}
                      onToggle={() =>
                        setOpenAsset((current) => (current === asset.id ? null : asset.id))
                      }
                      buying={buyingKey === asset.id}
                      purchaseBusy={Boolean(buyingKey)}
                      checkoutEstimate={checkoutEstimate}
                      onBackExisting={() =>
                        void startPurchase({ backExistingAssetId: asset.id }, asset.id)
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="px-5 py-12 text-center sm:px-6">
                  <div className="mx-auto w-fit opacity-70">
                    <FlowCoin compact />
                  </div>
                  <h3 className="mt-4 font-semibold text-white/80">Todavía no tenés FLOWS</h3>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/35">
                    Cuando una operación complete pago, reserva, respaldo y emisión, el activo
                    disponible aparecerá acá.
                  </p>
                </div>
              )}
            </FlowPanel>

            <PurchasePanel
              pricing={pricing}
              quantity={quantity}
              setQuantity={setQuantity}
              requiredBackingUsd={requiredBackingUsd}
              backingAmount={backingAmount}
              processingFeeAmount={processingFeeAmount}
              totalCheckout={totalCheckout}
              buying={buyingKey === "new"}
              purchaseBusy={Boolean(buyingKey)}
              onPurchase={() => void startPurchase({ quantity }, "new")}
            />
          </div>

          <FlowOperationList
            operations={recentOperations}
            openOperation={openOperation}
            onToggle={(id) =>
              setOpenOperation((current) => (current === id ? null : id))
            }
          />

          <section className="grid gap-4 md:grid-cols-2">
            <article className="rounded-[24px] border border-white/[0.07] bg-[#090811]/85 p-5 sm:p-6">
              <div className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-violet-300/15 bg-violet-300/[0.06] text-violet-200">
                  <LockKeyhole size={18} />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-300/60">
                    Qué es un FLOW
                  </p>
                  <h2 className="mt-1 font-semibold text-white/85">Valor respaldado dentro de CLOUVA</h2>
                  <p className="mt-2 text-sm leading-6 text-white/38">
                    El activo solo entra al saldo disponible después de completar la cadena
                    BACKING → EMISIÓN → LEDGER → FLOW DISPONIBLE.
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-[24px] border border-white/[0.07] bg-[#090811]/85 p-5 sm:p-6">
              <div className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-cyan-300/12 bg-cyan-300/[0.05] text-cyan-200">
                  <Package size={18} />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200/55">
                    Ecosistema CLOUVA
                  </p>
                  <h2 className="mt-1 font-semibold text-white/85">Un mismo FLOW en todo el sistema</h2>
                  <p className="mt-2 text-sm leading-6 text-white/38">
                    Tus FLOWS se conectan con las superficies compatibles del ecosistema sin
                    mezclarse con el dinero fiat personal.
                  </p>
                  <Link
                    href="/market"
                    className="mt-3 inline-flex min-h-10 items-center text-xs font-semibold text-violet-300 transition hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
                  >
                    Explorar Market →
                  </Link>
                </div>
              </div>
            </article>
          </section>
        </div>
      </main>
    </FlowAppShell>
  );
}

function PurchasePanel({
  pricing,
  quantity,
  setQuantity,
  requiredBackingUsd,
  backingAmount,
  processingFeeAmount,
  totalCheckout,
  buying,
  purchaseBusy,
  onPurchase,
}: {
  pricing: Pricing;
  quantity: number;
  setQuantity: (value: number) => void;
  requiredBackingUsd: number;
  backingAmount: number | null;
  processingFeeAmount: number;
  totalCheckout: string | null;
  buying: boolean;
  purchaseBusy: boolean;
  onPurchase: () => void;
}) {
  const updateQuantity = (value: number) => setQuantity(Math.max(1, Math.min(50, Math.trunc(value) || 1)));

  return (
    <FlowPanel
      eyebrow="Mercado Pago"
      title="Cargar FLOW"
      className="xl:sticky xl:top-[86px]"
    >
      <div className="p-5 sm:p-6">
        <p className="text-sm leading-6 text-white/42">
          Convertí dinero en FLOW. El cobro se procesa primero y el activo queda bloqueado hasta
          que el respaldo real sea confirmado en Reserva CLOUVA.
        </p>

        <div className="mt-5 rounded-[20px] border border-violet-300/12 bg-violet-400/[0.035] p-4">
          <label
            htmlFor="flow-quantity"
            className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/38"
          >
            Cantidad de FLOW
          </label>
          <div className="mt-3 grid grid-cols-[46px_minmax(0,1fr)_46px] items-center gap-2">
            <button
              type="button"
              onClick={() => updateQuantity(quantity - 1)}
              disabled={purchaseBusy || quantity <= 1}
              className="grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-black/20 text-white/65 transition hover:border-violet-300/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 disabled:opacity-30"
              aria-label="Restar un FLOW"
            >
              <Minus size={16} />
            </button>
            <input
              id="flow-quantity"
              aria-label="Cantidad de FLOW"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={quantity}
              disabled={purchaseBusy}
              onChange={(event) => updateQuantity(Number(event.target.value))}
              className="h-11 min-w-0 rounded-xl border border-white/[0.08] bg-black/20 px-3 text-center text-sm font-semibold text-white outline-none transition focus:border-violet-400/40 focus:ring-2 focus:ring-violet-400/20 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => updateQuantity(quantity + 1)}
              disabled={purchaseBusy || quantity >= 50}
              className="grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-black/20 text-white/65 transition hover:border-violet-300/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 disabled:opacity-30"
              aria-label="Sumar un FLOW"
            >
              <Plus size={16} />
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-white/28">
            1 FLOW = US$ {pricing.flowUsdValue.toFixed(2)} de referencia
          </p>
        </div>

        <div className="mt-4 space-y-2.5 rounded-[20px] border border-white/[0.065] bg-black/[0.18] p-4 text-sm">
          <Row label="Valor de respaldo" value={`US$ ${requiredBackingUsd.toFixed(2)}`} />
          <Row
            label="Conversión"
            value={
              backingAmount != null && pricing.checkoutCurrency
                ? money(backingAmount, pricing.checkoutCurrency)
                : "—"
            }
          />
          <Row
            label="Procesamiento"
            value={
              pricing.checkoutCurrency
                ? money(processingFeeAmount, pricing.checkoutCurrency)
                : "—"
            }
          />
          <div className="border-t border-white/[0.065] pt-3">
            <Row label="Total a pagar" value={totalCheckout || "—"} strong />
          </div>
        </div>

        {pricing.fxRate ? (
          <p className="mt-3 text-[10px] leading-4 text-white/28">
            Checkout en {pricing.checkoutCurrency || "moneda local"} · {pricing.fxPair || "FX"}{" "}
            {pricing.fxRate} · {pricing.fxSource || "fuente de cotización"}. La cotización se fija
            al iniciar el pago.
          </p>
        ) : null}

        {pricing.processingFeePolicy === "clouva_absorbs" ? (
          <p className="mt-3 rounded-xl border border-emerald-300/10 bg-emerald-300/[0.035] px-3 py-2.5 text-[10px] leading-4 text-emerald-100/55">
            CLOUVA absorbe el costo de procesamiento. La comisión real se concilia contra el neto
            recibido sin convertir el rail de cobro en backing.
          </p>
        ) : null}

        <button
          type="button"
          onClick={onPurchase}
          disabled={purchaseBusy || !pricing.checkoutUnitAmount}
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[15px] border border-violet-200/20 bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-[0_12px_34px_rgba(124,58,237,0.24)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {buying ? <Loader2 size={16} className="animate-spin" /> : <ShoppingBag size={16} />}
          Cargar {quantity} {quantity === 1 ? "FLOW" : "FLOWS"}
          {totalCheckout ? ` · ${totalCheckout}` : ""}
        </button>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[10px] text-white/25">
          <LockKeyhole size={11} />
          Mercado Pago procesa el cobro; Reserva CLOUVA confirma el respaldo.
        </p>
      </div>
    </FlowPanel>
  );
}

function FlowAssetCard({
  asset,
  pricing,
  expanded,
  onToggle,
  buying,
  purchaseBusy,
  checkoutEstimate,
  onBackExisting,
}: {
  asset: FlowAsset;
  pricing: Pricing;
  expanded: boolean;
  onToggle: () => void;
  buying: boolean;
  purchaseBusy: boolean;
  checkoutEstimate: string | null;
  onBackExisting: () => void;
}) {
  const operation = isRecord(asset.operation) ? (asset.operation as OperationRef) : null;
  const documents = safeDocuments(operation?.documents);
  const fundingRows = safeFunding(operation?.funding);
  const historyRows = safeHistory(asset.history);
  const receipt = documents.find((document) => document.kind === "internal_receipt");
  const fiscal = documents.find((document) => document.kind === "fiscal_document");
  const processorFunding = fundingRows.find(
    (entry) => entry.entry_type === "funding" && entry.status === "confirmed",
  );
  const reserveDeposit = fundingRows.find(
    (entry) => entry.entry_type === "reserve_deposit" && entry.status === "confirmed",
  );
  const allocation = asset.backingAllocation ?? null;
  const reserveAccount = allocation?.reserveAccount ?? null;
  const isLegacy = asset.status === "legacy_unverified";
  const isBacked = activeBacking(asset);
  const paymentLabel = operation ? operationStage(operation) : "—";
  const detailId = `flow-${asset.id}-detail`;

  return (
    <article className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <FlowCoin compact className="hidden sm:grid" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-white/28">
                Activo CLOUVA
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em] text-white/90 sm:text-2xl">
                FLOW #{String(asset.flow_number ?? "—").padStart(6, "0")}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/34">
                <span>{player(asset.owner)}</span>
                <span aria-hidden>·</span>
                <span>{origin(operation)}</span>
                <span aria-hidden>·</span>
                <span>US$ {pricing.flowUsdValue.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <FlowStatusBadge label={assetState(asset)} />
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={detailId}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-[10px] font-semibold text-white/45 transition hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
              >
                {expanded ? "Cerrar" : "Ver detalle"}
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <MiniStat label="Respaldo" value={isBacked ? "Reserva confirmada" : "No utilizable"} />
            <MiniStat label="Custodia" value={reserveAccount?.name || "Sin Reserva asignada"} />
            <MiniStat label="Emitido" value={when(asset.issued_at)} />
          </div>

          {isLegacy ? (
            <button
              type="button"
              onClick={onBackExisting}
              disabled={purchaseBusy || !pricing.checkoutUnitAmount}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-200/15 bg-amber-200/[0.07] px-4 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:opacity-40 sm:w-auto"
            >
              {buying ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              Respaldar FLOW{checkoutEstimate ? ` · ${checkoutEstimate}` : ""}
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div id={detailId} className="mt-5 space-y-5 border-t border-white/[0.06] pt-5">
          <DetailSection title="Respaldo / Reserva">
            <Row label="Estado" value={assetState(asset)} />
            <Row label="Backing" value={allocation?.status === "active" ? "Confirmado" : "Pendiente"} />
            <Row
              label="Valor respaldado"
              value={allocation ? `US$ ${Number(allocation.referenceUsdValue).toFixed(2)}` : "—"}
            />
            <Row label="Custodia" value={reserveAccount?.name || "Sin Reserva asignada"} />
            <Row label="Proveedor de Reserva" value={reserveAccount?.provider || "—"} />
            <Row label="Asignado" value={when(allocation?.allocatedAt)} />
          </DetailSection>

          <DetailSection title="Operación económica">
            <Row label="Método" value={method(operation)} />
            <Row label="Estado" value={paymentLabel} />
            <Row
              label="Backing requerido"
              value={
                operation?.required_backing_usd != null
                  ? `US$ ${Number(operation.required_backing_usd).toFixed(2)}`
                  : `US$ ${pricing.flowUsdValue.toFixed(2)}`
              }
            />
            <Row
              label="Monto checkout backing"
              value={
                operation?.backing_amount != null
                  ? money(operation.backing_amount, operation.currency)
                  : operation
                    ? money(operation.amount, operation.currency)
                    : "—"
              }
            />
            <Row
              label="Procesamiento"
              value={
                operation?.processing_fee_amount != null
                  ? money(operation.processing_fee_amount, operation.currency)
                  : "—"
              }
            />
            <Row
              label="Total cobrado"
              value={operation ? money(operation.amount, operation.currency) : "—"}
            />
            <Row label="Pago confirmado" value={when(operation?.confirmed_at)} />
            <Row label="FLOW respaldado" value={when(asset.backed_at)} />
            <Row label="Operación" value={operation?.id || "—"} mono />
            {operation?.provider === "mercadopago" ? (
              <Row label="Payment ID" value={operation.provider_payment_id || "—"} mono />
            ) : null}
            {processorFunding ? (
              <>
                <Row
                  label="Rail de cobro"
                  value={`${money(processorFunding.amount, processorFunding.currency)} · ${
                    processorFunding.custody_stage || "received_by_processor"
                  }`}
                />
                <Row
                  label="Fee proveedor real"
                  value={money(processorFunding.provider_fee || 0, processorFunding.currency)}
                />
                <Row
                  label="Neto registrado"
                  value={money(
                    processorFunding.net_amount ?? processorFunding.amount,
                    processorFunding.currency,
                  )}
                />
              </>
            ) : null}
            {reserveDeposit ? (
              <>
                <Row
                  label="Ingreso Reserva"
                  value={`${money(reserveDeposit.amount, reserveDeposit.currency)} · ${
                    reserveDeposit.custody_stage || reserveDeposit.custody_status || "—"
                  }`}
                />
                <Row
                  label="USD custodiado"
                  value={
                    reserveDeposit.reference_usd_amount != null
                      ? `US$ ${Number(reserveDeposit.reference_usd_amount).toFixed(2)}`
                      : "—"
                  }
                />
              </>
            ) : null}
            {operation?.fx_rate_original_per_usd ? (
              <Row
                label="Cotización histórica"
                value={`${operation.fx_pair || "USD/ARS"} · ${String(
                  operation.fx_rate_original_per_usd,
                )}`}
              />
            ) : null}
          </DetailSection>

          {fundingRows.length ? (
            <DetailSection title="Funding / Custodia">
              {fundingRows.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-white/[0.055] bg-black/15 p-3"
                >
                  <Row
                    label={entry.entry_type.replaceAll("_", " ")}
                    value={`${money(entry.amount, entry.currency)} · ${entry.status}`}
                  />
                  <Row label="Proveedor" value={entry.provider || "—"} />
                  <Row
                    label="Custodia"
                    value={entry.custody_stage || entry.custody_status || "—"}
                  />
                  {entry.external_payment_id ? (
                    <Row label="Referencia externa" value={entry.external_payment_id} mono />
                  ) : null}
                </div>
              ))}
            </DetailSection>
          ) : null}

          <DetailSection title="Origen del activo">
            <Row label="Comprador original" value={player(asset.originalBuyer)} />
            <Row label="FLOW emitido" value={when(asset.issued_at)} />
            <Row label="Operación origen" value={asset.originOperation?.id || "—"} mono />
          </DetailSection>

          <DetailSection title="Comprobantes">
            <Row label="Registro interno" value={receipt?.document_number || "—"} mono />
            <Row
              label="Comprobante fiscal oficial"
              value={fiscal?.document_number || "No asociado todavía"}
            />
          </DetailSection>

          <DetailSection title="Historial">
            {historyRows.length ? (
              <div className="space-y-2">
                {historyRows.map((movement) => (
                  <div
                    key={movement.id}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.05] bg-black/15 px-3 py-2.5 text-xs"
                  >
                    <span className="capitalize text-white/60">
                      {movement.action.replaceAll("_", " ")}
                    </span>
                    <span className="text-right text-white/28">{when(movement.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">Sin movimientos adicionales.</p>
            )}
          </DetailSection>
        </div>
      ) : null}
    </article>
  );
}

function FlowOperationList({
  operations,
  openOperation,
  onToggle,
}: {
  operations: OperationRef[];
  openOperation: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <FlowPanel
      eyebrow="Ledger operativo"
      title="Operaciones recientes"
      action={<History size={17} className="text-white/30" />}
    >
      {operations.length ? (
        <div className="divide-y divide-white/[0.055]">
          {operations.map((operation) => {
            const expanded = openOperation === operation.id;
            const funding = safeFunding(operation.funding);
            const documents = safeDocuments(operation.documents);
            const detailId = `operation-${operation.id}-detail`;
            return (
              <article key={operation.id} className="px-4 py-3.5 sm:px-5">
                <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1.3fr)_110px_130px_minmax(150px,0.8fr)_42px]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold capitalize text-white/78">
                      {operationName(operation)}
                    </p>
                    <p className="mt-1 text-[10px] text-white/28">{when(operation.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.13em] text-white/25 sm:hidden">
                      FLOW
                    </p>
                    <p className="text-sm font-medium text-white/65">
                      {String(operation.quantity ?? "—")} FLOW
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-[0.13em] text-white/25 sm:hidden">
                      Importe
                    </p>
                    <p className="text-sm text-white/58">
                      {money(operation.amount, operation.currency)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <FlowStatusBadge label={operationStage(operation)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggle(operation.id)}
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.06] text-white/38 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80"
                    aria-label={expanded ? "Cerrar detalle de operación" : "Abrir detalle de operación"}
                  >
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                </div>

                {expanded ? (
                  <div
                    id={detailId}
                    className="mt-4 grid gap-4 border-t border-white/[0.055] pt-4 lg:grid-cols-2"
                  >
                    <DetailSection title="Operación">
                      <Row label="Proveedor" value={operation.provider || "—"} />
                      <Row label="Método" value={method(operation)} />
                      <Row label="Estado de pago" value={operation.status || "—"} />
                      <Row label="Estado de backing" value={operation.backing_status || "—"} />
                      <Row label="Referencia" value={operation.provider_reference || "—"} mono />
                      <Row
                        label="Payment ID"
                        value={operation.provider_payment_id || "—"}
                        mono
                      />
                      <Row
                        label="Backing requerido"
                        value={
                          operation.required_backing_usd != null
                            ? `US$ ${Number(operation.required_backing_usd).toFixed(2)}`
                            : "—"
                        }
                      />
                      <Row
                        label="Fee proveedor"
                        value={money(operation.provider_fee || 0, operation.currency)}
                      />
                      <Row
                        label="Neto"
                        value={money(operation.net_amount ?? operation.amount, operation.currency)}
                      />
                      {operation.fx_rate_original_per_usd ? (
                        <Row
                          label="FX histórico"
                          value={`${operation.fx_pair || "USD/ARS"} · ${String(
                            operation.fx_rate_original_per_usd,
                          )}`}
                        />
                      ) : null}
                    </DetailSection>

                    <div className="space-y-4">
                      <DetailSection title="Funding / Custodia">
                        {funding.length ? (
                          <div className="space-y-2">
                            {funding.map((entry) => (
                              <div
                                key={entry.id}
                                className="rounded-xl border border-white/[0.05] bg-black/15 p-3"
                              >
                                <Row
                                  label={entry.entry_type.replaceAll("_", " ")}
                                  value={`${money(entry.amount, entry.currency)} · ${entry.status}`}
                                />
                                <Row
                                  label="Custodia"
                                  value={entry.custody_stage || entry.custody_status || "—"}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/30">Sin entradas de funding asociadas.</p>
                        )}
                      </DetailSection>

                      <DetailSection title="Documentos">
                        {documents.length ? (
                          <div className="space-y-2">
                            {documents.map((document) => (
                              <Row
                                key={document.id}
                                label={
                                  document.kind === "internal_receipt"
                                    ? "Registro interno"
                                    : "Documento fiscal"
                                }
                                value={document.document_number || document.status || "—"}
                                mono={Boolean(document.document_number)}
                              />
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/30">Sin documentos asociados.</p>
                        )}
                      </DetailSection>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-white/32">
          Todavía no hay operaciones FLOW registradas para esta cuenta.
        </p>
      )}
    </FlowPanel>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-white/[0.055] bg-black/10 p-4">
      <p className="mb-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/28">
        {title}
      </p>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.13em] text-white/24">{label}</p>
      <p className="mt-1 truncate text-[11px] font-medium text-white/52" title={value}>
        {value}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  strong = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-white/32">{label}</span>
      <span
        className={`min-w-0 break-all text-right ${
          mono ? "font-mono text-[11px] text-white/58" : strong ? "font-semibold text-white/88" : "text-white/62"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
