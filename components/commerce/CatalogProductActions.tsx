"use client";

import { CheckCircle2, Eye, EyeOff, ImageIcon, LoaderCircle, Pencil, Save, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type JsonRecord = Record<string, unknown>;

type ListingForActions = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  cost_amount: number | null;
  currency: string;
  stock: number | null;
  status: string;
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

type EditDraft = {
  name: string;
  description: string;
  price: string;
  costAmount: string;
  stock: string;
  status: "draft" | "published";
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

function draftFromListing(listing: ListingForActions): EditDraft {
  return {
    name: listing.name,
    description: listing.description ?? "",
    price: String(listing.price ?? ""),
    costAmount: listing.cost_amount == null ? "" : String(listing.cost_amount),
    stock: listing.stock == null ? "" : String(listing.stock),
    status: listing.status === "published" ? "published" : "draft",
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Elegí una imagen JPG, PNG o WEBP."));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("Cada imagen debe pesar hasta 8 MB."));
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer la imagen."));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
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
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(() => draftFromListing(listing));
  const images = useMemo(() => readImages(listing.metadata), [listing.metadata]);

  useEffect(() => {
    setEditDraft(draftFromListing(listing));
  }, [listing]);

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

  const saveProduct = async (nextStatus = editDraft.status) => {
    setBusyKey("edit");
    setLocalError(null);
    try {
      await call(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/update`, {
        listingId: listing.id,
        name: editDraft.name,
        description: editDraft.description,
        price: editDraft.price,
        costAmount: editDraft.costAmount,
        stock: editDraft.stock,
        status: nextStatus,
      });
      setEditDraft((current) => ({ ...current, status: nextStatus }));
      await onChanged();
      if (nextStatus === editDraft.status) setEditOpen(false);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo editar el producto.");
    } finally {
      setBusyKey("");
    }
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

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusyKey("add-images");
    setLocalError(null);
    try {
      for (const file of Array.from(files).slice(0, 8)) {
        const dataUrl = await fileToDataUrl(file);
        await call(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/images`, {
          action: "add",
          listingId: listing.id,
          dataUrl,
          label: file.name.replace(/\.[^.]+$/, "") || "Imagen agregada",
        });
      }
      await onChanged();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudieron agregar las imágenes.");
    } finally {
      setBusyKey("");
    }
  };

  const replaceImage = async (image: CatalogImage, file: File | undefined) => {
    if (!file) return;
    setBusyKey(`replace:${image.key}`);
    setLocalError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await call(`/api/studios/${encodeURIComponent(studioId)}/commerce/products/images`, {
        action: "replace",
        listingId: listing.id,
        storagePath: image.storagePath,
        dataUrl,
        label: image.label,
      });
      await onChanged();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "No se pudo reemplazar la imagen.");
    } finally {
      setBusyKey("");
    }
  };

  const anyBusy = Boolean(busyKey);
  const published = listing.status === "published";

  return <div className="mt-4 border-t border-white/[0.08] pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => { setEditOpen((value) => !value); setImagesOpen(false); setConfirmDelete(false); setLocalError(null); }} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${editOpen ? "border-violet-400/35 bg-violet-500/10 text-violet-100" : "border-white/10 text-white/55 hover:border-violet-400/25 hover:text-white"}`}>
        <Pencil className="h-3.5 w-3.5" /> Editar artículo
      </button>
      <button type="button" onClick={() => { setImagesOpen((value) => !value); setEditOpen(false); setConfirmDelete(false); setLocalError(null); }} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${imagesOpen ? "border-violet-400/35 bg-violet-500/10 text-violet-100" : "border-white/10 text-white/55 hover:border-violet-400/25 hover:text-white"}`}>
        <ImageIcon className="h-3.5 w-3.5" /> Imágenes {images.length ? `(${images.length})` : ""}
      </button>
      <button type="button" disabled={anyBusy} onClick={() => void saveProduct(published ? "draft" : "published")} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${published ? "border-amber-400/20 bg-amber-500/[0.06] text-amber-200" : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"}`}>
        {busyKey === "edit" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {published ? "Ocultar de tienda" : "Publicar en tienda"}
      </button>
      <button type="button" disabled={anyBusy} onClick={() => { setConfirmDelete(true); setImagesOpen(false); setEditOpen(false); setLocalError(null); }} className="ml-auto flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/[0.06] px-3 py-2 text-xs font-semibold text-red-200 transition hover:border-red-400/40 hover:bg-red-500/10 disabled:opacity-40">
        <Trash2 className="h-3.5 w-3.5" /> Eliminar
      </button>
    </div>

    {localError ? <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-100"><span>{localError}</span><button type="button" onClick={() => setLocalError(null)}><X className="h-3.5 w-3.5" /></button></div> : null}

    {editOpen ? <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/[0.035] p-4">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Editar producto</p><p className="mt-1 text-[10px] text-white/35">Cambios del artículo real, precio, stock y visibilidad en la tienda.</p></div><button type="button" onClick={() => setEditOpen(false)} className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white"><X className="h-3.5 w-3.5" /></button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="text-[10px] uppercase tracking-wider text-white/35">Nombre</span><input value={editDraft.name} onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50" /></label>
        <label className="sm:col-span-2"><span className="text-[10px] uppercase tracking-wider text-white/35">Descripción</span><textarea rows={4} value={editDraft.description} onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50" /></label>
        <label><span className="text-[10px] uppercase tracking-wider text-white/35">Precio · {listing.currency}</span><input inputMode="decimal" value={editDraft.price} onChange={(event) => setEditDraft((current) => ({ ...current, price: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50" /></label>
        <label><span className="text-[10px] uppercase tracking-wider text-white/35">Costo</span><input inputMode="decimal" value={editDraft.costAmount} onChange={(event) => setEditDraft((current) => ({ ...current, costAmount: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50" /></label>
        <label><span className="text-[10px] uppercase tracking-wider text-white/35">Stock</span><input inputMode="numeric" value={editDraft.stock} onChange={(event) => setEditDraft((current) => ({ ...current, stock: event.target.value }))} className="mt-1 w-full rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50" /></label>
        <label><span className="text-[10px] uppercase tracking-wider text-white/35">Estado</span><select value={editDraft.status} onChange={(event) => setEditDraft((current) => ({ ...current, status: event.target.value as EditDraft["status"] }))} className="mt-1 w-full rounded-xl border border-white/10 bg-[#09070f] px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50"><option value="draft">Borrador / oculto</option><option value="published">Publicado en tienda</option></select></label>
      </div>
      <div className="mt-4 flex justify-end"><button type="button" disabled={anyBusy} onClick={() => void saveProduct()} className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{busyKey === "edit" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar cambios</button></div>
    </div> : null}

    {confirmDelete ? <div className="mt-3 rounded-xl border border-red-400/25 bg-red-500/[0.08] p-3">
      <p className="text-xs font-semibold text-red-100">Eliminar “{listing.name}” definitivamente de este Spot</p>
      <p className="mt-1 text-[10px] leading-5 text-red-100/55">Desaparece del catálogo. Las ventas, movimientos y registros históricos ya realizados se conservan.</p>
      <div className="mt-3 flex justify-end gap-2"><button type="button" disabled={anyBusy} onClick={() => setConfirmDelete(false)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/55 disabled:opacity-40">Cancelar</button><button type="button" disabled={anyBusy} onClick={() => void deleteProduct()} className="flex items-center gap-2 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busyKey === "product" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Eliminar definitivamente</button></div>
    </div> : null}

    {imagesOpen ? <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/[0.035] p-3">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Imágenes del producto</p><p className="mt-1 text-[10px] text-white/35">Agregá, reemplazá, eliminá o elegí la portada que verá la tienda.</p></div><div className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-[10px] font-semibold text-violet-100"><Upload className="h-3.5 w-3.5" />{busyKey === "add-images" ? "Subiendo…" : "Agregar"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={anyBusy} onChange={(event) => { void addImages(event.target.files); event.currentTarget.value = ""; }} /></label><button type="button" onClick={() => setImagesOpen(false)} className="rounded-lg border border-white/10 p-1.5 text-white/40 hover:text-white"><X className="h-3.5 w-3.5" /></button></div></div>
      {images.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{images.map((image) => {
        const isCover = image.url === listing.cover_url;
        const imageBusy = busyKey === image.key || busyKey === `cover:${image.key}` || busyKey === `replace:${image.key}`;
        return <div key={image.key} className={`group relative overflow-hidden rounded-xl border bg-black/35 ${isCover ? "border-violet-300/55" : "border-white/10"}`}>
          <img src={image.url} alt={image.label} className="aspect-square w-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-2 pb-2 pt-10"><div className="flex items-end justify-between gap-2"><div className="min-w-0"><p className="truncate text-[9px] font-medium text-white/80">{image.label}</p><p className="mt-0.5 text-[8px] text-white/35">{image.generated ? "Gemini" : "Original / manual"}</p></div>{isCover ? <span className="flex shrink-0 items-center gap-1 rounded-md bg-violet-600 px-1.5 py-1 text-[8px] font-bold"><CheckCircle2 className="h-2.5 w-2.5" />Portada</span> : null}</div><div className="mt-2 flex gap-1"><label className="cursor-pointer rounded-md bg-white/10 px-2 py-1 text-[8px] font-semibold text-white/70 hover:bg-white/15">{busyKey === `replace:${image.key}` ? "Reemplazando…" : "Reemplazar"}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={anyBusy} onChange={(event) => { void replaceImage(image, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>{!isCover ? <button type="button" disabled={anyBusy} onClick={() => void setCover(image)} className="rounded-md bg-white/10 px-2 py-1 text-[8px] font-semibold text-white/70 hover:bg-white/15 disabled:opacity-40">{imageBusy ? "Guardando…" : "Portada"}</button> : null}</div></div>
          <button type="button" disabled={anyBusy} aria-label={`Eliminar ${image.label}`} onClick={() => void deleteImage(image)} className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-lg bg-black/80 text-red-200 shadow-lg transition hover:bg-red-500 hover:text-white disabled:opacity-40">{busyKey === image.key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
        </div>;
      })}</div> : <div className="mt-3 rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-white/30">Este producto no tiene imágenes guardadas. Usá “Agregar” para cargar la primera.</div>}
    </div> : null}
  </div>;
}
