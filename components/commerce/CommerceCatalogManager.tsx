"use client";

import { Archive, LoaderCircle, RotateCcw, X } from "lucide-react";
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

function statusLabel(status: string) {
  if (status === "archived") return "Archivado";
  if (status === "published" || status === "active") return "Activo";
  if (status === "draft") return "Borrador";
  return status;
}

export function CommerceCatalogManager() {
  const pathname = usePathname();
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      const response = await fetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/spot?includeArchived=1`, {
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

  const archive = async (listing: Listing) => {
    if (!studioId || !session?.access_token || busyId || listing.status === "archived") return;
    const confirmed = window.confirm(`¿Archivar “${listing.name}” del catálogo de ${spotName}?\n\nDejará de aparecer en el catálogo activo. Se conservarán el inventario y el historial de ventas.`);
    if (!confirmed) return;

    setBusyId(listing.id);
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
      if (!response.ok) throw new Error(payload.error || "No se pudo archivar el producto.");
      setListings((current) => current.map((item) => item.id === listing.id ? { ...item, status: "archived" } : item));
      setBusyId(null);
      window.dispatchEvent(new Event("clouva:commerce-product-archived"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo archivar el producto.");
      setBusyId(null);
    }
  };

  const restore = async (listing: Listing) => {
    if (!studioId || !session?.access_token || busyId || listing.status !== "archived") return;
    const confirmed = window.confirm(`¿Reactivar “${listing.name}” en ${spotName}?\n\nVolverá como borrador para que puedas revisarlo antes de publicarlo.`);
    if (!confirmed) return;

    setBusyId(listing.id);
    setError(null);
    try {
      const response = await fetch(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/restore`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ listingId: listing.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo reactivar el producto.");
      setListings((current) => current.map((item) => item.id === listing.id ? { ...item, status: payload.status || "draft" } : item));
      setBusyId(null);
      window.dispatchEvent(new Event("clouva:commerce-product-restored"));
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo reactivar el producto.");
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-4 z-[72] flex items-center gap-2 rounded-full border border-violet-400/25 bg-[#110b14]/95 px-4 py-3 text-sm font-semibold text-violet-100 shadow-[0_12px_40px_rgba(0,0,0,.45)] backdrop-blur-xl transition hover:border-violet-300/45"
      >
        <Archive className="h-4 w-4" />
        Administrar catálogo
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="max-h-[82vh] w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#0b0912] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <div>
                <p className="text-xs uppercase tracking-[.2em] text-violet-300">Catálogo de {spotName}</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Administrar productos</h2>
                <p className="mt-1 text-xs text-white/35">Los archivados se conservan para mantener el historial y se pueden reactivar como borrador.</p>
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
                  {listings.map((listing) => {
                    const archived = listing.status === "archived";
                    return (
                      <div key={listing.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${archived ? "border-white/[0.07] bg-white/[0.015]" : "border-white/10 bg-white/[0.03]"}`}>
                        {listing.cover_url ? <img src={listing.cover_url} alt="" className={`h-14 w-14 rounded-xl object-cover ${archived ? "opacity-60" : ""}`} /> : <div className="h-14 w-14 rounded-xl bg-white/5" />}
                        <div className="min-w-0 flex-1">
                          <p className={`truncate font-medium text-white ${archived ? "opacity-65" : ""}`}>{listing.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/40">
                            <span>Stock {listing.stock ?? "∞"}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${archived ? "border-white/10 bg-white/[0.04] text-white/45" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>{statusLabel(listing.status)}</span>
                          </div>
                        </div>
                        {archived ? (
                          <button
                            type="button"
                            disabled={Boolean(busyId)}
                            onClick={() => void restore(listing)}
                            className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-40"
                            aria-label={`Reactivar ${listing.name}`}
                          >
                            {busyId === listing.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            <span className="hidden sm:inline">Reactivar</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={Boolean(busyId)}
                            onClick={() => void archive(listing)}
                            className="flex min-h-11 items-center gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-40"
                            aria-label={`Archivar ${listing.name}`}
                          >
                            {busyId === listing.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                            <span className="hidden sm:inline">Archivar</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-white/40">No hay productos para administrar.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
