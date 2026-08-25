"use client";

import { Loader2, Store } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SpotCommerceDashboard } from "@/components/commerce/SpotCommerceDashboard";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpotItem = {
  id: string;
  name: string;
  owner_type: "user" | "studio";
  role: string;
  capabilities?: string[];
  studio: { id: string; name: string; slug: string } | null;
};

export function MiFlowSpotEntry() {
  const { user, loading: authLoading } = useAuth();
  const [spots, setSpots] = useState<SpotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/mi-spot");
      const payload = await readApiJson<{ spots: SpotItem[] }>(response);
      setSpots(payload.spots ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir tu MI FLOW.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [authLoading, load, user]);

  const operationalSpot = useMemo(() => {
    if (!spots.length) return null;
    return spots.find((spot) => (spot.capabilities ?? []).includes("operations")) ?? null;
  }, [spots]);

  if (operationalSpot) {
    const commerceScope = operationalSpot.owner_type === "studio" && operationalSpot.studio?.id
      ? operationalSpot.studio.id
      : `spot:${operationalSpot.id}`;
    return <SpotCommerceDashboard studioId={commerceScope} />;
  }

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-8">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-white/45"><Loader2 size={16} className="animate-spin" /> Abriendo tu panel operativo…</p>
        ) : null}
        {error ? (
          <p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p>
        ) : null}
        {!loading && !error && !spots.length ? (
          <section className="rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-7">
            <span className="inline-grid rounded-2xl border border-violet-300/15 bg-violet-300/[0.07] p-3 text-violet-300"><Store size={23} /></span>
            <h1 className="mt-5 text-3xl font-semibold">Creá tu Spot para activar MI FLOW</h1>
            <p className="mt-2 text-sm leading-6 text-white/50">MI FLOW abre directamente el panel operativo de tu negocio: ventas, catálogo, inventario, scanner, caja, pedidos y códigos.</p>
            <Link href="/mi-spot/new" className="mt-6 inline-flex rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold">Crear mi Spot</Link>
          </section>
        ) : null}
        {!loading && !error && spots.length && !operationalSpot ? (
          <section className="rounded-[28px] border border-white/[0.08] bg-[#0b0912] p-7">
            <h1 className="text-2xl font-semibold">Tu rol no abre operaciones completas</h1>
            <p className="mt-2 text-sm leading-6 text-white/50">Tenés acceso a un Spot, pero tu rol actual no permite entrar al panel operativo completo desde MI FLOW.</p>
            <Link href={`/mi-spot/${spots[0].id}`} className="mt-6 inline-flex rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold">Abrir mi Spot</Link>
          </section>
        ) : null}
      </div>
    </main>
  );
}
