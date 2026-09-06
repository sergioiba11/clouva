"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type MoneyRow = { currency: string; grossConfirmed: number; providerFees: number; netConfirmed: number; refunds: number };
type Snapshot = {
  flowUsdValue: number;
  processingFeePolicy: string;
  processingFeeBps: number;
  processingFeeFixedUsd: number;
  backedAssets: number;
  circulation: number;
  unbackedAssets: number;
  backingDifferenceFlows: number;
  pendingBackingFlows: number;
  paymentsAwaitingReserve?: number;
  totalReserveUsd: number;
  allocatedReserveUsd: number;
  freeReserveUsd: number;
  reserveDeficit: boolean;
  fundingByCurrency: MoneyRow[];
};
type Issue = { type: string; severity: string; entityId: string; details: Record<string, unknown> };
type PlayerRef = { id: string; display_name: string | null; slug: string | null } | null;
type ReserveAccount = {
  id: string;
  name: string;
  provider: string;
  account_type: string;
  currency: string;
  account_reference: string | null;
  flow_account_role: "reserve" | "collection_rail";
  status: string;
  is_active: boolean;
  authorized_for_flow: boolean;
  authorized_at: string | null;
  reserveUsd: number;
  allocatedUsd: number;
  freeUsd: number;
  activeAllocations: number;
  lastMovementAt: string | null;
};
type CollectionRail = ReserveAccount & {
  authorized_for_collection?: boolean;
  collection_authorized_at?: string | null;
};
type MercadoPagoInfo = {
  enabled: boolean;
  connected: boolean;
  environment: string | null;
  configuredCollectorId: string | null;
  reportedCollectorId: string | null;
  matchesConfiguredCollector: boolean | null;
  collectionAuthorized: boolean;
  collectionRailAccountId: string | null;
  nickname: string | null;
  countryId: string | null;
  siteStatus: string | null;
  lookupError?: string;
};
type FundsToMove = {
  operationId: string;
  quantity: number;
  currency: string;
  grossAmount: number;
  providerFee: number;
  netAmount: number;
  requiredBackingUsd: number;
  processorNetReferenceUsd: number | null;
  reserveDepositsUsd: number;
  requiredTransferUsd: number;
  remainingTransferUsd: number;
  paymentStage: string;
  confirmedAt: string | null;
  recipientPlayer: PlayerRef;
};
type Operation = {
  id: string;
  provider: string;
  quantity: number;
  unit_usd: number;
  amount: number;
  currency: string;
  status: string;
  backing_status: string;
  required_backing_usd: number;
  operation_type: string;
  confirmed_at: string | null;
  created_at: string;
  recipientPlayer: PlayerRef;
};
type Payload = {
  snapshot: Snapshot;
  reconciliation: Issue[];
  mercadoPago: MercadoPagoInfo;
  collectionRails: CollectionRail[];
  reserveAccounts: ReserveAccount[];
  fundsToMove: FundsToMove[];
  operations: Operation[];
};

const money = (value: number, currency: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
const usd = (value: number | undefined) => `US$ ${Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const player = (value: PlayerRef) => value?.slug ? `@${value.slug}` : value?.display_name || "—";
const idempotencyKey = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? `reserve:${crypto.randomUUID()}` : `reserve:${Date.now()}:${Math.random().toString(36).slice(2)}`;

export default function FlowTreasuryPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorizeBusy, setAuthorizeBusy] = useState(false);
  const [authorizeMessage, setAuthorizeMessage] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [reserveName, setReserveName] = useState("");
  const [reserveProvider, setReserveProvider] = useState("bank");
  const [reserveType, setReserveType] = useState("bank_account");
  const [reserveCurrency, setReserveCurrency] = useState("USD");
  const [reserveReference, setReserveReference] = useState("");
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);

  const [depositOperationId, setDepositOperationId] = useState<string | null>(null);
  const [reserveAccountId, setReserveAccountId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [custodyReference, setCustodyReference] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMessage, setDepositMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/admin/flows/treasury");
      setData(await readApiJson<Payload>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar Tesorería FLOW.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const snapshot = data?.snapshot;
  const activeReserves = useMemo(
    () => data?.reserveAccounts.filter((account) => account.flow_account_role === "reserve" && account.is_active && account.status === "active" && account.authorized_for_flow && Boolean(account.account_reference)) ?? [],
    [data],
  );
  const selectedReserve = activeReserves.find((account) => account.id === reserveAccountId) ?? null;
  const legacyPending = useMemo(
    () => data?.operations.filter((operation) => operation.provider !== "mercadopago" && operation.status === "confirmed" && operation.backing_status !== "verified" && operation.backing_status !== "reversed") ?? [],
    [data],
  );

  async function authorizeMercadoPago() {
    setAuthorizeBusy(true);
    setAuthorizeMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/flows/treasury/authorize-mercadopago", { method: "POST" });
      const result = await readApiJson<{ alreadyAuthorized?: boolean; collectorId?: string }>(response);
      setAuthorizeMessage(result.alreadyAuthorized ? "El rail de cobro Mercado Pago ya estaba verificado." : `Rail de cobro verificado${result.collectorId ? ` · collector ${result.collectorId}` : ""}.`);
      await load();
    } catch (cause) {
      setAuthorizeMessage(cause instanceof Error ? cause.message : "No se pudo verificar Mercado Pago.");
    } finally {
      setAuthorizeBusy(false);
    }
  }

  async function registerReserve(event: React.FormEvent) {
    event.preventDefault();
    setRegisterBusy(true);
    setRegisterMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/flows/treasury/reserve-account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: reserveName, provider: reserveProvider, accountType: reserveType, currency: reserveCurrency, accountReference: reserveReference }),
      });
      const result = await readApiJson<{ reserveAccount?: { name?: string } }>(response);
      setRegisterMessage(`Reserva registrada${result.reserveAccount?.name ? ` · ${result.reserveAccount.name}` : ""}.`);
      setReserveName("");
      setReserveReference("");
      setRegisterOpen(false);
      await load();
    } catch (cause) {
      setRegisterMessage(cause instanceof Error ? cause.message : "No se pudo registrar la Reserva.");
    } finally {
      setRegisterBusy(false);
    }
  }

  function beginDeposit(operationId: string) {
    setDepositOperationId(operationId);
    setReserveAccountId(activeReserves[0]?.id ?? "");
    setDepositAmount("");
    setCustodyReference("");
    setDepositMessage(null);
  }

  async function confirmDeposit(event: React.FormEvent) {
    event.preventDefault();
    if (!depositOperationId || !selectedReserve) return;
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !custodyReference.trim()) {
      setDepositMessage("Ingresá el importe real y la referencia de transferencia/depósito.");
      return;
    }
    setDepositBusy(true);
    setDepositMessage(null);
    try {
      const response = await authenticatedFetch("/api/admin/flows/treasury/reserve-deposit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId: depositOperationId,
          reserveAccountId: selectedReserve.id,
          amount,
          currency: selectedReserve.currency,
          custodyReference: custodyReference.trim(),
          idempotencyKey: idempotencyKey(),
        }),
      });
      const result = await readApiJson<{ issued?: { issued?: number; backingStatus?: string; backingShortfallUsd?: number; reserveTransferShortfallUsd?: number } }>(response);
      const issued = Number(result.issued?.issued ?? 0);
      setDepositMessage(
        issued > 0
          ? `Reserva confirmada · ${issued} FLOW disponible${issued === 1 ? "" : "s"}.`
          : result.issued?.backingShortfallUsd
            ? `Ingreso confirmado. Todavía falta ${usd(result.issued.backingShortfallUsd)} de capacidad real en Reserva.`
            : result.issued?.reserveTransferShortfallUsd
              ? `Ingreso parcial confirmado. Falta mover ${usd(result.issued.reserveTransferShortfallUsd)} desde el rail.`
              : "Ingreso confirmado. La operación sigue PENDING_BACKING.",
      );
      await load();
      if (issued > 0) setDepositOperationId(null);
    } catch (cause) {
      setDepositMessage(cause instanceof Error ? cause.message : "No se pudo confirmar el ingreso en Reserva.");
    } finally {
      setDepositBusy(false);
    }
  }

  return <div className="space-y-4">
    <PremiumCard className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">Admin · FLOW</p>
          <h1 className="mt-1 text-2xl font-bold">Tesorería / Reserva FLOW</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">Mercado Pago cobra → el dinero neto se mueve → la Reserva CLOUVA confirma custodia → backing 1:1 → FLOW disponible.</p>
        </div>
        <div className="flex gap-2"><Link href="/admin/flows" className="rounded-xl border border-white/10 px-4 py-2.5 text-sm">Volver</Link><button onClick={() => void load()} disabled={loading} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">{loading ? "Actualizando…" : "Actualizar"}</button></div>
      </div>
    </PremiumCard>

    {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
    {snapshot?.reserveDeficit ? <p className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm font-semibold text-red-100">CRÍTICO · La Reserva confirmada es menor que el backing asignado. La emisión queda bloqueada.</p> : null}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard label="Reserva total USD" value={snapshot ? usd(snapshot.totalReserveUsd) : "…"}/>
      <StatCard label="Reserva asignada" value={snapshot ? usd(snapshot.allocatedReserveUsd) : "…"}/>
      <StatCard label="Reserva libre" value={snapshot ? usd(snapshot.freeReserveUsd) : "…"}/>
      <StatCard label="FLOW PENDING_BACKING" value={snapshot?.pendingBackingFlows ?? "…"}/>
      <StatCard label="Pagos esperando Reserva" value={snapshot?.paymentsAwaitingReserve ?? "…"}/>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <PremiumCard className="p-5">
        <h2 className="font-semibold">Mercado Pago · rail de cobro</h2>
        <p className="mt-1 text-xs text-white/40">Procesa el pago y reporta bruto, fees y neto. No es la Reserva FLOW.</p>
        {data?.mercadoPago ? <div className="mt-4 grid gap-2 text-sm">
          <Row label="Entorno" value={data.mercadoPago.environment || "—"}/>
          <Row label="Cuenta conectada" value={data.mercadoPago.connected ? "Sí" : "No"}/>
          <Row label="Collector configurado" value={data.mercadoPago.configuredCollectorId || "—"} mono/>
          <Row label="Collector verificado" value={data.mercadoPago.reportedCollectorId || "—"} mono/>
          <Row label="Coincide" value={data.mercadoPago.matchesConfiguredCollector === true ? "Sí" : data.mercadoPago.matchesConfiguredCollector === false ? "No" : "—"}/>
          <Row label="Autorizado para cobrar" value={data.mercadoPago.collectionAuthorized ? "Sí" : "No"}/>
          {data.mercadoPago.nickname ? <Row label="Nickname" value={data.mercadoPago.nickname}/> : null}
          {!data.mercadoPago.collectionAuthorized ? <button onClick={() => void authorizeMercadoPago()} disabled={authorizeBusy || data.mercadoPago.matchesConfiguredCollector !== true} className="mt-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black disabled:opacity-40">{authorizeBusy ? "Verificando…" : "Verificar rail de cobro Mercado Pago"}</button> : null}
          {authorizeMessage ? <p className="mt-2 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white/70">{authorizeMessage}</p> : null}
          {data.mercadoPago.lookupError ? <p className="mt-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs text-amber-100">{data.mercadoPago.lookupError}</p> : null}
        </div> : null}
      </PremiumCard>

      <PremiumCard className="p-5">
        <h2 className="font-semibold">Pagos recibidos por el rail</h2>
        <p className="mt-1 text-xs text-white/40">Estos importes no cuentan como backing hasta entrar en una Reserva separada.</p>
        <div className="mt-4 space-y-3">{snapshot?.fundingByCurrency?.length ? snapshot.fundingByCurrency.map((row) => <div key={row.currency} className="rounded-xl border border-white/[0.07] bg-black/20 p-3 text-sm"><div className="mb-2 font-semibold">{row.currency}</div><Row label="Bruto confirmado" value={money(row.grossConfirmed, row.currency)}/><Row label="Fees proveedor reales" value={money(row.providerFees, row.currency)}/><Row label="Neto registrado" value={money(row.netConfirmed, row.currency)}/><Row label="Refunds" value={money(row.refunds, row.currency)}/></div>) : <p className="text-sm text-white/40">Sin pagos confirmados.</p>}</div>
      </PremiumCard>
    </div>

    <PremiumCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-semibold">Reserva CLOUVA · custodia</h2><p className="mt-1 text-xs text-white/40">Solo cuentas externas reales, separadas del rail de cobro, pueden respaldar FLOW.</p></div>
        <button onClick={() => setRegisterOpen((value) => !value)} className="rounded-xl border border-white/10 px-3 py-2 text-xs">{registerOpen ? "Cancelar" : "Registrar Reserva real"}</button>
      </div>
      {!activeReserves.length ? <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-100">No hay una Reserva CLOUVA separada registrada. Mercado Pago puede cobrar, pero ningún pago puede convertirse en FLOW disponible todavía.</p> : null}
      {registerOpen ? <form onSubmit={registerReserve} className="mt-4 grid gap-3 rounded-2xl border border-white/[0.08] bg-black/25 p-4 sm:grid-cols-2">
        <p className="sm:col-span-2 text-xs text-white/45">Registrá únicamente una cuenta externa real que ya exista. CLOUVA no crea la cuenta ni mueve dinero por este formulario.</p>
        <Field label="Nombre" value={reserveName} onChange={setReserveName} placeholder="Ej: Reserva FLOW USD"/>
        <Field label="Proveedor" value={reserveProvider} onChange={setReserveProvider} placeholder="bank"/>
        <Field label="Tipo de cuenta" value={reserveType} onChange={setReserveType} placeholder="bank_account"/>
        <Field label="Moneda" value={reserveCurrency} onChange={(value) => setReserveCurrency(value.toUpperCase().slice(0, 3))} placeholder="USD"/>
        <div className="sm:col-span-2"><Field label="Referencia real / alias / identificador" value={reserveReference} onChange={setReserveReference} placeholder="Referencia verificable de la cuenta externa"/></div>
        <button disabled={registerBusy} className="sm:col-span-2 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black disabled:opacity-40">{registerBusy ? "Registrando…" : "Registrar como Reserva CLOUVA"}</button>
      </form> : null}
      {registerMessage ? <p className="mt-3 text-xs text-white/60">{registerMessage}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">{data?.reserveAccounts.map((account) => <div key={account.id} className="rounded-2xl border border-white/[0.08] bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{account.name}</p><p className="mt-1 text-xs text-white/35">{account.provider} · {account.currency} · {account.account_reference || "sin referencia"}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] ${account.authorized_for_flow ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/20 text-amber-100"}`}>{account.authorized_for_flow ? "RESERVA AUTORIZADA" : "NO AUTORIZADA"}</span></div><div className="mt-4 grid gap-2 text-sm"><Row label="Custodia confirmada" value={usd(account.reserveUsd)}/><Row label="Asignada" value={usd(account.allocatedUsd)}/><Row label="Libre" value={usd(account.freeUsd)}/><Row label="FLOWS asignados" value={String(account.activeAllocations)}/><Row label="Autorizada" value={when(account.authorized_at)}/><Row label="Último movimiento" value={when(account.lastMovementAt)}/></div></div>)}</div>
    </PremiumCard>

    <PremiumCard className="p-5">
      <div><h2 className="font-semibold">Fondos por mover a Reserva</h2><p className="mt-1 text-xs text-white/40">Pago aprobado ≠ FLOW. Primero el dinero neto debe salir del rail y quedar confirmado en la Reserva.</p></div>
      <div className="mt-4 space-y-3">{data?.fundsToMove.length ? data.fundsToMove.map((item) => <div key={item.operationId} className="rounded-2xl border border-violet-300/10 bg-violet-300/[0.035] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">Mercado Pago · {item.quantity} FLOW</p><p className="mt-1 text-xs text-white/40">{player(item.recipientPlayer)} · {when(item.confirmedAt)} · {item.paymentStage}</p></div><div className="text-right"><p className="text-sm">Neto {money(item.netAmount, item.currency)}</p><p className="text-xs text-violet-200">Falta mover {usd(item.remainingTransferUsd)}</p></div></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><Row label="Backing requerido" value={usd(item.requiredBackingUsd)}/><Row label="Ya confirmado en Reserva" value={usd(item.reserveDepositsUsd)}/><Row label="Neto rail ref. USD" value={item.processorNetReferenceUsd == null ? "—" : usd(item.processorNetReferenceUsd)}/></div><button onClick={() => beginDeposit(item.operationId)} disabled={!activeReserves.length} className="mt-3 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-black disabled:opacity-40">Confirmar ingreso en Reserva</button>{depositOperationId === item.operationId ? <DepositForm reserves={activeReserves} reserveAccountId={reserveAccountId} setReserveAccountId={setReserveAccountId} selectedReserve={selectedReserve} depositAmount={depositAmount} setDepositAmount={setDepositAmount} custodyReference={custodyReference} setCustodyReference={setCustodyReference} depositBusy={depositBusy} depositMessage={depositMessage} onSubmit={confirmDeposit} onCancel={() => setDepositOperationId(null)}/> : null}</div>) : <p className="text-sm text-white/40">No hay pagos de Mercado Pago confirmados esperando traslado.</p>}</div>
    </PremiumCard>

    {legacyPending.length ? <PremiumCard className="p-5"><h2 className="font-semibold">Legacy / custodia pendiente</h2><p className="mt-1 text-xs text-white/40">No se convierten automáticamente. Solo pueden respaldarse si existe dinero real comprobado en Reserva.</p><div className="mt-4 space-y-3">{legacyPending.map((operation) => <div key={operation.id} className="rounded-2xl border border-amber-300/10 bg-amber-300/[0.035] p-4"><div className="flex justify-between gap-3"><div><p className="font-medium">{operation.provider.toUpperCase()} · {operation.quantity} FLOW</p><p className="mt-1 text-xs text-white/40">{player(operation.recipientPlayer)} · {when(operation.confirmed_at || operation.created_at)}</p></div><span className="text-xs text-amber-200">{operation.backing_status.toUpperCase()}</span></div><button onClick={() => beginDeposit(operation.id)} disabled={!activeReserves.length} className="mt-3 rounded-xl border border-white/10 px-3.5 py-2 text-xs disabled:opacity-40">Confirmar ingreso real en Reserva</button>{depositOperationId === operation.id ? <DepositForm reserves={activeReserves} reserveAccountId={reserveAccountId} setReserveAccountId={setReserveAccountId} selectedReserve={selectedReserve} depositAmount={depositAmount} setDepositAmount={setDepositAmount} custodyReference={custodyReference} setCustodyReference={setCustodyReference} depositBusy={depositBusy} depositMessage={depositMessage} onSubmit={confirmDeposit} onCancel={() => setDepositOperationId(null)}/> : null}</div>)}</div></PremiumCard> : null}

    <PremiumCard className="p-5"><h2 className="font-semibold">Reconciliación</h2><div className="mt-4 space-y-2">{data?.reconciliation.length ? data.reconciliation.map((issue) => <div key={`${issue.type}:${issue.entityId}`} className={`rounded-xl border p-3 text-xs ${issue.severity === "critical" ? "border-red-400/20 bg-red-400/[0.06] text-red-100" : "border-amber-300/15 bg-amber-300/[0.05] text-amber-100"}`}><b>{issue.severity.toUpperCase()} · {issue.type}</b><p className="mt-1 break-all opacity-60">{issue.entityId}</p></div>) : <p className="text-sm text-emerald-200/70">Sin diferencias críticas.</p>}</div></PremiumCard>
  </div>;
}

function DepositForm({ reserves, reserveAccountId, setReserveAccountId, selectedReserve, depositAmount, setDepositAmount, custodyReference, setCustodyReference, depositBusy, depositMessage, onSubmit, onCancel }: {
  reserves: ReserveAccount[];
  reserveAccountId: string;
  setReserveAccountId: (value: string) => void;
  selectedReserve: ReserveAccount | null;
  depositAmount: string;
  setDepositAmount: (value: string) => void;
  custodyReference: string;
  setCustodyReference: (value: string) => void;
  depositBusy: boolean;
  depositMessage: string | null;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-2xl border border-white/[0.08] bg-black/25 p-4 sm:grid-cols-2"><label className="text-xs text-white/50">Reserva<select value={reserveAccountId} onChange={(event) => setReserveAccountId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white">{reserves.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label className="text-xs text-white/50">Importe realmente ingresado<input inputMode="decimal" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} placeholder={`0,00 ${selectedReserve?.currency ?? ""}`} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white"/></label><label className="text-xs text-white/50 sm:col-span-2">Referencia real de transferencia / depósito<input value={custodyReference} onChange={(event) => setCustodyReference(event.target.value)} placeholder="Comprobante / transferencia / referencia bancaria" className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white"/></label><p className="sm:col-span-2 text-[11px] text-white/35">El equivalente USD se calcula con el FX histórico de la operación, nunca con una cotización futura.</p><div className="flex flex-wrap gap-2 sm:col-span-2"><button disabled={depositBusy || !selectedReserve} className="rounded-xl bg-emerald-200 px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">{depositBusy ? "Confirmando…" : "Confirmar ingreso en Reserva"}</button><button type="button" onClick={onCancel} className="rounded-xl border border-white/10 px-4 py-2 text-xs">Cancelar</button></div>{depositMessage ? <p className="sm:col-span-2 text-xs text-white/65">{depositMessage}</p> : null}</form>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="text-xs text-white/50">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white"/></label>;
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex justify-between gap-4"><span className="text-white/35">{label}</span><span className={`break-all text-right ${mono ? "font-mono text-[11px] text-white/65" : ""}`}>{value}</span></div>;
}
