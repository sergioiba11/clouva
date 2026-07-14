"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { OutfitPreview, type OutfitLayer } from "@/components/avatar-engine/OutfitPreview";

type ClothingItem = {
  id: string;
  name: string;
  category: string;
  status: string;
  model_url: string | null;
  thumbnail_url: string | null;
};

type Outfit = { top_id: string | null; bottom_id: string | null; shoes_id: string | null; accessory_id: string | null };

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

export default function ArmarioPage() {
  const { session } = useAuth();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [outfit, setOutfit] = useState<Outfit>({ top_id: null, bottom_id: null, shoes_id: null, accessory_id: null });
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);

  const load = async () => {
    if (!session?.access_token) return;
    setLoading(true);
    const [itemsRes, outfitRes] = await Promise.all([
      fetch("/api/clothing/library", { headers: { Authorization: `Bearer ${session.access_token}` } }),
      fetch("/api/clothing/equip", { headers: { Authorization: `Bearer ${session.access_token}` } }),
    ]);
    const itemsData = await itemsRes.json();
    const outfitData = await outfitRes.json();
    setItems(itemsData.items ?? []);
    if (outfitData.outfit) setOutfit(outfitData.outfit);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [session?.access_token]);

  const equip = async (item: ClothingItem) => {
    if (!session?.access_token) return;
    const slot = CATEGORY_SLOT[item.category];
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

  const equippedIds = useMemo(() => new Set(Object.values(outfit).filter(Boolean) as string[]), [outfit]);

  const previewLayers: OutfitLayer[] = useMemo(() => {
    return items
      .filter((i) => equippedIds.has(i.id) && i.model_url)
      .map((i) => ({ id: i.id, url: i.model_url as string, visible: true, category: i.category }));
  }, [items, equippedIds]);

  const singlePreview: OutfitLayer[] = useMemo(() => {
    const item = items.find((i) => i.id === previewId);
    if (!item?.model_url) return [];
    return [{ id: item.id, url: item.model_url, visible: true, category: item.category }];
  }, [items, previewId]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-24 pt-5 text-white">
      <div className="mb-5 flex items-center justify-between">
        <Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link>
        <span className="text-[11px] uppercase tracking-[0.25em] text-white/40">Mi armario</span>
        <Link href="/mi-flow/crear-prenda" className="text-sm text-violet-300">+ Crear</Link>
      </div>

      <section className="mb-5 h-[380px] overflow-hidden rounded-3xl border border-white/10 bg-black/40">
        <OutfitPreview avatarUrl={activeAvatar.modelUrl} layers={previewId ? singlePreview : previewLayers} />
      </section>
      <p className="mb-6 text-center text-xs text-white/40">
        {previewId ? "Vista previa de la prenda seleccionada" : `Outfit equipado (${previewLayers.length} prenda${previewLayers.length === 1 ? "" : "s"})`}
      </p>

      {loading ? <p className="text-sm text-white/40">Cargando…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center">
          <p className="text-sm text-white/50">Todavía no creaste ninguna prenda.</p>
          <Link href="/mi-flow/crear-prenda" className="mt-3 inline-block rounded-full bg-violet-400 px-4 py-2 text-sm font-medium text-black">
            Crear la primera
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const ready = item.status === "ready" && item.model_url;
          const slot = CATEGORY_SLOT[item.category];
          const equipped = outfit[slot] === item.id;
          return (
            <div key={item.id} className={`overflow-hidden rounded-2xl border ${equipped ? "border-violet-400" : "border-white/10"} bg-white/[0.03]`}>
              <button onClick={() => setPreviewId(item.id)} className="block aspect-square w-full bg-black/30">
                {item.thumbnail_url ? (
                  <img src={item.thumbnail_url} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-white/30">Sin foto</div>
                )}
              </button>
              <div className="p-2.5">
                <p className="truncate text-xs font-medium">{item.name}</p>
                <p className="text-[10px] text-white/40">{CATEGORY_LABEL[item.category] ?? item.category}</p>
                {!ready ? (
                  <p className="mt-1.5 text-[10px] text-amber-300">{item.status === "generating" ? "Generando…" : item.status}</p>
                ) : (
                  <button
                    onClick={() => equip(item)}
                    disabled={busySlot === slot}
                    className={`mt-1.5 w-full rounded-full py-1.5 text-[11px] font-medium ${equipped ? "bg-white/10 text-white/70" : "bg-violet-400 text-black"}`}
                  >
                    {equipped ? "Quitar" : "Equipar"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
