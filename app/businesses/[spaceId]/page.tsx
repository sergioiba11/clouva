"use client";

import { ArrowLeft, ArrowRight, Loader2, Settings2, Sparkles, Store, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Membership = {
  id: string;
  business_kind: string | null;
  internal_role: string | null;
  membership_status: string | null;
  can_manage: boolean;
  admin_href: string | null;
  team_href: string | null;
  space: {
    id: string;
    name: string;
    type: string;
    business_kind: string | null;
    category: string | null;
    subcategory: string | null;
    location_label: string | null;
    description: string | null;
    logo_url: string | null;
    cover_url: string | null;
  };
};

type Payload = { spaces: Membership[] };

export default function BusinessHomePage() {
  const params = useParams<{ spaceId: string }>();
  const spaceId = String(params.spaceId || "");
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const response = await authenticatedFetch("/api/profile/memberships");
      setData(await readApiJson<Payload>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir el negocio.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/businesses/${spaceId}`)}`);
      return;
    }
    void load();
  }, [authLoading, load, router, spaceId, user]);

  const membership = useMemo(() => data?.spaces.find((entry) => entry.space.id === spaceId) ?? null, [data, spaceId]);
  const isBusiness = membership?.space.business_kind === "digital_business" || membership?.space.business_kind === "physical_business";

  if (loading || authLoading) return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="grid min-h-[60vh] place-items-center"><span className="inline-flex items-center gap-2 text-sm text-white/40"><Loader2 size={16} className="animate-spin" /> Abriendo negocio…</span></div></main>;

  if (error) return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="mx-auto max-w-3xl px-4 py-10"><p className="rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p></div></main>;

  if (!membership || !isBusiness || membership.membership_status !== "active") {
    return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="mx-auto max-w-3xl px-4 py-10"><Link href="/businesses" className="inline-flex items-center gap-2 text-sm text-white/45"><ArrowLeft size={15} /> Mis negocios</Link><section className="mt-6 rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-6"><h1 className="text-2xl font-semibold">Este negocio no está disponible para tu Player.</h1><p className="mt-2 text-sm leading-6 text-white/42">Necesitás una relación activa con ese negocio. Los Studios se administran por separado y no activan Business Player.</p></section></div></main>;
  }

  const space = membership.space;
  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href="/businesses" className="inline-flex items-center gap-2 text-sm text-white/42 transition hover:text-white"><ArrowLeft size={15} /> Mis negocios</Link>
        <section className="mt-5 overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[radial-gradient(circle_at_85%_10%,rgba(34,211,238,.12),transparent_35%),#0b0912]">
          <div className="h-36 bg-white/[0.025]">{space.cover_url ? <img src={space.cover_url} alt="" className="h-full w-full object-cover opacity-70" /> : null}</div>
          <div className="p-6 sm:p-8">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="flex min-w-0 gap-4"><span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-cyan-200">{space.logo_url ? <img src={space.logo_url} alt="" className="h-full w-full object-cover" /> : <Store size={24} />}</span><div><p className="text-[10px] uppercase tracking-[0.16em] text-cyan-200/65">{space.business_kind === "physical_business" ? "Negocio físico" : "Negocio digital"}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-5xl">{space.name}</h1><p className="mt-2 text-sm text-white/42">{space.category || "Negocio"}{space.location_label ? ` · ${space.location_label}` : ""} · {membership.internal_role || "Player"}</p></div></div>
              <Link href={`/businesses/${space.id}/ai`} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black"><Sparkles size={16} /> Abrir Business Player</Link>
            </div>
            <p className="mt-5 max-w-3xl text-sm leading-6 text-white/48">{space.description || "Operá este negocio con las herramientas de tu Player y CLOUVA AI."}</p>
          </div>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-3">
          <Link href={`/businesses/${space.id}/ai`} className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/[0.055] p-5 transition hover:bg-cyan-300/[0.08]"><Sparkles size={20} className="text-cyan-200" /><h2 className="mt-4 text-lg font-semibold">Business Player</h2><p className="mt-2 text-sm leading-6 text-white/40">Buscar, comprar, coordinar, resolver y aprender de cada decisión del negocio.</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200">Entrar <ArrowRight size={15} /></span></Link>
          <Link href={membership.team_href || `/businesses/${space.id}/team`} className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 transition hover:border-white/15"><Users size={20} className="text-white/55" /><h2 className="mt-4 text-lg font-semibold">Equipo y accesos</h2><p className="mt-2 text-sm leading-6 text-white/40">Dueño, admins, managers y colaboradores del negocio.</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white/60">Administrar <ArrowRight size={15} /></span></Link>
          {membership.admin_href ? <Link href={membership.admin_href} className="rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5 transition hover:border-white/15"><Settings2 size={20} className="text-white/55" /><h2 className="mt-4 text-lg font-semibold">Operación comercial</h2><p className="mt-2 text-sm leading-6 text-white/40">Inventario, pedidos, publicaciones, logística y herramientas conectadas.</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white/60">Abrir herramientas <ArrowRight size={15} /></span></Link> : null}
        </section>
      </div>
    </main>
  );
}
