"use client";

import { CheckCircle2, ImageIcon, LoaderCircle, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type JsonRecord = Record<string, unknown>;

type ListingForActions = {
  id: string;
  name: string;
  cover_url: string | null;
  metadata: Record<string, unknown> | null;
};

type CatalogImage = {
  key: string;
  url: string;
  storagePath: string;
  label: string;
  generated: boolean;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function readImages(metadata: unknown): CatalogImage[] {
  const images = record(record(metadata).product_images);
  const generated = (Array.isArray(images.generated_images) ? images.generated_images : []).map((raw, index) => {
    const item = record(raw);
    const source = typeof item.source_label === "string" ? item.source_label : "Gemini";
    const detailIndex = typeof item.detail_index === "number" ? ` ${item.detail_index}` : "";
    const url = typeof item.url === "string" ? item.url : "";
    const storagePath = typeof item.storage_path === "string" ? item.storage_path : "";
    return { key: `generated:${storagePath || url || index}`, url, storagePath, label: `${source}${detailIndex}`, generated: true };
  });
  const sources = (Array.isArray(images.source_photos) ? images.source_photos : []).map((raw, index) => {
    const item = record(raw);
    const url = typeof item.url === "string" ? item.url : "";
    const storagePath = typeof item.storage_path === "string" ? item.storage_path : "";
    const label = typeof item.display_label === "string" ? item.display_label : typeof item.label === "string" ? item.label : "Original";
    return { key: `source:${storagePath || url || index}`, url, storagePath, label, generated: false };
  });
  return [...generated, ...sources].filter((image) => image.url && image.storagePath);
}

export function CatalogProductActions({
  studioId,
  listing,
  onChanged,
}: {
  studioId: string;
  listing: ListingForActions;
  onChanged: () => void | Promise<void>;
}) {
  const { session } = useAuth();
  const [imagesOpen, setImagesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const images = useMemo(() => readImages(listing.metadata), [listing.metadata]);

  const call = async (path: string, body: Record<string, unknown>) => {
    if (!session?.access_token) throw new Error("La sesión no está disponible.");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "La operación no pudo completarse.");
    return payload;
  };

  const deleteProduct = async () => {
    setBusyKey("product");
    setLocalError(null);
    try {
      await call(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/delete`, { listingId: listing.id });
      setConfirmDelete(false);
      await onChanged();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo eliminar el producto.");
    } finally {
      setBusyKey("");
    }
  };

  const deleteImage = async (image: CatalogImage) => {
    setBusyKey(image.key);
    setLocalError(null);
    try {
      await call(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/images`, {
        action: "delete",
        listingId: listing.id,
        storagePath: image.storagePath,
      });
      await onChanged();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo eliminar la imagen.");
    } finally {
      setBusyKey("");
    }
  };

  const setCover = async (image: CatalogImage) => {
    if (image.url === listing.cover_url) return;
    setBusyKey(`cover:${image.key}`);
    setLocalError(null);
    try {
      await call(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/images`, {
        action: "set_cover",
        listingId: listing.id,
        url: image.url,
      });
      await onChanged();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo cambiar la portada.");
    } finally {
      setBusyKey("");
    }
  };

  const anyBusy = Boolean(busyKey);

  return <div className="mt-4 border-t border-white/[0.08] pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => { setImagesOpen((value) => !value); setConfirmDelete(false); setLocalError(null); }}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${imagesOpen ? "border-violet-400/35 bg-violet-500/10 text-violet-100" : "border-white/10 text-white/55 hover:border-violet-400/25 hover:text-white"}`}
      >
        <ImageIcon className="h-3.5 w-3.5" /> Imágenes {images.length ? `(${images.length})` : ""}
      </button>
      <button
        type="button"
        disabled={anyBusy}
        onClick={() => { setConfirmDelete(true); setImagesOpen(false); setLocalError(null); }}
        className="ml-auto flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/[0.06] px-3 py-2 text-xs font-semibold text-red-200 transition hover:border-red-400/40 hover:bg-red-500/10 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" /> Eliminar
      </button>
    </div>

    {localError ? <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-100"><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}><X className="h-3.5 w-3.5" /></button></div> : null}

    {confirmDelete ? <div className="mt-3 rounded-xl border border-red-400/25 bg-red-500/[0.08] p-3">
      <p className="text-xs font-semibold text-red-100">Eliminar “{listing.name}” definitivamente de este Spot</p>
      <p className="mt-1 text-[10px] leading-5 text-red-100/55">Desaparece del catálogo. Las ventas, movimientos y registros históricos ya realizados se conservan.</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={anyBusy} onClick={() => setConfirmDelete(false)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-40">Cancelar</button>
        <button type="button" disabled={anyBusy} onClick={() => void deleteProduct()} className="flex items-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
          {busyKey === "product" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Eliminar definitivamente
        </button>
      </div>
    </div> : null}

    {imagesOpen ? <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/[0.035] p-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Imágenes del producto</p><p className="mt-1 text-[10px] text-white/35">Eliminá las que sobren o elegí otra portada.</p></div>
        <button type="button" onClick={() => setImagesOpen(false)} className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white"><X className="h-3.5 w-3.5" /></button>
      </div>
      {images.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{images.map((image) => {
        const isCover = image.url === listing.cover_url;
        const imageBusy = busyKey === image.key || busyKey === `cover:${image.key}`;
        return <div key={image.key} className={`group relative overflow-hidden rounded-xl border bg-black/35 ${isCover ? "border-violet-300/55" : "border-white/10"}`}>
          <img src={image.url} alt={image.label} className="aspect-square w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-2 pb-2 pt-8">
            <div className="flex items-end justify-between gap-2"><div className="min-w-0"><p className="truncate text-[9px] font-medium text-white/80">{image.label}</p><p className="mt-0.5 text-[8px] text-white/35">{image.generated ? "Gemini" : "Original"}</p></div>{isCover ? <span className="flex shrink-0 items-center gap-1 rounded-md bg-violet-600 px-1.5 py-1 text-[8px] font-bold"><CheckCircle2 className="h-2.5 w-2.5" />Portada</span> : null}</div>
          </div>
          <button type="button" disabled={anyBusy} aria-label={`Eliminar ${image.label}`} onClick={() => void deleteImage(image)} className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-lg bg-black/80 text-red-200 shadow-lg transition hover:bg-red-500 hover:text-white disabled:opacity-40">
            {busyKey === image.key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
          {!isCover ? <button type="button" disabled={anyBusy} onClick={() => void setCover(image)} className="absolute left-1.5 top-1.5 rounded-lg bg-black/80 px-2 py-1.5 text-[8px] font-semibold text-white/65 transition hover:text-white disabled:opacity-40">{imageBusy ? "Guardando…" : "Hacer portada"}</button> : null}
        </div>;
      })}</div> : <div className="mt-3 rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-white/30">Este producto no tiene imágenes guardadas para administrar.</div>}
    </div> : null}
  </div>;
}
