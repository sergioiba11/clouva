"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Box, CheckCircle2, Loader2, RefreshCw, Shirt } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type ClothingAsset = {
  id: string;
  name: string;
  category: string;
  color: string | null;
  model_url: string;
  thumbnail_url: string | null;
  status: string;
  fit_status: string | null;
  rigged: boolean;
  wearable: boolean;
};

type ObjectAsset = {
  id: string;
  name: string;
  kind: string;
  category: string;
  status: string;
  model_url: string;
  preview_image_url: string | null;
};

type Project = {
  id: string;
  name: string;
  commerce_product_id: string | null;
  clothing_item_id: string | null;
  creator_3d_asset_id: string | null;
};

export function Merch3DAttachClient({ projectId }: { projectId: string }) {
  const { session } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [clothing, setClothing] = useState<ClothingAsset[]>([]);
  const [objects, setObjects] = useState<ObjectAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!session?.access_token) throw new Error("Iniciá sesión.");
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "La operación no pudo completarse.");
    return payload;
  }, [session?.access_token]);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setBusy(true); setError(null);
    try {
      const [projectPayload, assetsPayload] = await Promise.all([
        authFetch(`/api/creator-commerce/projects/${projectId}`),
        authFetch("/api/creator-commerce/3d-assets"),
      ]);
      setProject(projectPayload.project as Project);
      setClothing(assetsPayload.clothing ?? []);
      setObjects(assetsPayload.objects ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los assets 3D.");
    } finally { setBusy(false); }
  }, [authFetch, projectId, session?.access_token]);

  useEffect(() => { void load(); }, [load]);

  async function attach(kind: "clothing" | "object", id: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = await authFetch(`/api/creator-commerce/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(kind === "clothing"
          ? { clothing_item_id: id, creator_3d_asset_id: null }
          : { creator_3d_asset_id: id, clothing_item_id: null }),
      });
      setProject(payload.project as Project);
      setMessage("Gemelo 3D asociado al proyecto. Al volver a preparar el producto, el mismo productId conserva este vínculo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo asociar el asset 3D.");
    } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[#05030a] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/crear/merch" className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white"><ArrowLeft size={14} /> Crear Merch</Link>
            <p className="mt-5 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">Gemelo 3D</p>
            <h1 className="mt-2 text-3xl font-semibold">{project?.name || "Proyecto"}</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/45">Elegí un GLB ya creado o abrí Garment Flow. El 3D representa el mismo producto físico; no crea otro stock ni otro checkout.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void load()} className="rounded-xl border border-white/10 p-2.5 text-white/55"><RefreshCw size={16} /></button>
            <Link href={`/mi-flow/crear-prenda?creatorProjectId=${encodeURIComponent(projectId)}`} className="rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-200">Crear nueva prenda 3D</Link>
          </div>
        </div>

        {error ? <div className="mt-6 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {message ? <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}
        {busy && !project ? <div className="mt-10 flex items-center gap-2 text-sm text-white/45"><Loader2 className="animate-spin" size={16} /> Cargando assets…</div> : null}

        <section className="mt-8 rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <div className="flex items-center gap-3"><Shirt className="text-violet-300" size={19} /><div><h2 className="font-semibold">Prendas</h2><p className="text-xs text-white/40">Resultados de Clothing / Garment Flow.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clothing.map((asset) => {
              const selected = project?.clothing_item_id === asset.id;
              return <button key={asset.id} onClick={() => void attach("clothing", asset.id)} disabled={busy} className={`rounded-2xl border p-4 text-left transition ${selected ? "border-emerald-400/50 bg-emerald-400/[.06]" : "border-white/10 bg-black/20 hover:border-violet-400/35"}`}>
                <div className="flex items-start justify-between gap-3"><div><strong>{asset.name}</strong><p className="mt-1 text-xs text-white/40">{asset.category}{asset.color ? ` · ${asset.color}` : ""}</p></div>{selected ? <CheckCircle2 size={18} className="text-emerald-300" /> : <Box size={18} className="text-white/30" />}</div>
                <p className="mt-3 text-[11px] text-white/35">{asset.rigged ? "Rigged" : "Sin rig"}{asset.fit_status ? ` · ${asset.fit_status}` : ""}</p>
              </button>;
            })}
            {!clothing.length ? <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/35">No hay prendas 3D listas todavía.</div> : null}
          </div>
        </section>

        <section className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5 sm:p-7">
          <div className="flex items-center gap-3"><Box className="text-violet-300" size={19} /><div><h2 className="font-semibold">Objetos 3D</h2><p className="text-xs text-white/40">Assets de Creator Studio Objects.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {objects.map((asset) => {
              const selected = project?.creator_3d_asset_id === asset.id;
              return <button key={asset.id} onClick={() => void attach("object", asset.id)} disabled={busy} className={`rounded-2xl border p-4 text-left transition ${selected ? "border-emerald-400/50 bg-emerald-400/[.06]" : "border-white/10 bg-black/20 hover:border-violet-400/35"}`}>
                <div className="flex items-start justify-between gap-3"><div><strong>{asset.name}</strong><p className="mt-1 text-xs text-white/40">{asset.kind} · {asset.category}</p></div>{selected ? <CheckCircle2 size={18} className="text-emerald-300" /> : <Box size={18} className="text-white/30" />}</div>
                <p className="mt-3 text-[11px] text-white/35">{asset.status}</p>
              </button>;
            })}
            {!objects.length ? <div className="rounded-2xl border border-dashed border-white/10 p-6 text-sm text-white/35">No hay objetos 3D listos todavía.</div> : null}
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/crear/merch" className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black">Volver a Crear Merch</Link>
          {project?.commerce_product_id ? <span className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-white/45">productId · {project.commerce_product_id}</span> : null}
        </div>
      </div>
    </main>
  );
}
