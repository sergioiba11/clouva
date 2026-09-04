"use client";

import { ArrowRight, Building2, Loader2, Plus, Search, Sparkles, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpaceMembership = {
  id: string;
  entity_type: string;
  business_kind: string | null;
  internal_role: string | null;
  membership_status: string | null;
  request_status: string | null;
  can_manage: boolean;
  enabled_modules: string[];
  space: {
    id: string;
    slug: string;
    name: string;
    type: string;
    business_kind: string | null;
    category: string | null;
    subcategory: string | null;
    location_label: string | null;
    description: string | null;
    logo_url: string | null;
    cover_url: string | null;
    public_enabled: boolean;
    status: string;
    owner_player_id: string | null;
    legacy_commerce_spot_id: string | null;
  };
};

type Payload = {
  player: { id: string; slug: string; display_name: string | null } | null;
  spaces: SpaceMembership[];
};

function isBusiness(item: SpaceMembership) {
  return item.space.business_kind === "digital_business" || item.space.business_kind === "physical_business";
}

function kindLabel(kind: string | null) {
  return kind === "physical_business" ? "Negocio físico" : "Negocio digital";
}

export default function BusinessesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/profile/memberships");
      const data = await readApiJson<Payload>(response);
      setPayload(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar tus negocios.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/businesses");
      return;
    }
    void load();
  }, [authLoading, load, router, user]);

  const businesses = useMemo(() => (payload?.spaces ?? []).filter(isBusiness), [payload]);

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <section className="overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[radial-gradient(circle_at_85%_10%,rgba(34,211,238,.12),transparent_35%),#0b0912] p-6 sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-white/50"><Building2 size={12} className="text-cyan-300" /> Player · Mis negocios</div>
          <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">Tus negocios viven en tu Player.</h1>
              <p className="mt-3 text-sm leading-6 text-white/48 sm:text-base">Cada negocio tiene sus permisos, equipo, memoria, operaciones y Business Player. Los Studios pueden colaborar, pero no son el dueño de esta capa.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/businesses/new" className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-black"><Plus size={15} /> Crear negocio</Link>
              <Link href="/businesses/manage" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm"><Search size={15} /> Administrar otro</Link>
            </div>
          </div>
        </section>

        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}
        {loading ? <div className="mt-6 grid min-h-48 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><span className="inline-flex items-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Cargando negocios…</span></div> : null}

        {!loading && !businesses.length ? (
          <section className="mt-6 rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-6 text-center sm:p-10">
            <Store size={28} className="mx-auto text-white/25" />
            <h2 className="mt-4 text-xl font-semibold">Todavía no tenés un negocio conectado a tu Player.</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/40">Podés crear uno propio o pedir acceso a uno existente. Cuando tengas acceso activo, Business Player aparece acá.</p>
          </section>
        ) : null}

        {!loading && businesses.length ? <section className="mt-6 grid gap-4 md:grid-cols-2">{businesses.map((entry) => {
          const space = entry.space;
          const active = entry.membership_status === "active";
          return (
            <article key={space.id} className="overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0b0912]">
              <div className="h-24 bg-[linear-gradient(120deg,rgba(34,211,238,.12),rgba(143,92,255,.1))]">{space.cover_url ? <img src={space.cover_url} alt="" className="h-full w-full object-cover opacity-70" /> : null}</div>
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-cyan-200">{space.logo_url ? <img src={space.logo_url} alt="" className="h-full w-full object-cover" /> : <Store size={19} />}</span>
                  <div className="min-w-0 flex-1"><h2 className="truncate text-xl font-semibold">{space.name}</h2><p className="mt-1 text-xs text-white/40">{kindLabel(space.business_kind)}{space.category ? ` · ${space.category}` : ""}{space.location_label ? ` · ${space.location_label}` : ""}</p></div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-white/38">{entry.internal_role || entry.request_status || "Player"}</span>
                </div>
                <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-white/42">{space.description || "Negocio conectado a tu Player."}</p>
                {active ? <div className="mt-5 flex flex-wrap gap-2"><Link href={`/businesses/${space.id}`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm">Abrir negocio <ArrowRight size={15} /></Link><Link href={`/businesses/${space.id}/ai`} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3.5 py-2.5 text-sm font-semibold text-black"><Sparkles size={15} /> Business Player</Link></div> : <p className="mt-5 text-xs text-amber-200/65">Acceso {entry.membership_status || entry.request_status || "pendiente"}. Business Player se activa cuando la relación queda activa.</p>}
              </div>
            </article>
          );
        })}</section> : null}
      </div>
    </main>
  );
}
