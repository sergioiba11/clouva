"use client";

import { useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";

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
  commission: number;
  currency: string;
  status: string;
  payment_status: string;
  created_at: string;
  paid_at: string | null;
  players: { display_name: string | null; slug: string } | null;
  studios: { name: string; slug: string } | null;
};

type ProfileLite = { id: string; full_name: string | null; username: string | null };

const money = (value: number, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const STATUS_STYLE: Record<string, string> = {
  published: "text-emerald-300",
  draft: "text-white/50",
  pending_review: "text-amber-300",
  paused: "text-amber-300",
  archived: "text-white/40",
  rejected: "text-red-300",
  sold_out: "text-red-300",
};

function sellerName(row: { owner_type?: string; seller_type?: string; players: { display_name: string | null; slug: string } | null; studios: { name: string; slug: string } | null }) {
  const type = row.owner_type ?? row.seller_type;
  if (type === "clouva") return "CLOUVA";
  if (type === "player") return row.players?.display_name || row.players?.slug || "Player";
  if (type === "studio") return row.studios?.name || row.studios?.slug || "Estudio";
  return "—";
}

export default function MarketplaceAdminPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      const { supabase } = await import("@/lib/supabase");
      const [{ data: productRows, error: productsError }, { data: orderRows, error: ordersError }] = await Promise.all([
        supabase
          .from("commerce_products")
          .select("id,owner_type,product_type,name,price,currency,stock,status,created_at,players(display_name,slug),studios(name,slug)")
          .order("created_at", { ascending: false })
          .limit(300),
        supabase
          .from("commerce_orders")
          .select("id,buyer_id,seller_type,total,commission,currency,status,payment_status,created_at,paid_at,players:seller_player_id(display_name,slug),studios:seller_studio_id(name,slug)")
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

      if (productsError || ordersError) {
        setError(productsError?.message || ordersError?.message || "No se pudo cargar el Marketplace.");
        setLoading(false);
        return;
      }

      const orderRowsTyped = (orderRows ?? []) as unknown as OrderRow[];
      const buyerIds = Array.from(new Set(orderRowsTyped.map((o) => o.buyer_id)));
      const { data: profileRows } = buyerIds.length
        ? await supabase.from("profiles").select("id,full_name,username").in("id", buyerIds)
        : { data: [] as ProfileLite[] };

      setProfiles(Object.fromEntries((profileRows ?? []).map((p) => [p.id, p])));
      setProducts((productRows ?? []) as unknown as ProductRow[]);
      setOrders(orderRowsTyped);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const published = products.filter((p) => p.status === "published").length;
    const pending = products.filter((p) => p.status === "pending_review" || p.status === "draft").length;
    const paidOrders = orders.filter((o) => o.payment_status === "paid");
    const gmv = paidOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const comisiones = paidOrders.reduce((sum, o) => sum + Number(o.commission || 0), 0);
    return { published, pending, total: products.length, gmv, comisiones, paidOrdersCount: paidOrders.length };
  }, [products, orders]);

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Marketplace</h1>
        <p className="mt-1 text-sm text-white/50">Productos y órdenes reales de commerce_products / commerce_orders. Este monto todavía no se suma al dashboard principal de ingresos.</p>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Productos publicados" value={loading ? "…" : stats.published} />
        <StatCard label="Pendientes de revisión" value={loading ? "…" : stats.pending} />
        <StatCard label="Catálogo total" value={loading ? "…" : stats.total} />
        <StatCard label="GMV pagado" value={loading ? "…" : money(stats.gmv)} />
        <StatCard label="Comisión CLOUVA" value={loading ? "…" : money(stats.comisiones)} />
      </div>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <PremiumCard className="p-5">
        <h3 className="text-sm uppercase tracking-[0.16em] text-white/50">Órdenes ({orders.length})</h3>
        {!loading && orders.length === 0 ? <p className="mt-3 text-sm text-white/50">Todavía no hay órdenes.</p> : null}
        <div className="mt-3 space-y-2">
          {orders.map((order) => (
            <div key={order.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-6 md:items-center">
              <span>{profiles[order.buyer_id]?.full_name || profiles[order.buyer_id]?.username || order.buyer_id.slice(0, 8)}</span>
              <span className="text-white/60">→ {sellerName(order)}</span>
              <span>{money(order.total, order.currency)}</span>
              <span className={order.payment_status === "paid" ? "text-emerald-300" : "text-white/50"}>{order.payment_status}</span>
              <span className="text-white/50">{order.status}</span>
              <span className="text-xs text-white/40">{when(order.paid_at ?? order.created_at)}</span>
            </div>
          ))}
        </div>
      </PremiumCard>

      <PremiumCard className="p-5">
        <h3 className="text-sm uppercase tracking-[0.16em] text-white/50">Catálogo ({products.length})</h3>
        {!loading && products.length === 0 ? <p className="mt-3 text-sm text-white/50">Todavía no hay productos cargados.</p> : null}
        <div className="mt-3 space-y-2">
          {products.map((product) => (
            <div key={product.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-6 md:items-center">
              <span className="font-medium">{product.name}</span>
              <span className="text-white/50">{product.product_type}</span>
              <span className="text-white/60">{sellerName(product)}</span>
              <span>{money(product.price, product.currency)}</span>
              <span>{product.stock === null ? "Sin límite" : `${product.stock}u`}</span>
              <span className={STATUS_STYLE[product.status] ?? "text-white/50"}>{product.status}</span>
            </div>
          ))}
        </div>
      </PremiumCard>
    </div>
  );
}
