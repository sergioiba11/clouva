"use client";

import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { money } from "@/lib/store-utils";

type LegacyOrder = {
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

type CommerceOrder = {
  id: string;
  seller_type: string;
  subtotal: number;
  shipping_subtotal: number;
  total: number;
  currency: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  refunded_at: string | null;
};

type CommerceItem = {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  product_type: string;
  sku_snapshot: string | null;
  variant_snapshot: Record<string, unknown> | null;
  quantity: number;
  unit_price: number;
  total: number;
  delivery_status: string;
  delivered_at: string | null;
};

type CommerceShipment = {
  id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string;
  delivery_method: "shipping" | "pickup";
  carrier: string | null;
  shipping_cost: number;
  status: string;
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
  shipping_method_snapshot: Record<string, unknown> | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

type CommerceEvent = {
  id: string;
  event_type: string;
  note: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type CommercePayload = {
  order: CommerceOrder;
  items: CommerceItem[];
  shipment: CommerceShipment | null;
  events: CommerceEvent[];
};

const LEGACY_TERMINAL_PAYMENT_STATES = new Set(["pagado", "rechazado", "cancelado", "reembolsado"]);
const COMMERCE_TERMINAL_PAYMENT_STATES = new Set(["paid", "failed", "refunded"]);

function legacyPaymentCopy(status: string) {
  if (status === "pagado") return "Pago confirmado";
  if (status === "pendiente_aprobacion") return "Mercado Pago está procesando el pago";
  if (status === "rechazado") return "El pago fue rechazado";
  if (status === "cancelado") return "El pago fue cancelado";
  if (status === "reembolsado") return "El pago fue reembolsado";
  return "Esperando el pago";
}

function commercePaymentCopy(status: string) {
  if (status === "paid") return "Pago confirmado";
  if (status === "failed") return "El pago no fue aprobado";
  if (status === "refunded") return "El pago fue reembolsado";
  return "Esperando la confirmación de Mercado Pago";
}

function fulfillmentCopy(status: string) {
  const copies: Record<string, string> = {
    pending: "Pendiente de preparación",
    stock_conflict: "Revisión de stock requerida",
    preparing: "En preparación",
    ready_to_ship: "Listo para despachar",
    shipped: "Despachado",
    delivered: "Entregado",
    cancelled: "Cancelado",
    returned: "Devuelto",
    completed: "Completado",
  };
  return copies[status] ?? status;
}

function shipmentCopy(status: string) {
  const copies: Record<string, string> = {
    pending: "Pendiente",
    preparing: "En preparación",
    ready_to_ship: "Listo para despachar",
    shipped: "Despachado",
    delivered: "Entregado",
    cancelled: "Cancelado",
    returned: "Devuelto",
  };
  return copies[status] ?? status;
}

function eventCopy(type: string) {
  const copies: Record<string, string> = {
    checkout_started: "Checkout iniciado",
    payment_pending: "Pago en proceso",
    payment_approved: "Pago confirmado",
    payment_approved_stock_conflict: "Pago confirmado con revisión de stock",
    payment_rejected: "Pago rechazado",
    payment_cancelled: "Pago cancelado",
    payment_refunded: "Pago reembolsado",
    item_delivered: "Producto digital entregado",
    item_delivery_failed: "Entrega digital pendiente de reintento",
    order_completed: "Pedido completado",
    preparing: "Preparación iniciada",
    ready_to_ship: "Pedido listo para despachar",
    shipped: "Pedido despachado",
    delivered: "Pedido entregado",
    returned: "Pedido devuelto",
  };
  return copies[type] ?? type.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleString("es-AR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

function variantDescription(item: CommerceItem) {
  const snapshot = item.variant_snapshot ?? {};
  return [snapshot.title, snapshot.size, snapshot.color]
    .filter((value): value is string => typeof value === "string" && Boolean(value))
    .join(" · ");
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = useAuth();
  const [id, setId] = useState("");
  const [token, setToken] = useState("");
  const [source, setSource] = useState<"legacy" | "commerce">("legacy");
  const [returnState, setReturnState] = useState("");
  const [legacyOrder, setLegacyOrder] = useState<LegacyOrder | null>(null);
  const [commerce, setCommerce] = useState<CommercePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void params.then(({ id: resolvedId }) => setId(resolvedId));
    const search = new URLSearchParams(window.location.search);
    setToken(search.get("token") || "");
    setSource(search.get("source") === "commerce" ? "commerce" : "legacy");
    setReturnState(search.get("return") || search.get("status") || "");
  }, [params]);

  useEffect(() => {
    if (!id || (!token && !session?.access_token)) return;
    let active = true;
    let pollId = 0;

    async function loadOrder() {
      try {
        const isCommerce = source === "commerce";
        const endpoint = isCommerce
          ? `/api/commerce/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`
          : `/api/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        });
        const payload = (await response.json().catch(() => ({}))) as
          | (Partial<CommercePayload> & { error?: string })
          | { order?: LegacyOrder; error?: string };
        if (!response.ok || !payload.order) {
          throw new Error(payload.error || "No se pudo cargar el pedido.");
        }
        if (!active) return;

        setError("");
        if (isCommerce) {
          const next = payload as CommercePayload;
          setCommerce(next);
          setLegacyOrder(null);
          if (COMMERCE_TERMINAL_PAYMENT_STATES.has(next.order.payment_status)) {
            window.clearInterval(pollId);
          }
        } else {
          const next = (payload as { order: LegacyOrder }).order;
          setLegacyOrder(next);
          setCommerce(null);
          if (LEGACY_TERMINAL_PAYMENT_STATES.has(next.payment_status)) {
            window.clearInterval(pollId);
          }
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el pedido.");
      }
    }

    pollId = window.setInterval(() => void loadOrder(), 2500);
    const stopId = window.setTimeout(() => window.clearInterval(pollId), 45000);
    void loadOrder();

    return () => {
      active = false;
      window.clearInterval(pollId);
      window.clearTimeout(stopId);
    };
  }, [id, session?.access_token, source, token]);

  const hasAccessData = Boolean(token || session?.access_token);
  const loading = source === "commerce" ? !commerce : !legacyOrder;

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-4xl px-4 py-14 md:px-8">
        {!hasAccessData ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-400/10 p-6 text-red-100">
            El enlace de este pedido está incompleto. También podés iniciar sesión con la cuenta que hizo la compra.
          </div>
        ) : error && loading ? (
          <div className="rounded-[2rem] border border-red-400/20 bg-red-400/10 p-6 text-red-100">{error}</div>
        ) : loading ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">Confirmando tu pedido…</div>
        ) : commerce ? (
          <CommerceOrderView payload={commerce} returnState={returnState} error={error} />
        ) : legacyOrder ? (
          <LegacyOrderView order={legacyOrder} returnState={returnState} error={error} />
        ) : null}
      </section>
      <MainFooter />
    </main>
  );
}

function CommerceOrderView({ payload, returnState, error }: { payload: CommercePayload; returnState: string; error: string }) {
  const { order, items, shipment, events } = payload;
  const paymentConfirmed = order.payment_status === "paid";
  const paymentFailed = order.payment_status === "failed" || order.payment_status === "refunded";
  const methodName = shipment?.shipping_method_snapshot?.name;
  const address = shipment
    ? [shipment.address_line_1, shipment.address_line_2, shipment.city, shipment.province, shipment.postal_code, shipment.country]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#95d8ff]/70">CLOUVA Store</p>
        <h1 className="mt-3 text-3xl font-semibold">Pedido {order.id.slice(0, 8).toUpperCase()}</h1>
        <p className="mt-2 text-sm text-white/40">Creado {formatDate(order.created_at)}</p>

        <div
          className={`mt-6 rounded-2xl border p-5 ${
            paymentConfirmed
              ? "border-emerald-400/25 bg-emerald-400/10"
              : paymentFailed
                ? "border-red-400/25 bg-red-400/10"
                : "border-[#95d8ff]/20 bg-[#95d8ff]/10"
          }`}
        >
          <p className="text-lg font-semibold">{commercePaymentCopy(order.payment_status)}</p>
          {returnState === "success" && !paymentConfirmed ? (
            <p className="mt-2 text-sm text-white/60">
              Mercado Pago te devolvió a CLOUVA. Estamos esperando la notificación firmada del pago.
            </p>
          ) : null}
          {order.fulfillment_status === "stock_conflict" ? (
            <p className="mt-2 text-sm text-amber-100">
              El pago está registrado. El equipo de CLOUVA debe resolver la disponibilidad física antes de preparar.
            </p>
          ) : null}
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <InfoCard label="Productos" value={money(Number(order.subtotal), order.currency)} />
          <InfoCard label="Entrega" value={money(Number(order.shipping_subtotal), order.currency)} />
          <InfoCard label="Total" value={money(Number(order.total), order.currency)} />
        </dl>
      </div>

      <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-xl font-semibold">Productos</h2>
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-2xl border border-white/10 p-4 sm:grid-cols-[1fr_auto]">
              <div>
                <h3 className="font-medium">{item.product_name}</h3>
                {variantDescription(item) ? <p className="mt-1 text-sm text-white/50">{variantDescription(item)}</p> : null}
                {item.sku_snapshot ? <p className="mt-1 text-xs text-white/35">SKU {item.sku_snapshot}</p> : null}
                {item.product_type !== "physical" ? (
                  <p className="mt-2 text-xs text-[#95d8ff]/70">Entrega digital: {item.delivery_status}</p>
                ) : null}
              </div>
              <div className="text-left sm:text-right">
                <p>{item.quantity} × {money(Number(item.unit_price), order.currency)}</p>
                <strong>{money(Number(item.total), order.currency)}</strong>
              </div>
            </div>
          ))}
        </div>
      </section>

      {shipment ? (
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">{shipment.delivery_method === "pickup" ? "Retiro" : "Entrega"}</h2>
              <p className="mt-1 text-sm text-white/45">
                {typeof methodName === "string" ? methodName : shipment.delivery_method === "pickup" ? "Retiro coordinado" : "Envío a domicilio"}
              </p>
            </div>
            <span className="rounded-full border border-white/10 px-4 py-2 text-sm">{shipmentCopy(shipment.status)}</span>
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <InfoCard label="Destinatario" value={shipment.recipient_name || "—"} />
            <InfoCard label="Preparación" value={fulfillmentCopy(order.fulfillment_status)} />
            {shipment.delivery_method === "shipping" ? <InfoCard label="Dirección" value={address || "—"} /> : null}
            <InfoCard label="Transportista" value={shipment.carrier || "A definir"} />
          </dl>

          {shipment.tracking_number || shipment.tracking_url ? (
            <div className="mt-5 rounded-2xl border border-[#95d8ff]/20 bg-[#95d8ff]/5 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Seguimiento</p>
              {shipment.tracking_number ? <p className="mt-2 font-semibold">{shipment.tracking_number}</p> : null}
              {shipment.tracking_url ? (
                <a
                  href={shipment.tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-sm text-[#95d8ff]"
                >
                  Ver seguimiento del transportista
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-xl font-semibold">Historial</h2>
        <div className="mt-4 space-y-4 border-l border-white/10 pl-5">
          {events.length ? (
            events.map((event) => (
              <div key={event.id} className="relative">
                <span className="absolute -left-[1.42rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[#95d8ff]" />
                <p className="font-medium capitalize">{eventCopy(event.event_type)}</p>
                {event.note ? <p className="mt-1 text-sm text-white/50">{event.note}</p> : null}
                <p className="mt-1 text-xs text-white/30">{formatDate(event.created_at)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-white/45">El historial aparecerá cuando el pedido cambie de estado.</p>
          )}
        </div>
      </section>

      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
    </div>
  );
}

function LegacyOrderView({ order, returnState, error }: { order: LegacyOrder; returnState: string; error: string }) {
  const paymentConfirmed = order.payment_status === "pagado";

  return (
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
        <p className="text-lg font-semibold">{legacyPaymentCopy(order.payment_status)}</p>
        {returnState === "success" && !paymentConfirmed ? (
          <p className="mt-2 text-sm text-white/60">
            Mercado Pago te devolvió a CLOUVA. Estamos esperando la confirmación firmada del pago.
          </p>
        ) : null}
        {paymentConfirmed ? <p className="mt-2 text-sm text-white/60">Tu merch ya quedó registrado para preparación.</p> : null}
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoCard label="Total" value={money(Number(order.total), order.currency || "ARS")} />
        <InfoCard label="Preparación" value={order.shipping_status} />
      </dl>

      {error ? <p className="mt-5 text-sm text-amber-200">{error}</p> : null}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <dt className="text-xs uppercase tracking-[0.18em] text-white/40">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
