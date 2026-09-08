"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function CreatorProjectBridge() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("creatorProjectId");
  const conceptId = searchParams.get("creatorConceptId");
  const [clothingItemId, setClothingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !conceptId) return;
    const originalFetch = window.fetch.bind(window);

    const wrappedFetch: typeof window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (response.ok && url.includes("/api/clothing/finalize")) {
        void response.clone().json().then((payload) => {
          const itemId = payload?.item?.id;
          if (typeof itemId === "string" && itemId) setClothingItemId(itemId);
        }).catch(() => undefined);
      }
      return response;
    };

    window.fetch = wrappedFetch;
    return () => {
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    };
  }, [conceptId, projectId]);

  const returnHref = useMemo(() => {
    if (!projectId || !conceptId) return "/crear/merch";
    const params = new URLSearchParams({ project: projectId, concept: conceptId });
    if (clothingItemId) params.set("clothingItemId", clothingItemId);
    return `/crear/merch?${params.toString()}`;
  }, [clothingItemId, conceptId, projectId]);

  if (!projectId) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(92vw,660px)] -translate-x-1/2 rounded-2xl border border-violet-400/30 bg-[#0b0713]/95 p-3 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><PackageCheck size={17} /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">Esta prenda pertenece a un producto del drop</p>
            <p className="truncate text-[11px] text-white/40">{clothingItemId ? "GLB finalizado: ya podés volver y asociarlo a este artículo." : conceptId ? "Cuando finalice el GLB, CLOUVA lo devolverá al mismo Product Concept." : "Volvé a Crear Merch para asociar la pieza."}</p>
          </div>
        </div>
        <Link href={returnHref} className={`rounded-xl px-3 py-2 text-xs font-bold text-white ${clothingItemId ? "bg-emerald-500" : "bg-violet-500"}`}>
          {clothingItemId ? "Volver y asociar 3D" : "Volver al producto"}
        </Link>
      </div>
    </div>
  );
}
