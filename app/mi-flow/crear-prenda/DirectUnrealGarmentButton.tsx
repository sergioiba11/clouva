"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Shirt } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

type ClothingItem = {
  id: string;
  name: string;
  category: string;
  rigged: boolean;
  fitStatus?: string;
};

type ClothingResponse = {
  items?: ClothingItem[];
  error?: string;
};

type UnrealExportResult = {
  url?: string;
  filename?: string;
  scale?: string;
  error?: string;
};

const REFRESH_INTERVAL_MS = 8000;

export function DirectUnrealGarmentButton() {
  const { user, session, loading } = useAuth();
  const [latestItem, setLatestItem] = useState<ClothingItem | null>(null);
  const [loadingItem, setLoadingItem] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<UnrealExportResult | null>(null);

  const loadLatestItem = useCallback(async () => {
    if (!session?.access_token) return;

    setLoadingItem(true);
    try {
      const response = await fetch("/api/assets/export-unreal", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as ClothingResponse;
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar tus prendas.");
      setLatestItem(data.items?.[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo buscar la última prenda.");
    } finally {
      setLoadingItem(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    void loadLatestItem();
    const interval = window.setInterval(() => void loadLatestItem(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadLatestItem, session?.access_token]);

  const exportLatestItem = async () => {
    if (!latestItem || !session?.access_token || exporting) return;

    setExporting(true);
    setError(null);
    setExportResult(null);

    try {
      const response = await fetch("/api/assets/export-unreal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          clothingItemId: latestItem.id,
          name: latestItem.name,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as UnrealExportResult;
      if (!response.ok || !data.url) {
        throw new Error(data.error || `No se pudo generar el FBX (${response.status}).`);
      }

      setExportResult(data);
      const anchor = document.createElement("a");
      anchor.href = data.url;
      anchor.download = data.filename || `${latestItem.name}-unreal.fbx`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo preparar la prenda para Unreal.");
    } finally {
      setExporting(false);
    }
  };

  if (loading || !user || !session?.access_token) return null;

  return (
    <aside className="fixed bottom-24 left-4 right-4 z-[70] mx-auto max-w-xl rounded-2xl border border-white/15 bg-[#070707]/95 p-3 text-white shadow-[0_18px_60px_rgba(0,0,0,.65)] backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-black tracking-[0.16em] text-violet-300">
            <Shirt className="h-3.5 w-3.5" /> PRENDA PARA UNREAL
          </p>
          <p className="mt-1 truncate text-xs text-white/55">
            {latestItem ? `Última lista: ${latestItem.name}` : "Todavía no hay una prenda lista."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLatestItem()}
          disabled={loadingItem || exporting}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 text-white/60 transition hover:border-white/30 hover:text-white disabled:opacity-40"
          aria-label="Actualizar última prenda"
        >
          <RefreshCw className={`h-4 w-4 ${loadingItem ? "animate-spin" : ""}`} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => void exportLatestItem()}
        disabled={!latestItem || exporting || loadingItem}
        className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border border-white/20 bg-black px-4 text-sm font-black tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_8px_30px_rgba(0,0,0,.55)] transition hover:border-violet-400/60 hover:bg-[#0d0d0d] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {exporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
        {exporting ? "PREPARANDO PRENDA FBX…" : "CREAR Y DESCARGAR PRENDA PARA UNREAL (.FBX)"}
      </button>

      {exportResult?.url ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
          <span className="min-w-0 truncate">Lista · {exportResult.filename} · {exportResult.scale}</span>
          <a href={exportResult.url} download={exportResult.filename || true} className="shrink-0 font-bold underline">Descargar otra vez</a>
        </div>
      ) : null}

      {error ? <p className="mt-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p> : null}
    </aside>
  );
}
