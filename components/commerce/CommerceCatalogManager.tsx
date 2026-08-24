"use client";

import { LoaderCircle, Trash2, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type Listing = {
  id: string;
  name: string;
  cover_url: string | null;
  status: string;
  stock: number | null;
};

type Overview = {
  spot?: { name?: string };
  listings?: Listing[];
};

export function CommerceCatalogManager() {
  const pathname = usePathname();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [spotName, setSpotName] = useState("MI SPOT");
  const [error, setError] = useState<string | null>(null);

  const studioId = useMemo(() => {
    const match = pathname?.match(/^\/studio-dashboard\/([^/]+)\/commerce(?:\/|$)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [pathname]);

  const active = Boolean(studioId && session?.access_token);

  const load = async () => {
    if (!studioId || !session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/spot`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Overview & { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo cargar el catálogo.");
      setListings(payload.listings ?? []);
      setSpotName(payload.spot?.name || "MI SPOT");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el catálogo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !active) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, studioId]);

  if (!active) return null;

  const remove = async (listing: Listing) => {
    if (!studioId || !session?.access_token || deletingId) return;
    const confirmed = window.confirm(`¿Eliminar “${listing.name}” del catálogo de ${spotName}?\n\nSe quitará del catálogo activo y se conservará el historial de inventario y ventas.`);
    if (!confirmed) return;

    setDeletingId(listing.id);
    setError(null);
    try {
      const response = await fetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/archive`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ listingId: listing.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo eliminar el producto.");
      setListings((current) => current.filter((item) => item.id !== listing.id));
      window.dispatchEvent(new Event("clouva:commerce-product-archived"));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar el producto.");
      setDeletingId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-4 z-[72] flex items-center gap-2 rounded-full border border-red-400/25 bg-[#110b14]/95 px-4 py-3 text-sm font-semibold text-red-200 shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-xl transition hover:border-red-300/45"
      >
        <Trash2 className="h-4 w-4" />
        Administrar catálogo
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="max-h-[82vh] w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#0b0912] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <p className="text-xs uppercase tracking-[.2em] text-violet-300">Catálogo de {spotName}</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Eliminar productos</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-white/10 p-2 text-white/60 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto p-4">
              {error ? <p className="mb-3 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
              {loading ? (
                <div className="grid min-h-40 place-items-center text-white/50"><LoaderCircle className="h-6 w-6 animate-spin" /></div>
              ) : listings.length ? (
                <div className="space-y-2">
                  {listings.map((listing) => (
                    <div key={listing.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                      {listing.cover_url ? <img src={listing.cover_url} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="h-14 w-14 rounded-xl bg-white/5" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">{listing.name}</p>
                        <p className="mt-1 text-xs text-white/40">Stock {listing.stock ?? "∞"} · {listing.status}</p>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(deletingId)}
                        onClick={() => void remove(listing)}
                        className="grid h-11 w-11 place-items-center rounded-xl border border-red-400/25 bg-red-500/10 text-red-200 transition hover:bg-red-500/20 disabled:opacity-40"
                        aria-label={`Eliminar ${listing.name}`}
                      >
                        {deletingId === listing.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-white/40">No hay productos activos en el catálogo.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
