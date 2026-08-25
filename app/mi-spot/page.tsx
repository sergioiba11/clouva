"use client";

import { ArrowRight, Building2, Loader2, Plus, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpotItem = {
  id: string;
  name: string;
  slug: string;
  owner_type: "user" | "studio";
  business_type: string | null;
  business_categories: string[];
  enabled_modules: string[];
  description: string | null;
  accent_color: string | null;
  role: string;
  capabilities?: string[];
  requiresVipForAdministration?: boolean;
  settings?: Record<string, unknown> | null;
  studio: { id: string; name: string; slug: string } | null;
};

function typeLabel(spot: SpotItem) {
  if (spot.studio) return "Estudio";
  const type = typeof spot.settings?.space_type === "string" ? spot.settings.space_type : null;
  return ({ business: "Negocio", spot: "Spot", club: "Club", brand: "Marca", other: "Espacio" } as Record<string, string>)[type || ""] || "Negocio";
}

export default function MiSpotPage() {
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
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar tus espacios.");
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

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <section className="relative overflow-hidden rounded-[30px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0f0b18] to-[#09080f] p-6 sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-7 md:flex-row md:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200"><Store size={14} /> Tus espacios en CLOUVA</div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">MIS ESPACIOS</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55 sm:text-base">Tu Player puede participar en Estudios, Negocios, Spots, Clubes y Marcas. Con VIP podés crearlos y administrarlos; cada uno activa sólo los módulos que necesita.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/mi-spot/new" className="inline-flex items-center gap-2 rounded-xl bg-[#8f5cff] px-4 py-2.5 text-sm font-semibold shadow-[0_10px_35px_rgba(139,92,246,.28)]"><Plus size={16} /> Crear espacio</Link>
              <Link href="/mi-flow" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold">Ver MI FLOW</Link>
            </div>
          </div>
        </section>

        {loading ? <div className="mt-6 grid min-h-40 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/45"><Loader2 size={16} className="animate-spin" /> Cargando tus espacios…</span></div> : null}
        {error ? <p className="mt-6 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}

        {!loading && !error && !spots.length ? (
          <section className="mt-6 rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-7 sm:p-9">
            <div className="inline-grid rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] p-3 text-violet-300"><Sparkles size={22} /></div>
            <h2 className="mt-5 text-2xl font-semibold">Creá tu primer espacio</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">Puede ser un Estudio, un Negocio, un Spot, un Club o una Marca. Los negocios usan Gemini para sugerir módulos y estilo; los Estudios conservan Studio OS.</p>
            <Link href="/mi-spot/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold">Crear espacio <ArrowRight size={16} /></Link>
          </section>
        ) : null}

        {!loading && !error && spots.length ? (
          <section className="mt-7">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div><p className="text-xs uppercase tracking-[0.16em] text-white/35">Tu Player participa en</p><h2 className="mt-1 text-xl font-semibold">Elegí un espacio</h2></div>
              <span className="text-xs text-white/35">{spots.length} {spots.length === 1 ? "espacio" : "espacios"}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {spots.map((spot) => (
                <Link key={spot.id} href={`/mi-spot/${spot.id}`} className="group rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 transition hover:-translate-y-0.5 hover:border-violet-400/25 hover:bg-[#100c19]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-violet-300">{spot.owner_type === "studio" ? <Building2 size={20} /> : <Store size={20} />}</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/40">{spot.role}</span>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{spot.name}</h3>
                  <p className="mt-1 text-xs text-violet-300/75">{typeLabel(spot)}{spot.studio ? ` · ${spot.studio.name}` : ""}</p>
                  <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-white/42">{spot.description || "Configurá identidad, módulos y operación de este espacio."}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">{(spot.business_categories ?? []).slice(0, 3).map((category) => <span key={category} className="rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] text-white/40">{category}</span>)}</div>
                  <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-violet-300">{spot.requiresVipForAdministration ? "Ver espacio" : "Administrar espacio"} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" /></span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
