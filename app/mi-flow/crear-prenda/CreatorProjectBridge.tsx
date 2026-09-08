"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageCheck } from "lucide-react";

export function CreatorProjectBridge() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("creatorProjectId");
  if (!projectId) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(92vw,620px)] -translate-x-1/2 rounded-2xl border border-violet-400/30 bg-[#0b0713]/95 p-3 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><PackageCheck size={17} /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">Esta prenda pertenece a Crear Merch</p>
            <p className="truncate text-[11px] text-white/40">Cuando termines el GLB, volvé al proyecto para asociarlo.</p>
          </div>
        </div>
        <Link href={`/crear/merch/${encodeURIComponent(projectId)}/3d`} className="rounded-xl bg-violet-500 px-3 py-2 text-xs font-bold text-white">Volver y asociar 3D</Link>
      </div>
    </div>
  );
}
