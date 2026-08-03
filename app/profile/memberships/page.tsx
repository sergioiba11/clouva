"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Membership = {
  id: string;
  role: string | null;
  area_label: string | null;
  internal_role: string | null;
  membership_status: string | null;
  is_primary: boolean;
  can_manage: boolean;
  studio_os_active: boolean;
  studio: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    cover_url: string | null;
    owner_id: string;
  };
};

export default function MembershipsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, router, user]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/profile/memberships");
        const payload = await readApiJson<{ memberships: Membership[] }>(response);
        if (!cancelled) setMemberships(payload.memberships);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar tus Estudios.");
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Cuenta multirol</p>
            <h1 className="mt-2 text-4xl font-bold">Mis Estudios</h1>
            <p className="mt-3 text-white/50">Tus membresías públicas y los Estudios que administrás aparecen en un mismo lugar, sin mezclarse.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/studios" className="rounded-xl border border-white/15 px-4 py-2 text-sm">Explorar Estudios</Link>
            <Link href="/studios/nuevo" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">+ Crear Estudio</Link>
          </div>
        </div>

        {error ? <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-200">{error}</p> : null}
        {memberships === null && !error ? <div className="mt-8 grid gap-5 sm:grid-cols-2"><div className="h-56 animate-pulse rounded-[2rem] bg-white/[0.04]" /><div className="h-56 animate-pulse rounded-[2rem] bg-white/[0.04]" /></div> : null}
        {memberships?.length === 0 ? <div className="mt-8 rounded-[2rem] border border-dashed border-white/15 p-10 text-center text-white/45">Todavía no formás parte de ningún Estudio.</div> : null}

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {memberships?.map((membership) => {
            const isOwner = membership.internal_role === "owner" || membership.studio.owner_id === user?.id;
            return (
              <article key={`${membership.studio.id}-${membership.id}`} className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025]">
                <div className="relative h-32 bg-gradient-to-br from-violet-900/40 to-black">
                  {membership.studio.cover_url ? <img src={membership.studio.cover_url} alt="" className="h-full w-full object-cover" /> : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] to-transparent" />
                </div>
                <div className="relative p-5">
                  {membership.studio.logo_url ? <img src={membership.studio.logo_url} alt={membership.studio.name} className="-mt-12 h-20 w-20 rounded-2xl border-4 border-[#07060b] object-cover" /> : <div className="-mt-12 flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-[#07060b] bg-violet-500/20 text-2xl font-semibold">{membership.studio.name.charAt(0)}</div>}
                  <h2 className="mt-4 text-xl font-semibold">{membership.studio.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {membership.role ? <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs">Player · {membership.role}</span> : null}
                    {membership.area_label ? <span className="rounded-full border border-violet-400/15 px-3 py-1 text-xs text-violet-200/70">{membership.area_label}</span> : null}
                    {membership.internal_role ? <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">Permiso: {membership.internal_role}</span> : null}
                    {membership.membership_status === "pending" ? <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">Pendiente de aprobación</span> : null}
                  </div>
                  <p className={`mt-4 text-xs ${membership.studio_os_active ? "text-emerald-300/75" : "text-amber-300/75"}`}>
                    {membership.studio_os_active ? "Studio OS activo" : "Studio OS inactivo"}
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <Link href={`/studios/${membership.studio.slug}`} className="rounded-xl border border-white/15 px-4 py-2.5 text-center text-sm">Ver Estudio</Link>
                    {membership.can_manage ? (
                      <Link href={`/studio-dashboard/${membership.studio.id}`} className="rounded-xl bg-violet-600 px-4 py-2.5 text-center text-sm font-semibold">Administrar</Link>
                    ) : isOwner && !membership.studio_os_active ? (
                      <Link href={`/studios/${membership.studio.slug}/studio-os`} className="rounded-xl bg-amber-400 px-4 py-2.5 text-center text-sm font-semibold text-black">Activar Studio OS</Link>
                    ) : membership.internal_role && !membership.studio_os_active ? (
                      <span className="rounded-xl bg-white/[0.05] px-4 py-2.5 text-center text-sm text-white/35">Esperando al dueño</span>
                    ) : (
                      <Link href={`/studios/${membership.studio.slug}`} className="rounded-xl bg-white/[0.08] px-4 py-2.5 text-center text-sm text-white/60">Entrar al Estudio</Link>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
