"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type TransferResult = {
  operationId?: string;
  transferId?: string;
  quantity?: number;
  duplicate?: boolean;
  recovered?: boolean;
  status?: string;
  flowNumbers?: Array<number | string>;
  backingMoved?: boolean;
};

type StoredOperation = {
  operationId: string;
  publicToken: string;
  quantity: number;
  status: "PENDING" | "COMPLETED";
  result?: TransferResult | null;
};

type Props = {
  publicToken: string;
  recipientLabel: string;
  profileHref?: string | null;
  profileImageUrl?: string | null;
};

function storageKey(publicToken: string, userId: string) {
  return `clouva:flow-qr-payment:${userId}:${publicToken}`;
}

export function FlowQrPaymentCard({ publicToken, recipientLabel, profileHref, profileImageUrl }: Props) {
  const { session, loading } = useAuth();
  const userId = session?.user.id ?? null;
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const recoveryStarted = useRef(false);

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
  }, [loading, publicToken, userId]);

  async function postPayment(id: string, amount: number) {
    if (!session?.access_token) return;
    const response = await fetch("/api/flows/transfer", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        "idempotency-key": id,
      },
      body: JSON.stringify({ publicToken, quantity: amount }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "No se pudo completar el pago en FLOW.");
    const transfer = (body.transfer || body.operation || {}) as TransferResult;
    const normalized = { ...transfer, operationId: transfer.operationId || id };
    setResult(normalized);
    persist({ operationId: id, publicToken, quantity: amount, status: "COMPLETED", result: normalized });
  }

  async function recover(id: string, amount: number) {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/flows/transfer?operationId=${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.transfer) {
        const transfer = { ...(body.transfer as TransferResult), operationId: id, recovered: true };
        setResult(transfer);
        persist({ operationId: id, publicToken, quantity: amount, status: "COMPLETED", result: transfer });
        return;
      }
      if (response.status !== 404) throw new Error(body.error || "No se pudo recuperar la operación FLOW.");

      await postPayment(id, amount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo recuperar la operación FLOW.");
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
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(null);

    const id = operationId || crypto.randomUUID();
    if (!operationId) {
      setOperationId(id);
      persist({ operationId: id, publicToken, quantity, status: "PENDING" });
    }

    try {
      await postPayment(id, quantity);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar el pago en FLOW.");
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
  const paidQuantity = result?.quantity || quantity;

  return (
    <section className="mx-auto w-full max-w-md overflow-hidden rounded-[2rem] border border-violet-400/25 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.22),transparent_45%),#0a0810] p-5 shadow-[0_28px_90px_rgba(91,33,182,.2)] sm:p-7">
      <div className="flex items-center gap-3">
        {profileImageUrl ? (
          <img src={profileImageUrl} alt="" className="h-12 w-12 rounded-full border border-white/10 object-cover" />
        ) : (
          <div className="grid h-12 w-12 place-items-center rounded-full border border-violet-300/20 bg-violet-500/10 text-lg font-black text-violet-200">C</div>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[.2em] text-violet-300">Pagar con FLOW</p>
          <h1 className="truncate text-xl font-semibold text-white">{recipientLabel}</h1>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[.18em] text-white/40">Cantidad</p>
            <p className="mt-1 text-sm text-white/55">1 FLOW = US$ 1 de referencia</p>
          </div>
          <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-1">
            <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} disabled={busy || intentLocked || quantity <= 1} className="h-10 w-10 rounded-lg text-xl text-white/70 disabled:opacity-25" aria-label="Restar un FLOW">−</button>
            <input
              value={quantity}
              onChange={(event) => {
                if (intentLocked) return;
                const next = Number(event.target.value);
                if (Number.isInteger(next)) setQuantity(Math.min(50, Math.max(1, next)));
              }}
              disabled={busy || intentLocked}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Cantidad de FLOW"
              className="w-12 bg-transparent text-center text-lg font-bold text-white outline-none disabled:opacity-60"
            />
            <button type="button" onClick={() => setQuantity((value) => Math.min(50, value + 1))} disabled={busy || intentLocked || quantity >= 50} className="h-10 w-10 rounded-lg text-xl text-white/70 disabled:opacity-25" aria-label="Sumar un FLOW">+</button>
          </div>
        </div>
        {intentLocked ? <p className="mt-3 text-xs text-white/40">Importe bloqueado para esta operación. “Nuevo pago” crea una identidad nueva.</p> : null}
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/[.06] p-3 text-xs leading-5 text-emerald-100/75">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Solo se transfieren FLOWS con respaldo 1:1 y custodia confirmada. El dinero de reserva no se mueve cuando cambia el propietario.</p>
      </div>

      {loading || !hydrated ? <p className="mt-5 text-center text-sm text-white/45">Verificando tu sesión…</p> : null}

      {!loading && hydrated && !session?.access_token ? (
        <Link href={`/login?next=${encodeURIComponent(`/q/${publicToken}`)}`} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white">
          Iniciar sesión para pagar <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}

      {!loading && hydrated && session?.access_token && !result ? (
        <button type="button" onClick={pay} disabled={busy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white disabled:cursor-wait disabled:opacity-55">
          {busy ? "Recuperando / confirmando…" : operationId ? "Reintentar misma operación" : `Pagar ${quantity} FLOW${quantity === 1 ? "" : "S"}`}
          {!busy ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      ) : null}

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[.06] p-3 text-sm text-red-200">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-4 text-emerald-100">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" /> Pago confirmado</div>
          <p className="mt-2 text-sm text-emerald-100/70">
            {paidQuantity} FLOW{paidQuantity === 1 ? "" : "S"} transferido{paidQuantity === 1 ? "" : "s"}.
            {Array.isArray(result.flowNumbers) && result.flowNumbers.length ? ` FLOW ${result.flowNumbers.map((value) => `#${String(value).padStart(6, "0")}`).join(", ")}.` : ""}
          </p>
          <div className="mt-2 space-y-1 break-all font-mono text-[10px] text-emerald-100/45">
            <p>Operación {result.operationId || operationId}</p>
            {result.transferId ? <p>Transferencia {result.transferId}</p> : null}
          </div>
          <Link href="/mi-flow" className="mt-3 inline-block text-sm font-semibold text-emerald-100/80 hover:text-emerald-50">Ver movimientos en Mi Flow</Link>
        </div>
      ) : null}

      {operationId ? (
        <button type="button" onClick={newPayment} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white/65 disabled:opacity-40">
          <RotateCcw className="h-4 w-4" /> Nuevo pago
        </button>
      ) : null}

      {profileHref ? <Link href={profileHref} className="mt-5 block text-center text-sm text-violet-200/70 hover:text-violet-100">Ver perfil Player</Link> : null}
    </section>
  );
}
