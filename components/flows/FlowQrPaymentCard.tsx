"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type TransferResult = {
  transferId?: string;
  quantity?: number;
  duplicate?: boolean;
  flowNumbers?: Array<number | string>;
  backingMoved?: boolean;
};

type Props = {
  publicToken: string;
  recipientLabel: string;
  profileHref?: string | null;
  profileImageUrl?: string | null;
};

export function FlowQrPaymentCard({ publicToken, recipientLabel, profileHref, profileImageUrl }: Props) {
  const { session, loading } = useAuth();
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    idempotencyKey.current = null;
    setError(null);
    setResult(null);
  }, [quantity, publicToken]);

  async function pay() {
    if (!session?.access_token || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

    try {
      const response = await fetch("/api/flows/transfer", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify({ publicToken, quantity }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "No se pudo completar el pago en FLOW.");
      setResult((body.transfer || {}) as TransferResult);
      idempotencyKey.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar el pago en FLOW.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md overflow-hidden rounded-[2rem] border border-violet-400/25 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,.22),transparent_45%),#0a0810] p-5 shadow-[0_28px_90px_rgba(91,33,182,.2)] sm:p-7">
      <div className="flex items-center gap-3">
        {profileImageUrl ? (
          <img src={profileImageUrl} alt="" className="h-12 w-12 rounded-full border border-white/10 object-cover" />
        ) : (
          <div className="grid h-12 w-12 place-items-center rounded-full border border-violet-300/20 bg-violet-500/10 text-lg font-black text-violet-200">
            C
          </div>
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
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              disabled={busy || quantity <= 1}
              className="h-10 w-10 rounded-lg text-xl text-white/70 disabled:opacity-25"
              aria-label="Restar un FLOW"
            >
              −
            </button>
            <input
              value={quantity}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isInteger(next)) setQuantity(Math.min(50, Math.max(1, next)));
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Cantidad de FLOW"
              className="w-12 bg-transparent text-center text-lg font-bold text-white outline-none"
            />
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.min(50, value + 1))}
              disabled={busy || quantity >= 50}
              className="h-10 w-10 rounded-lg text-xl text-white/70 disabled:opacity-25"
              aria-label="Sumar un FLOW"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-400/[.06] p-3 text-xs leading-5 text-emerald-100/75">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Solo se transfieren FLOWS con respaldo 1:1 y custodia confirmada. El dinero de reserva no se mueve cuando cambia el propietario.</p>
      </div>

      {loading ? <p className="mt-5 text-center text-sm text-white/45">Verificando tu sesión…</p> : null}

      {!loading && !session?.access_token ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/q/${publicToken}`)}`}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white"
        >
          Iniciar sesión para pagar <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}

      {!loading && session?.access_token ? (
        <button
          type="button"
          onClick={pay}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3.5 font-semibold text-white disabled:cursor-wait disabled:opacity-55"
        >
          {busy ? "Confirmando…" : `Pagar ${quantity} FLOW${quantity === 1 ? "" : "S"}`}
          {!busy ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      ) : null}

      {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[.06] p-3 text-sm text-red-200">{error}</p> : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-4 text-emerald-100">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" /> Pago confirmado</div>
          <p className="mt-2 text-sm text-emerald-100/70">
            {result.quantity || quantity} FLOW{(result.quantity || quantity) === 1 ? "" : "S"} transferido{(result.quantity || quantity) === 1 ? "" : "s"}.
            {Array.isArray(result.flowNumbers) && result.flowNumbers.length ? ` FLOW ${result.flowNumbers.map((value) => `#${String(value).padStart(6, "0")}`).join(", ")}.` : ""}
          </p>
        </div>
      ) : null}

      {profileHref ? (
        <Link href={profileHref} className="mt-5 block text-center text-sm text-violet-200/70 hover:text-violet-100">
          Ver perfil Player
        </Link>
      ) : null}
    </section>
  );
}
