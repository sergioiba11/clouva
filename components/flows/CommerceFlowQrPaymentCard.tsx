"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type SaleResult = {
  operationId?: string;
  orderId?: string;
  paymentId?: string;
  spotId?: string;
  qrRegistryId?: string;
  flowQuantity?: number;
  purchaseQuantity?: number;
  status?: string;
  duplicate?: boolean;
  recovered?: boolean;
  transfer?: {
    transferId?: string;
    flowNumbers?: Array<number | string>;
    quantity?: number;
  };
};

type StoredOperation = {
  operationId: string;
  publicToken: string;
  listingId: string;
  variantId: string | null;
  quantity: number;
  fxRateId: string;
  status: "PENDING" | "COMPLETED";
  result?: SaleResult | null;
};

type Props = {
  publicToken: string;
  listingId: string;
  variantId?: string | null;
  productName: string;
  recipientLabel: string;
  unitPrice: number;
  currency: string;
  fxRateId: string;
  localPerQuote: number;
  imageUrl?: string | null;
  productHref?: string | null;
};

function storageKey(publicToken: string, userId: string) {
  return `clouva:commerce-flow-qr:${userId}:${publicToken}`;
}

function round8(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

export function CommerceFlowQrPaymentCard({
  publicToken,
  listingId,
  variantId = null,
  productName,
  recipientLabel,
  unitPrice,
  currency,
  fxRateId,
  localPerQuote,
  imageUrl,
  productHref,
}: Props) {
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;
  const [quantity, setQuantity] = useState(1);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const recoveryStarted = useRef(false);

  const totalLocal = round8(unitPrice * quantity);
  const requiredFlow = localPerQuote > 0 ? round8(totalLocal / localPerQuote) : Number.NaN;
  const payable = Number.isInteger(requiredFlow) && requiredFlow >= 1 && requiredFlow <= 50;

  function persist(operation: StoredOperation | null) {
    if (typeof window === "undefined" || !userId) return;
    const key = storageKey(publicToken, userId);
    if (!operation) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(operation));
  }

  useEffect(() => {
    recoveryStarted.current = false;
    setHydrated(false);
    setBusy(false);
    setError(null);
    setResult(null);
    setOperationId(null);
    setQuantity(1);

    if (loading) return;
    if (!userId) {
      setHydrated(true);
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey(publicToken, userId));
      if (raw) {
        const stored = JSON.parse(raw) as StoredOperation;
        if (
          stored.publicToken === publicToken
          && stored.listingId === listingId
          && stored.variantId === variantId
          && stored.fxRateId === fxRateId
          && typeof stored.operationId === "string"
          && Number.isInteger(stored.quantity)
          && stored.quantity >= 1
          && stored.quantity <= 50
        ) {
          setOperationId(stored.operationId);
          setQuantity(stored.quantity);
          if (stored.status === "COMPLETED" && stored.result) setResult(stored.result);
        }
      }
    } catch {
      window.localStorage.removeItem(storageKey(publicToken, userId));
    } finally {
      setHydrated(true);
    }
  }, [fxRateId, listingId, loading, publicToken, userId, variantId]);

  async function postPayment(id: string, purchaseQuantity: number) {
    if (!session?.access_token) return;
    const response = await fetch("/api/commerce/flow-qr", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        "idempotency-key": id,
      },
      body: JSON.stringify({ publicToken, listingId, variantId, quantity: purchaseQuantity, fxRateId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "No se pudo completar la compra con FLOW.");
    const sale = { ...((body.sale || {}) as SaleResult), operationId: (body.sale as SaleResult | undefined)?.operationId || id };
    setResult(sale);
    persist({ operationId: id, publicToken, listingId, variantId, quantity: purchaseQuantity, fxRateId, status: "COMPLETED", result: sale });
  }

  async function recover(id: string, purchaseQuantity: number) {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/commerce/flow-qr?operationId=${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.sale) {
        const sale = { ...(body.sale as SaleResult), operationId: id, recovered: true };
        setResult(sale);
        persist({ operationId: id, publicToken, listingId, variantId, quantity: purchaseQuantity, fxRateId, status: "COMPLETED", result: sale });
        return;
      }
      if (response.status !== 404) throw new Error(body.error || "No se pudo recuperar la compra FLOW.");
      await postPayment(id, purchaseQuantity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo recuperar la compra FLOW.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!hydrated || loading || !session?.access_token || !operationId || result || recoveryStarted.current) return;
    recoveryStarted.current = true;
    void recover(operationId, quantity);
    // quantity is immutable while operationId exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, loading, session?.access_token, operationId, result]);

  async function pay() {
    if (!session?.access_token || busy || !payable) return;
    setBusy(true);
    setError(null);
    const id = operationId || crypto.randomUUID();
    if (!operationId) {
      setOperationId(id);
      persist({ operationId: id, publicToken, listingId, variantId, quantity, fxRateId, status: "PENDING" });
    }
    try {
      await postPayment(id, quantity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la compra con FLOW.");
    } finally {
      setBusy(false);
    }
  }

  function newPayment() {
    if (busy) return;
    persist(null);
    recoveryStarted.current = false;
    setOperationId(null);
    setResult(null);
    setError(null);
    setQuantity(1);
  }

  const intentLocked = Boolean(operationId);
  const flowNumbers = result?.transfer?.flowNumbers ?? [];

  return (
    <section className="mt-6 rounded-[1.75rem] border border-violet-400/25 bg-black/35 p-5">
      <div className="flex items-center gap-3">
        {imageUrl ? <img src={imageUrl} alt="" className="h-14 w-14 rounded-2xl object-cover" /> : null}
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-violet-300">Comprar con FLOW</p>
          <h2 className="truncate text-lg font-semibold text-white">{productName}</h2>
          <p className="text-xs text-white/45">Recibe {recipientLabel}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[.03] p-4">
        <div>
          <p className="text-xs uppercase tracking-[.18em] text-white/40">Cantidad</p>
          <p className="mt-1 text-sm text-white/60">{totalLocal.toLocaleString("es-AR")} {currency} · {Number.isFinite(requiredFlow) ? requiredFlow : "—"} FLOW</p>
        </div>
        <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1">
          <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={busy || intentLocked || quantity <= 1} className="h-10 w-10 rounded-lg text-xl text-white/70 disabled:opacity-25">−</button>
          <span className="w-10 text-center font-bold text-white">{quantity}</span>
          <button type="button" onClick={() => setQuantity((value) => Math.min(50, value + 1))} disabled={busy || intentLocked || quantity >= 50} className="h-10 w-10 rounded-lg text-xl text-white/70 disabled:opacity-25">+</button>
        </div>
      </div>

      {!payable ? <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.06] p-3 text-xs leading-5 text-amber-100/75">Con la cotización vigente, este total no puede liquidarse en 1–50 FLOW enteros. No se inventan fracciones ni se redondea el pago.</p> : null}
      {intentLocked ? <p className="mt-3 text-xs text-white/40">Producto, cantidad y cotización quedaron bloqueados para esta operación.</p> : null}

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/[.06] p-3 text-xs leading-5 text-emerald-100/75">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Pedido, pago FLOW, ingreso comercial y stock se confirman en una sola transacción. Si falla una parte, no queda ninguna confirmada.</p>
      </div>

      {loading || !hydrated ? <p className="mt-4 text-center text-sm text-white/45">Verificando tu sesión…</p> : null}
      {!loading && hydrated && !session?.access_token ? (
        <Link href={`/login?next=${encodeURIComponent(`/q/${publicToken}`)}`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white">
          Iniciar sesión para comprar <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
      {!loading && hydrated && session?.access_token && !result ? (
        <button type="button" onClick={pay} disabled={busy || !payable} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
          {busy ? "Recuperando / confirmando…" : operationId ? "Reintentar misma compra" : `Pagar ${requiredFlow} FLOW`}
          {!busy ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      ) : null}

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[.06] p-3 text-sm text-red-200">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-4 text-emerald-100">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" /> Compra confirmada</div>
          <p className="mt-2 text-sm text-emerald-100/70">{result.purchaseQuantity ?? quantity} unidad(es) · {result.flowQuantity ?? requiredFlow} FLOW.</p>
          {flowNumbers.length ? <p className="mt-1 text-xs text-emerald-100/55">{flowNumbers.map((value) => `FLOW #${String(value).padStart(6, "0")}`).join(" · ")}</p> : null}
          <div className="mt-3 space-y-1 break-all font-mono text-[10px] text-emerald-100/45">
            <p>Operación {result.operationId || operationId}</p>
            {result.transfer?.transferId ? <p>Transferencia {result.transfer.transferId}</p> : null}
            {result.orderId ? <p>Pedido {result.orderId}</p> : null}
            {result.paymentId ? <p>Pago {result.paymentId}</p> : null}
          </div>
          <Link href="/mi-flow" className="mt-3 inline-block text-sm font-semibold text-emerald-100/80 hover:text-emerald-50">Ver movimientos en Mi Flow</Link>
        </div>
      ) : null}

      {operationId ? (
        <button type="button" onClick={newPayment} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/65 disabled:opacity-40">
          <RotateCcw className="h-4 w-4" /> Nueva compra
        </button>
      ) : null}

      {productHref ? <Link href={productHref} className="mt-4 block text-center text-sm text-violet-200/70 hover:text-violet-100">Ver publicación</Link> : null}
    </section>
  );
}
