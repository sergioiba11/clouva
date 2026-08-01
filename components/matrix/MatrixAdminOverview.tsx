"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { canAccessAdmin } from "@/lib/auth";

type StudioSummary = {
  id: string;
  slug: string;
  name: string;
  isPublished: boolean;
  membersActive: number;
  membersPaying: number;
  activePlans: number;
};

// Admin-only, self-hiding island inside the otherwise fully public/static
// /matrix server page -- so the admin can see what's happening in every
// studio (members, paying members, active plans) without leaving La Matrix
// for the separate /admin section. Renders nothing for non-admins/logged-out.
export function MatrixAdminOverview() {
  const { user, role, loading } = useAuth();
  const [studios, setStudios] = useState<StudioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = !loading && Boolean(user) && canAccessAdmin(role);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/admin/studios/summary");
        const payload = await readApiJson<{ studios: StudioSummary[] }>(response);
        if (!cancelled) setStudios(payload.studios);
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "No se pudo cargar el resumen.");
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <section className="mx-auto mt-10 max-w-4xl rounded-[1.75rem] border border-amber-400/20 bg-amber-400/[0.04] p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-300/80">Solo admin</p>
      <h2 className="mt-1 text-xl font-bold">Estudios — resumen</h2>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
      {!error && studios === null ? <p className="mt-3 text-sm text-white/45">Cargando...</p> : null}
      {studios?.length === 0 ? <p className="mt-3 text-sm text-white/45">Todavía no hay Estudios creados.</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {studios?.map((studio) => (
          <div key={studio.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">{studio.name}</p>
              {!studio.isPublished ? <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase text-white/40">Sin publicar</span> : null}
            </div>
            <p className="mt-2 text-sm text-white/55">
              {studio.membersActive} socios ({studio.membersPaying} pagos) · {studio.activePlans} planes activos
            </p>
            <div className="mt-3 flex gap-2">
              <Link href={`/studio-dashboard/${studio.id}`} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold">Administrar</Link>
              <Link href={`/studios/${studio.slug}`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs">Ver página</Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
