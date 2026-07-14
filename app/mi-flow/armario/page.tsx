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

function generationProgress(item: ClothingItem, now: number) {
  if (item.status === "ready" && item.model_url) return 100;
  if (item.status !== "generating") return 0;

  const startedAt = item.created_at ? new Date(item.created_at).getTime() : now;
  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);

  if (elapsedSeconds < 15) return Math.round(10 + (elapsedSeconds / 15) * 20);
  if (elapsedSeconds < 60) return Math.round(30 + ((elapsedSeconds - 15) / 45) * 25);
  if (elapsedSeconds < 150) return Math.round(55 + ((elapsedSeconds - 60) / 90) * 25);
  if (elapsedSeconds < 300) return Math.round(80 + ((elapsedSeconds - 150) / 150) * 12);
  return 92;
}

function generationLabel(progress: number) {
  if (progress < 30) return "Preparando imagen";
  if (progress < 55) return "Enviando a Meshy";
  if (progress < 80) return "Generando modelo 3D";
  if (progress < 92) return "Procesando materiales";
  return "Finalizando pieza";
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
  const [now, setNow] = useState(() => Date.now());

  const load = async (silent = false) => {
    if (!session?.access_token) return;
    if (!silent) setLoading(true);

    try {
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [itemsRes, catalogRes, outfitRes] = await Promise.all([
        fetch("/api/clothing/library", { headers, cache: "no-store" }),
        fetch("/api/clothing/catalog", { headers, cache: "no-store" }),
        fetch("/api/clothing/equip", { headers, cache: "no-store" }),
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

  const hasGeneratingItems = myItems.some((item) => item.status === "generating");

  useEffect(() => {
    if (!hasGeneratingItems || !session?.access_token) return;

    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void load(true), 5000);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(poll);
    };
  }, [hasGeneratingItems, session?.access_token]);

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

  const items = viewMode === "mine" ? myItems : catalogItems;
  const allKnownItems = useMemo(() => {
    const map = new Map<string, ClothingItem>();
    for (const item of [...catalogItems, ...myItems]) map.set(item.id, item);
    return [...map.values()];
  }, [catalogItems, myItems]);

  const equippedIds = useMemo(() => new Set(Object.values(outfit).filter(Boolean) as string[]), [outfit]);

  const previewLayers: OutfitLayer[] = useMemo(() => {
    return allKnownItems
      .filter((item) => equippedIds.has(item.id) && item.model_url)
      .map((item) => ({ id: item.id, url: item.model_url as string, visible: true, category: item.category }));
  }, [allKnownItems, equippedIds]);

  const singlePreview: OutfitLayer[] = useMemo(() => {
    const item = allKnownItems.find((candidate) => candidate.id === previewId);
    if (!item?.model_url) return [];
    return [{ id: item.id, url: item.model_url, visible: true, category: item.category }];
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
        <button
          onClick={() => { setViewMode("mine"); setPreviewId(null); }}
          className={`rounded-xl py-2 text-sm ${viewMode === "mine" ? "bg-violet-400 text-black" : "text-white/55"}`}
        >
          Mis piezas
        </button>
        <button
          onClick={() => { setViewMode("catalog"); setPreviewId(null); }}
          className={`rounded-xl py-2 text-sm ${viewMode === "catalog" ? "bg-violet-400 text-black" : "text-white/55"}`}
        >
          Base general
        </button>
      </div>

      {loading ? <p className="text-sm text-white/40">Cargando piezas…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center">
          <p className="text-sm text-white/50">No hay piezas disponibles todavía.</p>
          <Link href="/mi-flow/crear-prenda" className="mt-3 inline-block rounded-full bg-violet-400 px-4 py-2 text-sm font-medium text-black">
            Crear la primera
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const ready = item.status === "ready" && item.model_url;
          const slot = CATEGORY_SLOT[item.category];
          const equipped = slot ? outfit[slot] === item.id : false;
          const selected = previewId === item.id;
          const progress = generationProgress(item, now);
          const isGenerating = item.status === "generating";
          const isDelayed = isGenerating && progress >= 92;

          return (
            <div key={item.id} className={`overflow-hidden rounded-2xl border ${equipped || selected ? "border-violet-400" : "border-white/10"} bg-white/[0.03]`}>
              <button onClick={() => setPreviewId(item.id)} className="relative block aspect-square w-full bg-black/30">
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-white/30">Sin portada</div>
                )}
                {viewMode === "catalog" && item.is_owned ? (
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[9px] uppercase tracking-wide text-violet-200">Tuya</span>
                ) : null}
              </button>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium">{item.name}</p>
                <p className="text-[10px] text-white/40">{CATEGORY_LABEL[item.category] ?? item.category}</p>

                {isGenerating ? (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate text-amber-200">{generationLabel(progress)}</span>
                      <span className="font-semibold tabular-nums text-violet-200">{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-violet-400 transition-[width] duration-700 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[9px] leading-tight text-white/35">
                      {isDelayed ? "Está tardando más de lo normal, pero sigue activa." : "Puede tardar entre 2 y 5 minutos."}
                    </p>
                  </div>
                ) : !ready ? (
                  <p className="mt-1.5 text-[10px] text-red-300">{item.status === "failed" ? "No se pudo generar" : item.status}</p>
                ) : slot ? (
                  <button
                    onClick={() => equip(item)}
                    disabled={busySlot === slot}
                    className={`mt-1.5 w-full rounded-full py-1.5 text-[11px] font-medium ${equipped ? "bg-white/10 text-white/70" : "bg-violet-400 text-black"}`}
                  >
                    {equipped ? "Quitar" : "Elegir por esta imagen"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
