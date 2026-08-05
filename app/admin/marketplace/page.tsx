"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";
import { useAuth } from "@/components/auth-provider";

type ProductRow = {
  id: string;
  owner_type: "player" | "studio" | "clouva";
  product_type: string;
  name: string;
  price: number;
  currency: string;
  stock: number | null;
  status: string;
  created_at: string;
  players: { display_name: string | null; slug: string } | null;
  studios: { name: string; slug: string } | null;
};

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_type: "player" | "studio" | "clouva";
  total: number;
  shipping_subtotal: number;
  commission: number;
  currency: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  players: { display_name: string | null; slug: string } | null;
  studios: { name: string; slug: string } | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  product_name: string;
  product_type: string;
  sku_snapshot: string | null;
  variant_snapshot: Record<string, unknown> | null;
  quantity: number;
  unit_price: number;
  total: number;
  delivery_status: string;
};

type ShipmentRow = {
  id: string;
  order_id: string;
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
  status: string;
  tracking_number: string | null;
  tracking_url: string | null;
  label_url: string | null;
};

type OrderEventRow = {
  id: string;
  order_id: string;
  event_type: string;
  note: string | null;
  created_at: string;
};

type ProfileLite = { id: string; full_name: string | null; username: string | null; email?: string | null };

type ShippingMethodRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  delivery_method: "shipping" | "pickup";
  carrier: string | null;
  pricing_type: "flat" | "free" | "adapter";
  flat_price: number | null;
  currency: string;
  active: boolean;
};

type FulfillmentDraft = {
  fulfillmentStatus: string;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
  note: string;
};

type ShippingMethodDraft = {
  name: string;
  code: string;
  description: string;
  deliveryMethod: "shipping" | "pickup";
  pricingType: "flat" | "free";
  flatPrice: string;
  carrier: string;
};

const money = (value: number, currency = "ARS") =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

const STATUS_STYLE: Record<string, string> = {
  published: "text-emerald-300",
  draft: "text-white/50",
  pending_review: "text-amber-300",
  paused: "text-amber-300",
  archived: "text-white/40",
  rejected: "text-red-300",
  sold_out: "text-red-300",
};

const FULFILLMENT_OPTIONS = [
  ["preparing", "En preparación"],
  ["ready_to_ship", "Listo para despachar"],
  ["shipped", "Despachado"],
  ["delivered", "Entregado"],
  ["cancelled", "Cancelado"],
  ["returned", "Devuelto"],
] as const;

const EMPTY_METHOD: ShippingMethodDraft = {
  name: "",
  code: "",
  description: "",
  deliveryMethod: "shipping",
  pricingType: "flat",
  flatPrice: "",
  carrier: "",
};

function sellerName(row: {
  owner_type?: string;
  seller_type?: string;
  players: { display_name: string | null; slug: string } | null;
  studios: { name: string; slug: string } | null;
}) {
  const type = row.owner_type ?? row.seller_type;
  if (type === "clouva") return "CLOUVA";
  if (type === "player") return row.players?.display_name || row.players?.slug || "Player";
  if (type === "studio") return row.studios?.name || row.studios?.slug || "Estudio";
  return "—";
}

function variantCopy(item: OrderItemRow) {
  const variant = item.variant_snapshot ?? {};
  return [variant.title, variant.size, variant.color]
    .filter((value): value is string => typeof value === "string" && Boolean(value))
    .join(" · ");
}

function addressCopy(shipment: ShipmentRow | undefined) {
  if (!shipment || shipment.delivery_method === "pickup") return "Retiro";
  return [
    shipment.address_line_1,
    shipment.address_line_2,
    shipment.city,
    shipment.province,
    shipment.postal_code,
    shipment.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export default function MarketplaceAdminPage() {
  const { session, user } = useAuth();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, OrderItemRow[]>>({});
  const [shipmentsByOrder, setShipmentsByOrder] = useState<Record<string, ShipmentRow>>({});
  const [eventsByOrder, setEventsByOrder] = useState<Record<string, OrderEventRow[]>>({});
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [shippingMethods, setShippingMethods] = useState<ShippingMethodRow[]>([]);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [fulfillmentDrafts, setFulfillmentDrafts] = useState<Record<string, FulfillmentDraft>>({});
  const [methodDraft, setMethodDraft] = useState<ShippingMethodDraft>(EMPTY_METHOD);
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [savingMethod, setSavingMethod] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const [productsResult, ordersResult, itemsResult, shipmentsResult, eventsResult, methodsResult] = await Promise.all([
      supabase
        .from("commerce_products")
        .select("id,owner_type,product_type,name,price,currency,stock,status,created_at,players(display_name,slug),studios(name,slug)")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("commerce_orders")
        .select(
          "id,buyer_id,seller_type,total,shipping_subtotal,commission,currency,status,payment_status,fulfillment_status,created_at,paid_at,refunded_at,players:seller_player_id(display_name,slug),studios:seller_studio_id(name,slug)",
        )
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("commerce_order_items")
        .select("id,order_id,product_name,product_type,sku_snapshot,variant_snapshot,quantity,unit_price,total,delivery_status")
        .order("id"),
      supabase
        .from("commerce_shipments")
        .select(
          "id,order_id,recipient_name,recipient_phone,recipient_email,address_line_1,address_line_2,city,province,postal_code,country,delivery_method,carrier,status,tracking_number,tracking_url,label_url",
        ),
      supabase.from("commerce_order_events").select("id,order_id,event_type,note,created_at").order("created_at", { ascending: false }),
      supabase
        .from("commerce_shipping_methods")
        .select("id,code,name,description,delivery_method,carrier,pricing_type,flat_price,currency,active")
        .eq("owner_type", "clouva")
        .order("created_at", { ascending: false }),
    ]);

    const firstError =
      productsResult.error ||
      ordersResult.error ||
      itemsResult.error ||
      shipmentsResult.error ||
      eventsResult.error ||
      methodsResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const orderRows = (ordersResult.data ?? []) as unknown as OrderRow[];
    const buyerIds = Array.from(new Set(orderRows.map((order) => order.buyer_id)));
    const { data: profileRows, error: profilesError } = buyerIds.length
      ? await supabase.from("profiles").select("id,full_name,username,email").in("id", buyerIds)
      : { data: [] as ProfileLite[], error: null };
    if (profilesError) {
      setError(profilesError.message);
      setLoading(false);
      return;
    }

    const nextItems: Record<string, OrderItemRow[]> = {};
    for (const item of (itemsResult.data ?? []) as OrderItemRow[]) {
      nextItems[item.order_id] = [...(nextItems[item.order_id] ?? []), item];
    }
    const nextShipments: Record<string, ShipmentRow> = {};
    for (const shipment of (shipmentsResult.data ?? []) as ShipmentRow[]) nextShipments[shipment.order_id] = shipment;
    const nextEvents: Record<string, OrderEventRow[]> = {};
    for (const event of (eventsResult.data ?? []) as OrderEventRow[]) {
      nextEvents[event.order_id] = [...(nextEvents[event.order_id] ?? []), event];
    }

    setProducts((productsResult.data ?? []) as unknown as ProductRow[]);
    setOrders(orderRows);
    setItemsByOrder(nextItems);
    setShipmentsByOrder(nextShipments);
    setEventsByOrder(nextEvents);
    setProfiles(Object.fromEntries((profileRows ?? []).map((profile) => [profile.id, profile])));
    setShippingMethods((methodsResult.data ?? []) as ShippingMethodRow[]);
    setFulfillmentDrafts((current) => {
      const next = { ...current };
      for (const order of orderRows) {
        const shipment = nextShipments[order.id];
        if (!next[order.id]) {
          next[order.id] = {
            fulfillmentStatus: order.fulfillment_status === "pending" ? "preparing" : order.fulfillment_status,
            carrier: shipment?.carrier ?? "",
            trackingNumber: shipment?.tracking_number ?? "",
            trackingUrl: shipment?.tracking_url ?? "",
            labelUrl: shipment?.label_url ?? "",
            note: "",
          };
        }
      }
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const published = products.filter((product) => product.status === "published").length;
    const pendingCatalog = products.filter((product) => product.status === "pending_review" || product.status === "draft").length;
    const paidOrders = orders.filter((order) => order.payment_status === "paid" && !order.refunded_at);
    const gmv = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const commissions = paidOrders.reduce((sum, order) => sum + Number(order.commission || 0), 0);
    const toPrepare = paidOrders.filter((order) => ["pending", "preparing", "stock_conflict"].includes(order.fulfillment_status)).length;
    return { published, pendingCatalog, gmv, commissions, toPrepare };
  }, [products, orders]);

  const operationalOrders = useMemo(
    () =>
      [...orders].sort((a, b) => {
        const priority = (order: OrderRow) => {
          if (order.fulfillment_status === "stock_conflict") return 0;
          if (order.payment_status === "paid" && ["pending", "preparing", "ready_to_ship"].includes(order.fulfillment_status)) return 1;
          if (order.payment_status === "paid") return 2;
          return 3;
        };
        return priority(a) - priority(b) || +new Date(b.created_at) - +new Date(a.created_at);
      }),
    [orders],
  );

  async function callOrderAction(orderId: string, body: Record<string, unknown>) {
    if (!session?.access_token) {
      setError("La sesión de administración no está disponible.");
      return;
    }
    setBusyOrderId(orderId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/commerce/orders/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo actualizar el pedido.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el pedido.");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function saveShippingMethod() {
    const price = Number(methodDraft.flatPrice || 0);
    if (!methodDraft.name.trim() || !methodDraft.code.trim()) {
      setError("Completá nombre y código del método de entrega.");
      return;
    }
    if (methodDraft.pricingType === "flat" && (!Number.isFinite(price) || price < 0)) {
      setError("El precio fijo de entrega no es válido.");
      return;
    }

    setSavingMethod(true);
    setError(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error: insertError } = await supabase.from("commerce_shipping_methods").insert({
        owner_type: "clouva",
        player_id: null,
        studio_id: null,
        code: methodDraft.code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        name: methodDraft.name.trim(),
        description: methodDraft.description.trim() || null,
        delivery_method: methodDraft.deliveryMethod,
        carrier: methodDraft.carrier.trim() || null,
        pricing_type: methodDraft.pricingType,
        flat_price: methodDraft.pricingType === "flat" ? price : 0,
        currency: "ARS",
        active: true,
        created_by: user?.id ?? null,
      });
      if (insertError) throw new Error(insertError.message);
      setMethodDraft(EMPTY_METHOD);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el método de entrega.");
    } finally {
      setSavingMethod(false);
    }
  }

  async function toggleShippingMethod(method: ShippingMethodRow) {
    const { supabase } = await import("@/lib/supabase");
    const { error: updateError } = await supabase
      .from("commerce_shipping_methods")
      .update({ active: !method.active })
      .eq("id", method.id);
    if (updateError) setError(updateError.message);
    else await load();
  }

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Operaciones de comercio</h1>
        <p className="mt-1 text-sm text-white/50">
          Pedidos, fulfillment, stock, entrega y catálogo canónico. El estado de pago se recibe exclusivamente desde Mercado Pago.
        </p>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Pagados por preparar" value={loading ? "…" : stats.toPrepare} />
        <StatCard label="GMV pagado" value={loading ? "…" : money(stats.gmv)} />
        <StatCard label="Comisión CLOUVA" value={loading ? "…" : money(stats.commissions)} />
        <StatCard label="Productos publicados" value={loading ? "…" : stats.published} />
        <StatCard label="Catálogo pendiente" value={loading ? "…" : stats.pendingCatalog} />
      </div>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <PremiumCard className="p-5">
        <h2 className="text-lg font-semibold">Métodos de entrega CLOUVA</h2>
        <p className="mt-1 text-sm text-white/45">La tienda física solo cobra cuando existe al menos un método activo.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input className="rounded-xl bg-white/5 p-3" placeholder="Nombre" value={methodDraft.name} onChange={(event) => setMethodDraft((draft) => ({ ...draft, name: event.target.value }))} />
          <input className="rounded-xl bg-white/5 p-3" placeholder="Código" value={methodDraft.code} onChange={(event) => setMethodDraft((draft) => ({ ...draft, code: event.target.value }))} />
          <input className="rounded-xl bg-white/5 p-3" placeholder="Transportista" value={methodDraft.carrier} onChange={(event) => setMethodDraft((draft) => ({ ...draft, carrier: event.target.value }))} />
          <select className="rounded-xl bg-black p-3" value={methodDraft.deliveryMethod} onChange={(event) => setMethodDraft((draft) => ({ ...draft, deliveryMethod: event.target.value as "shipping" | "pickup" }))}>
            <option value="shipping">Envío a domicilio</option>
            <option value="pickup">Retiro</option>
          </select>
          <select className="rounded-xl bg-black p-3" value={methodDraft.pricingType} onChange={(event) => setMethodDraft((draft) => ({ ...draft, pricingType: event.target.value as "flat" | "free" }))}>
            <option value="flat">Precio fijo</option>
            <option value="free">Gratis</option>
          </select>
          <input className="rounded-xl bg-white/5 p-3" type="number" min="0" placeholder="Precio ARS" disabled={methodDraft.pricingType === "free"} value={methodDraft.flatPrice} onChange={(event) => setMethodDraft((draft) => ({ ...draft, flatPrice: event.target.value }))} />
          <textarea className="rounded-xl bg-white/5 p-3 md:col-span-2" placeholder="Descripción / instrucciones" value={methodDraft.description} onChange={(event) => setMethodDraft((draft) => ({ ...draft, description: event.target.value }))} />
          <button type="button" disabled={savingMethod} onClick={() => void saveShippingMethod()} className="rounded-xl bg-white px-4 py-3 font-semibold text-black disabled:opacity-50">
            {savingMethod ? "Guardando…" : "Crear método"}
          </button>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {shippingMethods.map((method) => (
            <div key={method.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm">
              <div>
                <p className="font-medium">{method.name}</p>
                <p className="text-white/45">
                  {method.delivery_method === "pickup" ? "Retiro" : method.carrier || "Envío"} · {method.pricing_type === "free" ? "Gratis" : money(Number(method.flat_price || 0), method.currency)}
                </p>
              </div>
              <button type="button" onClick={() => void toggleShippingMethod(method)} className={`rounded-full border px-3 py-1 ${method.active ? "border-emerald-400/30 text-emerald-200" : "border-white/15 text-white/45"}`}>
                {method.active ? "Activo" : "Inactivo"}
              </button>
            </div>
          ))}
        </div>
      </PremiumCard>

      <PremiumCard className="p-5">
        <h2 className="text-lg font-semibold">Pedidos ({orders.length})</h2>
        {!loading && !orders.length ? <p className="mt-3 text-sm text-white/50">Todavía no hay órdenes.</p> : null}
        <div className="mt-4 space-y-3">
          {operationalOrders.map((order) => {
            const buyer = profiles[order.buyer_id];
            const shipment = shipmentsByOrder[order.id];
            const orderItems = itemsByOrder[order.id] ?? [];
            const events = eventsByOrder[order.id] ?? [];
            const draft = fulfillmentDrafts[order.id];
            const expanded = expandedOrderId === order.id;
            const paid = order.payment_status === "paid";
            const stockConflict = order.fulfillment_status === "stock_conflict";

            return (
              <article key={order.id} className={`rounded-2xl border p-4 ${stockConflict ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-black/20"}`}>
                <button type="button" onClick={() => setExpandedOrderId(expanded ? null : order.id)} className="grid w-full gap-2 text-left md:grid-cols-7 md:items-center">
                  <span className="font-medium">{buyer?.full_name || buyer?.username || order.buyer_id.slice(0, 8)}</span>
                  <span className="text-white/55">{sellerName(order)}</span>
                  <span>{money(Number(order.total), order.currency)}</span>
                  <span className={paid ? "text-emerald-300" : order.payment_status === "refunded" ? "text-amber-300" : "text-white/45"}>{order.payment_status}</span>
                  <span className={stockConflict ? "font-semibold text-amber-200" : "text-white/55"}>{order.fulfillment_status}</span>
                  <span className="text-white/45">{shipment?.delivery_method === "pickup" ? "Retiro" : shipment?.carrier || "Sin envío"}</span>
                  <span className="text-xs text-white/35">{when(order.paid_at ?? order.created_at)}</span>
                </button>

                {expanded ? (
                  <div className="mt-5 space-y-5 border-t border-white/10 pt-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-xl border border-white/10 p-3 text-sm">
                        <p className="text-xs uppercase tracking-wide text-white/35">Comprador</p>
                        <p className="mt-2">{buyer?.full_name || buyer?.username || "Sin nombre"}</p>
                        <p className="text-white/45">{buyer?.email || shipment?.recipient_email || "—"}</p>
                        <p className="text-white/45">{shipment?.recipient_phone || "—"}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 p-3 text-sm md:col-span-2">
                        <p className="text-xs uppercase tracking-wide text-white/35">Entrega</p>
                        <p className="mt-2">{addressCopy(shipment)}</p>
                        <p className="mt-1 text-white/45">Costo: {money(Number(order.shipping_subtotal || 0), order.currency)}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-wide text-white/35">Productos</p>
                      <div className="mt-2 space-y-2">
                        {orderItems.map((item) => (
                          <div key={item.id} className="flex flex-wrap justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm">
                            <div>
                              <p className="font-medium">{item.product_name} × {item.quantity}</p>
                              {variantCopy(item) ? <p className="text-white/50">{variantCopy(item)}</p> : null}
                              {item.sku_snapshot ? <p className="text-xs text-white/35">SKU {item.sku_snapshot}</p> : null}
                            </div>
                            <span>{money(Number(item.total), order.currency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {stockConflict ? (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                        <p className="font-semibold text-amber-100">Pago confirmado con conflicto de stock</p>
                        <p className="mt-1 text-sm text-amber-100/70">Corregí la disponibilidad física y después ejecutá la validación explícita. Esta acción vuelve a bloquear y descontar stock de forma atómica.</p>
                        <button type="button" disabled={busyOrderId === order.id} onClick={() => void callOrderAction(order.id, { action: "resolve_stock_conflict" })} className="mt-3 rounded-full bg-amber-100 px-4 py-2 font-semibold text-black disabled:opacity-50">
                          Resolver y comprometer stock
                        </button>
                      </div>
                    ) : null}

                    {shipment && draft ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <select value={draft.fulfillmentStatus} onChange={(event) => setFulfillmentDrafts((current) => ({ ...current, [order.id]: { ...draft, fulfillmentStatus: event.target.value } }))} className="rounded-xl bg-black p-3">
                          {FULFILLMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <input value={draft.carrier} onChange={(event) => setFulfillmentDrafts((current) => ({ ...current, [order.id]: { ...draft, carrier: event.target.value } }))} className="rounded-xl bg-white/5 p-3" placeholder="Transportista" />
                        <input value={draft.trackingNumber} onChange={(event) => setFulfillmentDrafts((current) => ({ ...current, [order.id]: { ...draft, trackingNumber: event.target.value } }))} className="rounded-xl bg-white/5 p-3" placeholder="Código de seguimiento" />
                        <input value={draft.trackingUrl} onChange={(event) => setFulfillmentDrafts((current) => ({ ...current, [order.id]: { ...draft, trackingUrl: event.target.value } }))} className="rounded-xl bg-white/5 p-3" placeholder="URL de seguimiento" />
                        <input value={draft.labelUrl} onChange={(event) => setFulfillmentDrafts((current) => ({ ...current, [order.id]: { ...draft, labelUrl: event.target.value } }))} className="rounded-xl bg-white/5 p-3" placeholder="URL de etiqueta" />
                        <input value={draft.note} onChange={(event) => setFulfillmentDrafts((current) => ({ ...current, [order.id]: { ...draft, note: event.target.value } }))} className="rounded-xl bg-white/5 p-3" placeholder="Nota para el historial" />
                        <button type="button" disabled={busyOrderId === order.id || stockConflict} onClick={() => void callOrderAction(order.id, { action: "update_fulfillment", ...draft })} className="rounded-xl bg-white px-4 py-3 font-semibold text-black disabled:opacity-40 md:col-span-2">
                          {busyOrderId === order.id ? "Guardando…" : "Guardar preparación y tracking"}
                        </button>
                      </div>
                    ) : null}

                    <div>
                      <p className="text-xs uppercase tracking-wide text-white/35">Historial</p>
                      <div className="mt-2 space-y-2">
                        {events.slice(0, 12).map((event) => (
                          <div key={event.id} className="rounded-xl border border-white/10 p-3 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="font-medium">{event.event_type.replaceAll("_", " ")}</span>
                              <span className="text-xs text-white/35">{when(event.created_at)}</span>
                            </div>
                            {event.note ? <p className="mt-1 text-white/50">{event.note}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </PremiumCard>

      <PremiumCard className="p-5">
        <h2 className="text-lg font-semibold">Catálogo ({products.length})</h2>
        <div className="mt-3 space-y-2">
          {products.map((product) => (
            <div key={product.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-6 md:items-center">
              <span className="font-medium">{product.name}</span>
              <span className="text-white/50">{product.product_type}</span>
              <span className="text-white/60">{sellerName(product)}</span>
              <span>{money(Number(product.price), product.currency)}</span>
              <span>{product.stock === null ? "Sin límite" : `${product.stock}u`}</span>
              <span className={STATUS_STYLE[product.status] ?? "text-white/50"}>{product.status}</span>
            </div>
          ))}
        </div>
      </PremiumCard>
    </div>
  );
}
