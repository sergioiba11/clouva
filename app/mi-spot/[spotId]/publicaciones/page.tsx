"use client";

import { ArrowLeft, Loader2, Megaphone, Package, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ProductPublicationControls } from "@/components/commerce/ProductPublicationControls";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Variant = {
  id: string;
  sku: string | null;
  title: string | null;
  size: string | null;
  color: string | null;
  stock: number;
  price_override: number | null;
  cost_override: number | null;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number | null;
  status: string;
  cover_url: string | null;
  gallery: string[] | null;
  product_type: string;
  listing_kind: string | null;
  cost_amount: number | null;
  variants: Variant[];
  metrics: {
    restockCycles: number;
    unitsPurchased: number;
    unitsSold: number;
    capitalInvested: number;
    grossRevenue: number;
    costOfGoods: number;
    allocatedFees: number;
    realizedProfit: number;
    latestUnitCost: number | null;
    lastPurchaseAt: string | null;
    salesByChannel: Record<string, number>;
  };
};

type SpotPayload = {
  spot: { id: string; name: string };
  space: { id: string; name: string; type: string } | null;
};

type PlayerPayload = {
  player: { id: string; display_name: string } | null;
};

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toLocaleString("es-AR")}`; }
}

export default function SpotPublicationsPage() {
  const params = useParams<{ spotId: string }>();
  const spotId = String(params.spotId || "");
  const { user, loading: authLoading } = useAuth();
  const [spot, setSpot] = useState<SpotPayload | null>(null);
  const [player, setPlayer] = useState<PlayerPayload["player"]>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !spotId) return;
    setLoading(true);
    setError(null);
    try {
      const [spotResponse, productsResponse, playerResponse] = await Promise.all([
        authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}`),
        authenticatedFetch(`/api/mi-spot/${encodeURIComponent(spotId)}/publication-products`),
        authenticatedFetch("/api/players/me"),
      ]);
      const [spotPayload, productPayload, playerPayload] = await Promise.all([
        readApiJson<SpotPayload>(spotResponse),
        readApiJson<{ products: Product[] }>(productsResponse),
        readApiJson<PlayerPayload>(playerResponse),
      ]);
      setSpot(spotPayload);
      setProducts(productPayload.products ?? []);
      setPlayer(playerPayload.player ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las publicaciones.");
    } finally {
      setLoading(false);
    }
  }, [spotId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLoading(false); return; }
    void load();
  }, [authLoading, load, user]);

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href={`/mi-spot/${spotId}`} className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Volver al Centro Operativo</Link>
        <div className="mt-5 rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0e0a17] to-[#09080f] p-6 sm:p-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-3 py-1 text-[11px] uppercase tracking-[.16em] text-violet-200"><Megaphone size={13} /> Publicaciones · ventas · reposición</span>
          <h1 className="mt-4 text-3xl font-semibold sm:text-5xl">{spot?.spot.name || "Negocio"}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">Un producto, un stock y una historia. Publicalo en CLOUVA Market, preparalo para Facebook, registrá la venta en el canal real y reponé sin duplicar el artículo.</p>
        </div>

        {loading ? <div className="mt-5 grid min-h-48 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Cargando productos canónicos…</span></div> : null}
        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        {!loading && !error && spot?.space ? (
          <section className="mt-6 space-y-4">
            {products.map((product) => (
              <article key={product.id} className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-4 sm:p-5">
                <div className="flex gap-4">
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/[0.04]">{product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover" /> : <Package size={20} className="text-white/20" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p className="truncate text-lg font-semibold">{product.name}</p><p className="mt-1 text-xs uppercase tracking-[.12em] text-white/30">{product.listing_kind || product.product_type} · {product.status}</p></div>
                      <p className="text-sm font-semibold text-violet-200">{money(Number(product.price), product.currency)}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/45">
                      <span className="rounded-lg border border-white/[0.08] px-2 py-1">Stock {product.stock ?? product.variants.reduce((sum, variant) => sum + variant.stock, 0)}</span>
                      <span className="rounded-lg border border-white/[0.08] px-2 py-1">Costo {product.metrics.latestUnitCost == null ? "—" : money(Number(product.metrics.latestUnitCost), product.currency)}</span>
                      <span className="rounded-lg border border-white/[0.08] px-2 py-1">Vendidas {product.metrics.unitsSold}</span>
                      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/15 bg-emerald-500/[0.04] px-2 py-1 text-emerald-100/70"><TrendingUp size={10} /> Ganancia {money(product.metrics.realizedProfit, product.currency)}</span>
                    </div>
                  </div>
                </div>
                <ProductPublicationControls
                  productId={product.id}
                  player={player ? { id: player.id, name: player.display_name } : null}
                  space={{ id: spot.space.id, name: spot.space.name }}
                  product={product}
                />
              </article>
            ))}
            {!products.length ? <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-8 text-center text-sm text-white/40">Este negocio todavía no tiene productos. Cargalos desde el Centro Operativo y después volvé acá para distribuirlos.</div> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
