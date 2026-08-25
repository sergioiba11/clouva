"use client";

import { ArrowLeft, Loader2, Megaphone } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ProductPublicationControls } from "@/components/commerce/ProductPublicationControls";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  status: string;
  cover_url: string | null;
};

type SpotPayload = {
  spot: { id: string; name: string };
  space: { id: string; name: string; type: string } | null;
};

type PlayerPayload = {
  player: { id: string; display_name: string } | null;
};

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(value); }
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

  const canonicalSpace = spot?.space ?? null;

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href={`/mi-spot/${spotId}`} className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Volver al espacio</Link>
        <div className="mt-5 rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0e0a17] to-[#09080f] p-6 sm:p-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-3 py-1 text-[11px] uppercase tracking-[.16em] text-violet-200"><Megaphone size={13} /> Publicaciones</span>
          <h1 className="mt-4 text-3xl font-semibold sm:text-5xl">Dónde aparece cada producto</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/50">El producto, SKU, precio y stock siguen siendo uno solo. Acá únicamente elegís si se muestra en tu Player o en este espacio; el beneficiario económico no cambia.</p>
        </div>

        {loading ? <div className="mt-5 grid min-h-48 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Cargando productos canónicos…</span></div> : null}
        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        {!loading && !error && canonicalSpace ? (
          <section className="mt-6 grid gap-4 md:grid-cols-2">
            {products.map((product) => (
              <article key={product.id} className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5">
                <div className="flex gap-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/[0.04]">{product.cover_url ? <img src={product.cover_url} alt={product.name} className="h-full w-full object-cover" /> : null}</div>
                  <div className="min-w-0"><p className="truncate text-lg font-semibold">{product.name}</p><p className="mt-1 text-xs uppercase tracking-[.12em] text-white/30">{product.status}</p><p className="mt-2 text-sm text-violet-200">{money(Number(product.price), product.currency)}</p></div>
                </div>
                <ProductPublicationControls
                  productId={product.id}
                  player={player ? { id: player.id, name: player.display_name } : null}
                  space={{ id: canonicalSpace.id, name: canonicalSpace.name }}
                />
              </article>
            ))}
            {!products.length ? <div className="md:col-span-2 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-white/40">Este espacio todavía no tiene productos para publicar.</div> : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
