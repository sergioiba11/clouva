"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SpaceMembership = {
  id: string;
  entity_type: string;
  business_kind: string | null;
  role: string | null;
  area_label: string | null;
  internal_role: string | null;
  membership_status: string | null;
  request_status: string | null;
  requested_role: string | null;
  is_primary: boolean;
  can_manage: boolean;
  studio_os_active: boolean;
  enabled_modules: string[];
  admin_href: string | null;
  team_href: string;
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
    legacy_studio_id: string | null;
    legacy_commerce_spot_id: string | null;
  };
  studio: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    cover_url: string | null;
    owner_id: string;
  } | null;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Manager",
  partner: "Socio",
  team: "Integrante del equipo",
  viewer: "Integrante del equipo",
};

function kindLabel(membership: SpaceMembership) {
  if (membership.business_kind === "digital_business") return "Negocio digital";
  if (membership.business_kind === "physical_business") return "Negocio físico";
  if (membership.business_kind === "studio" || membership.entity_type === "studio") return "Estudio";
  return membership.entity_type === "business" ? "Negocio" : "Espacio";
}

export default function MembershipsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [spaces, setSpaces] = useState<SpaceMembership[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, router, user]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/profile/memberships");
        const payload = await readApiJson<{ spaces: SpaceMembership[] }>(response);
        if (!cancelled) setSpaces(payload.spaces ?? []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar tus negocios y espacios.");
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
            <h1 className="mt-2 text-4xl font-bold">Mis negocios y espacios</h1>
            <p className="mt-3 max-w-2xl text-white/50">Propiedad, participación, administración y solicitudes viven en el mismo Space Core sin convertir una relación pública en un permiso privado.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/businesses/manage" className="rounded-xl border border-white/15 px-4 py-2 text-sm">Solicitar acceso</Link>
            <Link href="/businesses/new" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white">+ Crear negocio</Link>
          </div>
        </div>

        {error ? <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-200">{error}</p> : null}
        {spaces === null && !error ? <div className="mt-8 grid gap-5 sm:grid-cols-2"><div className="h-56 animate-pulse rounded-[2rem] bg-white/[0.04]" /><div className="h-56 animate-pulse rounded-[2rem] bg-white/[0.04]" /></div> : null}
        {spaces?.length === 0 ? <div className="mt-8 rounded-[2rem] border border-dashed border-white/15 p-10 text-center text-white/45">Todavía no tenés negocios, espacios ni solicitudes vinculadas.</div> : null}

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {spaces?.map((membership) => {
            const isOwner = membership.internal_role === "owner";
            const canReviewTeam = membership.internal_role === "owner" || membership.internal_role === "admin";
            const cover = membership.space.cover_url || membership.studio?.cover_url || null;
            const logo = membership.space.logo_url || membership.studio?.logo_url || null;
            return (
              <article key={`${membership.space.id}-${membership.id}`} className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025]">
                <div className="relative h-32 bg-gradient-to-br from-violet-900/40 to-black">
                  {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] to-transparent" />
                </div>
                <div className="relative p-5">
                  {logo ? <img src={logo} alt={membership.space.name} className="-mt-12 h-20 w-20 rounded-2xl border-4 border-[#07060b] object-cover" /> : <div className="-mt-12 flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-[#07060b] bg-violet-500/20 text-2xl font-semibold">{membership.space.name.charAt(0)}</div>}
                  <div className="mt-4 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{membership.space.name}</h2><span className="rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-white/40">{kindLabel(membership)}</span></div>
                  <p className="mt-2 text-xs text-white/35">{[membership.space.category, membership.space.subcategory, membership.space.location_label].filter(Boolean).join(" · ") || "Space Core"}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {membership.role ? <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs">Player · {membership.role}</span> : null}
                    {membership.area_label ? <span className="rounded-full border border-violet-400/15 px-3 py-1 text-xs text-violet-200/70">{membership.area_label}</span> : null}
                    {membership.internal_role ? <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/45">Permiso · {ROLE_LABELS[membership.internal_role] || membership.internal_role}</span> : null}
                    {membership.membership_status === "invited" ? <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-200">Invitación pendiente</span> : null}
                    {membership.request_status === "pending" ? <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">Solicitud pendiente · {ROLE_LABELS[membership.requested_role || ""] || membership.requested_role}</span> : null}
                    {membership.request_status === "rejected" && !membership.internal_role ? <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/35">Solicitud rechazada</span> : null}
                  </div>

                  {membership.entity_type === "studio" ? <p className={`mt-4 text-xs ${membership.studio_os_active ? "text-emerald-300/75" : "text-amber-300/75"}`}>{membership.studio_os_active ? "Studio OS activo" : "Studio OS inactivo"}</p> : null}
                  {membership.enabled_modules.length ? <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-white/28">Módulos · {membership.enabled_modules.slice(0, 7).join(" · ")}</p> : null}

                  <div className="mt-5 grid grid-cols-2 gap-2">
                    {membership.studio ? <Link href={`/studios/${membership.studio.slug}`} className="rounded-xl border border-white/15 px-4 py-2.5 text-center text-sm">Ver espacio</Link> : membership.admin_href && membership.can_manage ? <Link href={membership.admin_href} className="rounded-xl border border-white/15 px-4 py-2.5 text-center text-sm">Entrar</Link> : <Link href="/matrix" className="rounded-xl border border-white/15 px-4 py-2.5 text-center text-sm">Explorar</Link>}

                    {membership.can_manage && membership.admin_href ? (
                      <Link href={membership.admin_href} className="rounded-xl bg-violet-600 px-4 py-2.5 text-center text-sm font-semibold">Administrar</Link>
                    ) : isOwner && membership.entity_type === "studio" && !membership.studio_os_active && membership.studio ? (
                      <Link href={`/studios/${membership.studio.slug}/studio-os`} className="rounded-xl bg-amber-400 px-4 py-2.5 text-center text-sm font-semibold text-black">Activar Studio OS</Link>
                    ) : membership.request_status === "pending" ? (
                      <span className="rounded-xl bg-white/[0.05] px-4 py-2.5 text-center text-sm text-white/35">Esperando respuesta</span>
                    ) : (
                      <Link href="/businesses/manage" className="rounded-xl bg-white/[0.08] px-4 py-2.5 text-center text-sm text-white/60">Solicitar rol</Link>
                    )}
                  </div>

                  {canReviewTeam ? <Link href={membership.team_href} className="mt-2 block rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-4 py-2.5 text-center text-sm text-violet-100/80">Equipo · solicitudes e invitaciones</Link> : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
