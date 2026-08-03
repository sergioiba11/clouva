"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PremiumCard } from "@/components/os-ui";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type StudioSummary = {
  id: string;
  slug: string;
  name: string;
  isPublished: boolean;
  membersActive: number;
  membersPaying: number;
  activePlans: number;
};

export default function EstudiosOverviewAdminPage() {
  const [studios, setStudios] = useState<StudioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/admin/studios/summary");
        const payload = await readApiJson<{ studios: StudioSummary[] }>(response);
        setStudios(payload.studios);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : "No se pudo cargar el resumen.");
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Estudios — resumen</h1>
            <p className="mt-1 text-sm text-white/50">Miembros, pagos, planes propios y estado operativo de cada Estudio.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/estudios/studio-os" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold">Configurar Studio OS</Link>
            <Link href="/admin/estudios/membresias" className="rounded-xl border border-white/15 px-4 py-2 text-sm">Membresías</Link>
          </div>
        </div>
      </PremiumCard>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      {!error && studios === null ? <p className="text-sm text-white/50">Cargando...</p> : null}
      {studios?.length === 0 ? <p className="text-sm text-white/50">Todavía no hay Estudios creados.</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {studios?.map((studio) => (
          <PremiumCard key={studio.id} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{studio.name}</p>
              {!studio.isPublished ? <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase text-white/40">Sin publicar</span> : null}
            </div>
            <p className="mt-2 text-sm text-white/55">
              {studio.membersActive} miembros ({studio.membersPaying} pagos) · {studio.activePlans} planes activos
            </p>
            <div className="mt-3 flex gap-2">
              <a href={`/studio-dashboard/${studio.id}`} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold">Administrar</a>
              <a href={`/studios/${studio.slug}`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">Ver página</a>
            </div>
          </PremiumCard>
        ))}
      </div>
    </div>
  );
}
