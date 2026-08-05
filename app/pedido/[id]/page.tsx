"use client";

import { MainFooter, MainNav } from "@/components/layout";
import { useEffect, useState } from "react";

type StoreOrder = {
  id: string;
  order_number: number;
  total: number;
  total_cents: number;
  currency: string;
  payment_status: string;
  shipping_status: string;
  status: string;
  paid_at: string | null;
};

const TERMINAL_PAYMENT_STATES = new Set(["pagado", "rechazado", "cancelado", "reembolsado"]);

function paymentCopy(status: string) {
  if (status === "pagado") return "Pago confirmado";
  if (status === "pendiente_aprobacion") return "Mercado Pago está procesando el pago";
  if (status === "rechazado") return "El pago fue rechazado";
  if (status === "cancelado") return "El pago fue cancelado";
  if (status === "reembolsado") return "El pago fue reembolsado";
  return "Esperando el pago";
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [token, setToken] = useState("");
  const [returnState, setReturnState] = useState("");
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void params.then(({ id: resolvedId }) => setId(resolvedId));
    const search = new URLSearchParams(window.location.search);
    setToken(search.get("token") || "");
    setReturnState(search.get("return") || "");
  }, [params]);

  useEffect(() => {
    if (!id || !token) return;
    let active = true;
    let pollId: number | undefined;
    let stopId: number | undefined;

    async function loadOrder() {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as { order?: StoreOrder; error?: string };
        if (!response.ok || !payload.order) throw new Error(payload.error || "No se pudo cargar el pedido.");
        if (!active) return;
        setOrder(payload.order);
        setError("");
        if (TERMINAL_PAYMENT_STATES.has(payload.order.payment_status) && pollId) {
          window.clearInterval(pollId);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el pedido.");
      }
    }

    void loadOrder();
    pollId = window.setInterval(() => void loadOrder(), 2500);
    stopId = window.setTimeout(() => {
      if (pollId) window.clearInterval(pollId);
    }, 45000);

    return () => {
      active = false;
      if (pollId) window.clearInterval(pollId);
      if (stopId) window.clearTimeout(stopId);
    };
  }, [id, token]);

  const returnedApproved = returnState === "success";
  const paymentConfirmed = order?.payment_status === "pagado";

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-3xl px-4 py-14 md:px-8">
        {!token ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-400/10 p-6 text-red-100">
            El enlace de este pedido está incompleto.
          </div>
        ) : error && !order ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-400/10 p-6 text-red-100">{error}</div>
        ) : !order ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">Confirmando tu pedido…</div>
        ) : (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#95d8ff]/70">CLOUVA Store</p>
            <h1 className="mt-3 text-3xl font-semibold">Pedido #{order.order_number}</h1>

            <div
              className={`mt-6 rounded-2xl border p-5 ${
                paymentConfirmed
                  ? "border-emerald-400/25 bg-emerald-400/10"
                  : order.payment_status === "rechazado" || order.payment_status === "cancelado"
                    ? "border-red-400/25 bg-red-400/10"
                    : "border-[#95d8ff]/20 bg-[#95d8ff]/10"
              }`}
            >
              <p className="text-lg font-semibold">{paymentCopy(order.payment_status)}</p>
              {returnedApproved && !paymentConfirmed ? (
                <p className="mt-2 text-sm text-white/60">Mercado Pago te devolvió a CLOUVA. Estamos esperando la confirmación firmada del pago.</p>
              ) : null}
              {paymentConfirmed ? <p className="mt-2 text-sm text-white/60">Tu merch ya quedó registrado para preparación.</p> : null}
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 p-4">
                <dt className="text-xs uppercase tracking-[0.18em] text-white/40">Total</dt>
                <dd className="mt-2 text-xl font-semibold">
                  {new Intl.NumberFormat("es-AR", { style: "currency", currency: order.currency || "ARS" }).format(Number(order.total))}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 p-4">
                <dt className="text-xs uppercase tracking-[0.18em] text-white/40">Preparación</dt>
                <dd className="mt-2 text-xl font-semibold capitalize">{order.shipping_status}</dd>
              </div>
            </dl>

            {error ? <p className="mt-5 text-sm text-amber-200">{error}</p> : null}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
