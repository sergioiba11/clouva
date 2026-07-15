"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { OutfitPreview, type OutfitLayer } from "@/components/avatar-engine/OutfitPreview";

type ClothingItem = {
  id: string;
  user_id?: string;
  name: string;
  category: string;
  status: string;
  model_url: string | null;
  thumbnail_url: string | null;
  created_at?: string;
  is_owned?: boolean;
  meshy_progress?: number;
  meshy_status?: string;
  metadata?: Record<string, unknown> | null;
  fit_status?: string;
  rigged?: boolean;
  wearable?: boolean;
  hood_supported?: boolean;
  hood_state?: "up" | "down" | string;
  hood_up_model_url?: string | null;
  hood_down_model_url?: string | null;
  processing_error?: string | null;
};

type Outfit = { top_id: string | null; bottom_id: string | null; shoes_id: string | null; accessory_id: string | null };
type ViewMode = "mine" | "catalog";

const CATEGORY_LABEL: Record<string, string> = {
  hoodie: "Buzo",
  shirt: "Remera",
  jacket: "Campera",
  pants: "Pantalón",
  shorts: "Short",
  shoes: "Zapatillas",
  accessory: "Accesorio",
};

const CATEGORY_SLOT: Record<string, keyof Outfit> = {
  hoodie: "top_id",
  shirt: "top_id",
  jacket: "top_id",
  pants: "bottom_id",
  shorts: "bottom_id",
  shoes: "shoes_id",
  accessory: "accessory_id",
};

function currentModelUrl(item: ClothingItem) {
  if (item.hood_supported) {
    if (item.hood_state === "up" && item.hood_up_model_url) return item.hood_up_model_url;
    if (item.hood_state !== "up" && item.hood_down_model_url) return item.hood_down_model_url;
  }
  return item.model_url;
}

function hasWorkingHood(item: ClothingItem) {
  return Boolean(item.hood_supported && item.hood_up_model_url && item.hood_down_model_url);
}

function estimatedProgress(item: ClothingItem, now: number) {
  if (item.status === "ready" && item.model_url) return 100;
  if (item.status === "rigging" || item.meshy_status === "SUCCEEDED") return 99;
  if (typeof item.meshy_progress === "number") return Math.min(99, item.meshy_progress);
  if (item.status !== "generating") return 0;

  const startedAt = item.created_at ? new Date(item.created_at).getTime() : now;
  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
  if (elapsedSeconds < 15) return Math.round(10 + (elapsedSeconds / 15) * 20);
  if (elapsedSeconds < 60) return Math.round(30 + ((elapsedSeconds - 15) / 45) * 25);
  if (elapsedSeconds < 150) return Math.round(55 + ((elapsedSeconds - 60) / 90) * 25);
  if (elapsedSeconds < 300) return Math.round(80 + ((elapsedSeconds - 150) / 150) * 12);
  return 92;
}

function generationLabel(item: ClothingItem, progress: number) {
  if (item.status === "rigging" || item.meshy_status === "SUCCEEDED") return "Adaptando y riggeando";
  if (progress >= 99) return "Meshy está terminando";
  if (progress < 30) return "Preparando generación";
  if (progress < 80) return "Generando modelo 3D";
  return "Procesando materiales";
}

type WearState =
  | { canEquip: true }
  | { canEquip: false; label: "Adaptando al avatar" | "No se pudo ajustar" | "Vista experimental" | "Falta procesar el molde" };

function wearState(item: ClothingItem): WearState {
  if (item.status === "generating" || item.status === "rigging") return { canEquip: false, label: "Adaptando al avatar" };
  if (item.status === "failed") return { canEquip: false, label: "No se pudo ajustar" };
  if (item.status !== "ready" || !item.model_url) return { canEquip: false, label: "Falta procesar el molde" };
  if (item.wearable === true && item.fit_status === "fitted" && item.rigged === true) return { canEquip: true };
  return { canEquip: false, label: "Vista experimental" };
}

export default function ArmarioPage() {
  const { session } = useAuth();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);
  const [myItems, setMyItems] = useState<ClothingItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<ClothingItem[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("mine");
  const [outfit, setOutfit] = useState<Outfit>({ top_id: null, bottom_id: null, shoes_id: null, accessory_id: null });
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [busyHood, setBusyHood] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = async (silent = false) => {
    if (!session?.access_token) return;
    if (!silent) setLoading(true);

    try {
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [itemsRes, catalogRes, outfitRes] = await Promise.all([
        fetch(`/api/clothing/library?t=${Date.now()}`, { headers, cache: "no-store" }),
        fetch(`/api/clothing/catalog?t=${Date.now()}`, { headers, cache: "no-store" }),
        fetch(`/api/clothing/equip?t=${Date.now()}`, { headers, cache: "no-store" }),
      ]);
      const [itemsData, catalogData, outfitData] = await Promise.all([
        itemsRes.json(),
        catalogRes.json(),
        outfitRes.json(),
      ]);
      setMyItems(itemsData.items ?? []);
      setCatalogItems(catalogData.items ?? []);
      if (outfitData.outfit) setOutfit(outfitData.outfit);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.access_token]);

  const hasActiveItems = myItems.some((item) => item.status === "generating" || item.status === "rigging");

  useEffect(() => {
    if (!hasActiveItems || !session?.access_token) return;

    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void load(true), 5000);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
    };
  }, [hasActiveItems, session?.access_token]);

  const equip = async (item: ClothingItem) => {
    if (!session?.access_token) return;
    const slot = CATEGORY_SLOT[item.category];
    if (!slot) return;
    setBusySlot(slot);
    const isEquipped = outfit[slot] === item.id;
    const nextValue = isEquipped ? null : item.id;
    const res = await fetch("/api/clothing/equip", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ [slot]: nextValue }),
    });
    const data = await res.json();
    if (data.outfit) setOutfit(data.outfit);
    setBusySlot(null);
  };

  const toggleHood = async (item: ClothingItem) => {
    if (!session?.access_token || !hasWorkingHood(item)) return;
    const nextState = item.hood_state === "up" ? "down" : "up";
    setBusyHood(item.id);
    const response = await fetch("/api/clothing/hood", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ itemId: item.id, hoodState: nextState }),
    });
    const data = await response.json();
    if (response.ok && data.item) {
      setMyItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...data.item } : candidate));
      setCatalogItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, ...data.item } : candidate));
    }
    setBusyHood(null);
  };

  const items = viewMode === "mine" ? myItems : catalogItems;
  const allKnownItems = useMemo(() => {
    const map = new Map<string, ClothingItem>();
    for (const item of [...catalogItems, ...myItems]) map.set(item.id, item);
    return [...map.values()];
  }, [catalogItems, myItems]);

  const equippedIds = useMemo(() => new Set(Object.values(outfit).filter(Boolean) as string[]), [outfit]);

  const previewLayers: OutfitLayer[] = useMemo(() => {
    return allKnownItems
      .filter((item) => equippedIds.has(item.id) && currentModelUrl(item))
      .map((item) => ({
        id: item.id,
        url: currentModelUrl(item) as string,
        visible: true,
        category: item.category,
        preFitted: item.fit_status === "fitted" && item.rigged === true,
      }));
  }, [allKnownItems, equippedIds]);

  const singlePreview: OutfitLayer[] = useMemo(() => {
    const item = allKnownItems.find((candidate) => candidate.id === previewId);
    const modelUrl = item ? currentModelUrl(item) : null;
    if (!item || !modelUrl) return [];
    return [{
      id: item.id,
      url: modelUrl,
      visible: true,
      category: item.category,
      preFitted: item.fit_status === "fitted" && item.rigged === true,
    }];
  }, [allKnownItems, previewId]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-24 pt-5 text-white">
      <div className="mb-5 flex items-center justify-between">
        <Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">Piezas</span>
        <Link href="/mi-flow/crear-prenda" className="text-sm text-violet-300">+ Crear</Link>
      </div>

      <section className="mb-5 h-[380px] overflow-hidden rounded-3xl border border-white/10 bg-black/40">
        <OutfitPreview avatarUrl={activeAvatar.modelUrl} layers={previewId ? singlePreview : previewLayers} />
      </section>
      <p className="mb-4 text-center text-xs text-white/40">
        {previewId ? "Vista previa de la pieza seleccionada" : `Outfit equipado (${previewLayers.length})`}
      </p>

      <div className="mb-5 grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        <button onClick={() => { setViewMode("mine"); setPreviewId(null); }} className={`rounded-xl py-2 text-sm ${viewMode === "mine" ? "bg-violet-400 text-black" : "text-white/55"}`}>Mis piezas</button>
        <button onClick={() => { setViewMode("catalog"); setPreviewId(null); }} className={`rounded-xl py-2 text-sm ${viewMode === "catalog" ? "bg-violet-400 text-black" : "text-white/55"}`}>Base general</button>
      </div>

      {loading ? <p className="text-sm text-white/40">Cargando piezas…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center">
          <p className="text-sm text-white/50">No hay piezas disponibles todavía.</p>
          <Link href="/mi-flow/crear-prenda" className="mt-3 inline-block rounded-full bg-violet-400 px-4 py-2 text-sm font-medium text-black">Crear la primera</Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const ready = item.status === "ready" && currentModelUrl(item);
          const slot = CATEGORY_SLOT[item.category];
          const equipped = slot ? outfit[slot] === item.id : false;
          const selected = previewId === item.id;
          const progress = estimatedProgress(item, now);
          const isActive = item.status === "generating" || item.status === "rigging";
          const hoodReady = hasWorkingHood(item);

          return (
            <div key={item.id} className={`overflow-hidden rounded-2xl border ${equipped || selected ? "border-violet-400" : "border-white/10"} bg-white/[0.03]`}>
              <button onClick={() => ready && setPreviewId(item.id)} className="relative block aspect-square w-full bg-black/30">
                {item.thumbnail_url ? <img src={item.thumbnail_url} alt={item.name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-xs text-white/30">Sin portada</div>}
                {viewMode === "catalog" && item.is_owned ? <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[9px] uppercase tracking-wide text-violet-200">Tuya</span> : null}
              </button>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium">{item.name}</p>
                <p className="text-[10px] text-white/40">{CATEGORY_LABEL[item.category] ?? item.category}</p>

                {isActive ? (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate text-amber-200">{generationLabel(item, progress)}</span>
                      <span className="font-semibold tabular-nums text-violet-200">{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full rounded-full bg-violet-400 transition-[width] duration-700 ease-out ${progress >= 99 ? "animate-pulse" : ""}`} style={{ width: `${progress}%` }} />
                    </div>
                    <p className="mt-1.5 text-[9px] leading-tight text-white/35">
                      {progress >= 99 ? "La forma ya está lista. CLOUVA está procesando el GLB final." : "El progreso se sincroniza con la generación real."}
                    </p>
                  </div>
                ) : !ready ? (
                  <p className="mt-1.5 text-[10px] text-red-300">{item.status === "failed" ? (item.processing_error || "No se pudo generar") : item.status}</p>
                ) : slot ? (
                  wearState(item).canEquip ? (
                    <div className="mt-1.5 space-y-1.5">
                      <button onClick={() => equip(item)} disabled={busySlot === slot} className={`w-full rounded-full py-1.5 text-[11px] font-medium ${equipped ? "bg-white/10 text-white/70" : "bg-violet-400 text-black"}`}>
                        {equipped ? "Quitar" : "Elegir esta pieza"}
                      </button>
                      {hoodReady && (equipped || selected) ? (
                        <button onClick={() => toggleHood(item)} disabled={busyHood === item.id} className="w-full rounded-full border border-violet-300/30 bg-violet-300/10 py-1.5 text-[11px] font-medium text-violet-200 disabled:opacity-50">
                          {busyHood === item.id ? "Cambiando…" : item.hood_state === "up" ? "Bajar capucha" : "Ponerse la capucha"}
                        </button>
                      ) : null}
                      {(item.category === "hoodie" || item.category === "jacket") && !hoodReady ? (
                        <p className="text-center text-[9px] leading-tight text-white/30">Esta pieza todavía no tiene variante de capucha arriba.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1.5 rounded-full border border-amber-300/25 bg-amber-300/5 py-1.5 text-center text-[10px] text-amber-200">
                      {(wearState(item) as { label: string }).label}
                    </p>
                  )
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
