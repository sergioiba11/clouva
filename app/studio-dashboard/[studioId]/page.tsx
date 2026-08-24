"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { SpotQrCard } from "@/components/studio/SpotQrCard";
import { StudioAiProfilePanel } from "@/components/studio/StudioAiProfilePanel";

type DashboardData = {
  permission: { role: string; vip: boolean };
  studio: Record<string, unknown>;
  applications: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  players: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

type Section = "Resumen" | "Perfil público" | "Identidad IA" | "Players" | "Membresías" | "Servicios" | "Comercio" | "Solicitudes" | "Roles" | "Proyectos" | "Música" | "Eventos" | "QR del Spot" | "Configuración";
const SECTIONS: Section[] = ["Resumen", "Perfil público", "Identidad IA", "Players", "Membresías", "Servicios", "Comercio", "Solicitudes", "Roles", "Proyectos", "Música", "Eventos", "QR del Spot", "Configuración"];

type PlanRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | null;
  currency: string;
  billing_interval: "month" | "year" | null;
  is_free: boolean;
  is_active: boolean;
  is_public: boolean;
  benefits: string[];
};

type FanMemberRow = {
  id: string;
  status: string;
  source: string;
  joined_at: string;
  plan: { name: string; is_free: boolean; price: number | null; currency: string } | null;
  profile: { full_name: string | null; username: string | null; email: string | null } | null;
};

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_type: "fixed" | "consultar";
  price: number | null;
  currency: string;
  cta_type: "contratar" | "reservar" | "presupuesto";
  is_active: boolean;
};

export default function StudioDashboardPage({ params }: { params: Promise<{ studioId: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [studioId, setStudioId] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [section, setSection] = useState<Section>("Resumen");

  // Vuelta del OAuth de Instagram del Estudio (?tab=ai-profile, seteado
  // server-side por /api/integrations/instagram/connect) -- lleva directo a
  // la pestaña donde se ve el resultado, en vez de dejar al usuario en
  // "Resumen" preguntándose si se conectó o no.
  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "ai-profile") setSection("Identidad IA");
    if (requestedTab === "spot-qr") setSection("QR del Spot");
  }, [searchParams]);
  const [profileDraft, setProfileDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [newService, setNewService] = useState({ name: "", description: "", category: "", priceType: "fixed" as "fixed" | "consultar", price: "", ctaType: "contratar" as ServiceRow["cta_type"] });
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [fanMembers, setFanMembers] = useState<FanMemberRow[]>([]);
  const [newPlan, setNewPlan] = useState({ name: "", description: "", isFree: false, price: "", billingInterval: "month" as "month" | "year", benefits: "" });

  useEffect(() => { void params.then(({ studioId: id }) => setStudioId(id)); }, [params]);
  useEffect(() => { if (!authLoading && !user) router.replace("/login"); }, [authLoading, router, user]);

  const load = async () => {
    if (!user || !studioId) return;
    setLoading(true);
    setError(null);
    try {
      const [dashboardResponse, servicesResponse, plansResponse, fanMembersResponse] = await Promise.all([
        authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/dashboard`),
        authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/services`),
        authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/membership-plans`),
        authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/membership/members`),
      ]);
      const payload = await readApiJson<DashboardData>(dashboardResponse);
      const servicesPayload = await readApiJson<{ services: ServiceRow[] }>(servicesResponse);
      const plansPayload = await readApiJson<{ plans: PlanRow[] }>(plansResponse);
      const fanMembersPayload = await readApiJson<{ members: FanMemberRow[] }>(fanMembersResponse);
      setData(payload);
      setProfileDraft({ ...payload.studio });
      setServices(servicesPayload.services);
      setPlans(plansPayload.plans);
      setFanMembers(fanMembersPayload.members);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo abrir el panel.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [studioId, user]);

  const pendingApplications = useMemo(() => data?.applications.filter((item) => ["submitted", "in_review"].includes(String(item.status))) || [], [data]);
  const memberCounts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const item of data?.members || []) result[String(item.role || "member")] = (result[String(item.role || "member")] || 0) + 1;
    return result;
  }, [data]);

  const patch = async (payload: Record<string, unknown>) => {
    const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/dashboard`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return readApiJson<Record<string, unknown>>(response);
  };

  const saveStudio = async () => {
    setWorkingId("profile");
    setError(null);
    setMessage(null);
    try {
      const result = await patch({ action: "update_studio", changes: profileDraft });
      setData((current) => current ? { ...current, studio: result.studio as Record<string, unknown> } : current);
      setMessage("Perfil del Spot guardado.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar.");
    } finally {
      setWorkingId(null);
    }
  };

  const addService = async () => {
    if (!newService.name.trim()) {
      setError("El nombre del servicio es obligatorio.");
      return;
    }
    setWorkingId("new-service");
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/services`, {
        method: "POST",
        body: JSON.stringify({
          name: newService.name,
          description: newService.description || null,
          category: newService.category || null,
          priceType: newService.priceType,
          price: newService.priceType === "fixed" ? Number(newService.price) : null,
          ctaType: newService.ctaType,
        }),
      });
      const payload = await readApiJson<{ service: ServiceRow }>(response);
      setServices((current) => [...current, payload.service]);
      setNewService({ name: "", description: "", category: "", priceType: "fixed", price: "", ctaType: "contratar" });
      setMessage("Servicio agregado.");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "No se pudo agregar el servicio.");
    } finally {
      setWorkingId(null);
    }
  };

  const toggleService = async (service: ServiceRow) => {
    setWorkingId(service.id);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/services/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !service.is_active }),
      });
      const payload = await readApiJson<{ service: ServiceRow }>(response);
      setServices((current) => current.map((item) => item.id === service.id ? payload.service : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No se pudo actualizar el servicio.");
    } finally {
      setWorkingId(null);
    }
  };

  const deleteService = async (serviceId: string) => {
    if (!window.confirm("¿Borrar este servicio?")) return;
    setWorkingId(serviceId);
    setError(null);
    try {
      await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/services/${serviceId}`, { method: "DELETE" });
      setServices((current) => current.filter((item) => item.id !== serviceId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo borrar el servicio.");
    } finally {
      setWorkingId(null);
    }
  };

  const addPlan = async () => {
    if (!newPlan.name.trim()) {
      setError("El nombre del plan es obligatorio.");
      return;
    }
    setWorkingId("new-plan");
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/membership-plans`, {
        method: "POST",
        body: JSON.stringify({
          name: newPlan.name,
          description: newPlan.description || null,
          isFree: newPlan.isFree,
          price: newPlan.isFree ? null : Number(newPlan.price),
          billingInterval: newPlan.isFree ? null : newPlan.billingInterval,
          benefits: newPlan.benefits.split("\n").map((line) => line.trim()).filter(Boolean),
        }),
      });
      const payload = await readApiJson<{ plan: PlanRow }>(response);
      setPlans((current) => [...current, payload.plan]);
      setNewPlan({ name: "", description: "", isFree: false, price: "", billingInterval: "month", benefits: "" });
      setMessage("Plan de membresía creado.");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "No se pudo crear el plan.");
    } finally {
      setWorkingId(null);
    }
  };

  const togglePlan = async (plan: PlanRow) => {
    setWorkingId(plan.id);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/membership-plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !plan.is_active }),
      });
      const payload = await readApiJson<{ plan: PlanRow }>(response);
      setPlans((current) => current.map((item) => item.id === plan.id ? payload.plan : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No se pudo actualizar el plan.");
    } finally {
      setWorkingId(null);
    }
  };

  const deletePlan = async (planId: string) => {
    if (!window.confirm("¿Borrar este plan?")) return;
    setWorkingId(planId);
    setError(null);
    try {
      await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/membership-plans/${planId}`, { method: "DELETE" });
      setPlans((current) => current.filter((item) => item.id !== planId));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo borrar el plan.");
    } finally {
      setWorkingId(null);
    }
  };

  const review = async (applicationId: string, status: "in_review" | "accepted" | "rejected") => {
    setWorkingId(applicationId);
    setError(null);
    try {
      const notes = status === "rejected" ? window.prompt("Motivo o comentario para la revisión") || "" : "";
      await patch({ action: "review_application", applicationId, status, notes, publicRole: "Miembro" });
      await load();
      setMessage(status === "accepted" ? "Solicitud aceptada y Player vinculado." : status === "rejected" ? "Solicitud rechazada." : "Solicitud en revisión.");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "No se pudo revisar la solicitud.");
    } finally {
      setWorkingId(null);
    }
  };

  if (loading) return <main className="min-h-screen bg-[#05040a] px-4 py-10 text-white"><div className="mx-auto h-[75vh] max-w-7xl animate-pulse rounded-[2rem] bg-white/[0.04]" /></main>;
  if (!data) return <main className="min-h-screen bg-[#05040a] px-4 py-20 text-white"><div className="mx-auto max-w-xl rounded-[2rem] border border-red-400/20 bg-red-400/10 p-8 text-center"><h1 className="text-2xl font-semibold">Acceso bloqueado</h1><p className="mt-3 text-red-100/70">{error || "No pudimos abrir este Spot."}</p><Link href="/vip" className="mt-6 inline-flex rounded-xl bg-amber-400 px-5 py-3 font-semibold text-black">Ver CLOUVA VIP</Link></div></main>;

  const studioName = String(data.studio.name || "Estudio");
  const studioSlug = String(data.studio.slug || studioId);
  const spotIsPublic = Boolean(data.studio.is_published)
    && String(data.studio.publication_status || "") === "published"
    && ["active", "grace", "legacy_active"].includes(String(data.studio.studio_os_status || ""));
  const publicSpotPath = `/studios/${studioSlug}`;

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05040a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {data.studio.logo_url ? <img src={String(data.studio.logo_url)} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 font-semibold">{studioName.charAt(0)}</div>}
            <div><p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Admin del Spot</p><h1 className="font-semibold">{studioName}</h1></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-xs text-amber-300 sm:block">VIP · {data.permission.role}</span>
            <Link href={`/studio-dashboard/${studioId}/commerce`} className="hidden rounded-xl border border-violet-400/25 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-100 sm:inline-flex">Comercio</Link>
            <Link href={publicSpotPath} target="_blank" className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold">Ver Spot</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-2 overflow-x-auto lg:flex-col">
          {SECTIONS.map((item) => (
            <button
              key={item}
              onClick={() => item === "Comercio" ? router.push(`/studio-dashboard/${studioId}/commerce`) : setSection(item)}
              className={`relative shrink-0 rounded-xl px-4 py-3 text-left text-sm transition ${section === item ? "bg-violet-600" : "border border-white/10 bg-white/[0.025] text-white/55 hover:text-white"}`}
            >
              {item}
              {item === "Solicitudes" && pendingApplications.length ? <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-[10px]">{pendingApplications.length}</span> : null}
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {section === "Resumen" ? <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Solicitudes pendientes" value={pendingApplications.length} /><Metric label="Players" value={data.players.length} /><Metric label="Miembros internos" value={data.members.length} /><Metric label="Proyectos" value={data.projects.length} /></div>
            <SpotQrCard entityName={studioName} publicPath={publicSpotPath} isPublic={spotIsPublic} compact />
            <Panel title="Actividad que requiere atención"><div className="space-y-3">{pendingApplications.slice(0, 5).map((application) => <ApplicationRow key={String(application.id)} application={application} working={workingId === application.id} onReview={review} />)}{pendingApplications.length === 0 ? <p className="text-sm text-white/45">No hay solicitudes pendientes.</p> : null}</div></Panel>
            <Panel title="Miembros por rol"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(memberCounts).map(([role, count]) => <div key={role} className="rounded-xl border border-white/8 bg-black/20 p-4"><p className="text-sm capitalize text-white/55">{role}</p><p className="mt-2 text-2xl font-semibold">{count}</p></div>)}</div></Panel>
          </div> : null}

          {section === "Perfil público" ? <Panel title="Editar presentación pública del Spot"><div className="space-y-4"><Field label="Nombre" value={String(profileDraft.name || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, name: value }))} /><Field label="Frase institucional" value={String(profileDraft.tagline || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, tagline: value }))} /><TextArea label="Presentación" value={String(profileDraft.description || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, description: value }))} rows={8} /><div className="grid gap-4 sm:grid-cols-2"><Field label="Logo URL" value={String(profileDraft.logo_url || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, logo_url: value }))} /><Field label="Portada URL" value={String(profileDraft.cover_url || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, cover_url: value }))} /></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Ciudad" value={String(profileDraft.city || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, city: value }))} /><Field label="País" value={String(profileDraft.country || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, country: value }))} /></div><button disabled={workingId === "profile"} onClick={() => void saveStudio()} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold">{workingId === "profile" ? "Guardando..." : "Guardar cambios"}</button></div></Panel> : null}

          {section === "Identidad IA" ? <Panel title="Identidad del Spot"><StudioAiProfilePanel studioId={studioId} /></Panel> : null}

          {section === "Players" ? <Panel title="Players vinculados"><div className="grid gap-3 sm:grid-cols-2">{data.players.map((entry) => { const player = entry.player as Record<string, unknown> | null; return player ? <Link key={String(entry.id)} href={`/${String(player.slug)}`} className="flex items-center gap-3 rounded-2xl border border-white/10 p-4 transition hover:border-violet-400/50">{player.profile_image_url ? <img src={String(player.profile_image_url)} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15">{String(player.display_name).charAt(0)}</div>}<div><p className="font-semibold">{String(player.display_name)}</p><p className="text-xs text-white/40">{String(entry.role || player.primary_role || "Player")}</p></div></Link> : null; })}{data.players.length === 0 ? <p className="text-white/45">Todavía no hay Players vinculados.</p> : null}</div></Panel> : null}

          {section === "Membresías" ? <div className="space-y-5">
            <Panel title="Planes de membresía">
              <div className="mb-5 flex flex-col justify-between gap-3 rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4 sm:flex-row sm:items-center">
                <div><p className="text-sm font-semibold text-violet-100">Conectado al Spot público</p><p className="mt-1 text-xs text-white/45">Los planes públicos y activos se muestran en {studioName}.</p></div>
                <Link href={publicSpotPath} target="_blank" className="shrink-0 rounded-xl border border-violet-400/25 px-3 py-2 text-xs font-semibold text-violet-100">Ver Spot</Link>
              </div>
              <div className="space-y-3">
                {plans.map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{plan.name}</p>
                        {!plan.is_active ? <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase text-white/40">Inactivo</span> : null}
                        {plan.is_public && plan.is_active ? <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase text-violet-200">Visible en Spot</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-white/45">{plan.is_free ? "Gratis" : `${new Intl.NumberFormat("es-AR", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(Number(plan.price))} / ${plan.billing_interval === "year" ? "año" : "mes"}`}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button disabled={workingId === plan.id} onClick={() => void togglePlan(plan)} className="rounded-xl border border-white/15 px-3 py-2 text-xs">{plan.is_active ? "Desactivar" : "Activar"}</button>
                      <button disabled={workingId === plan.id} onClick={() => void deletePlan(plan.id)} className="rounded-xl border border-red-400/20 px-3 py-2 text-xs text-red-300">Borrar</button>
                    </div>
                  </div>
                ))}
                {plans.length === 0 ? <p className="text-white/45">Todavía no creaste planes de membresía.</p> : null}
              </div>

              <div className="mt-6 space-y-3 rounded-2xl border border-dashed border-white/15 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-white/40">Agregar plan</p>
                <Field label="Nombre (ej. Socio Premium)" value={newPlan.name} onChange={(value) => setNewPlan((current) => ({ ...current, name: value }))} />
                <TextArea label="Beneficios (uno por línea)" value={newPlan.benefits} onChange={(value) => setNewPlan((current) => ({ ...current, benefits: value }))} rows={3} />
                <label className="flex items-center gap-2 text-sm text-white/60">
                  <input type="checkbox" checked={newPlan.isFree} onChange={(event) => setNewPlan((current) => ({ ...current, isFree: event.target.checked }))} />
                  Es un plan gratuito
                </label>
                {!newPlan.isFree ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Precio (ARS)" value={newPlan.price} onChange={(value) => setNewPlan((current) => ({ ...current, price: value.replace(/[^0-9.]/g, "") }))} />
                    <label className="block">
                      <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">Frecuencia</span>
                      <select value={newPlan.billingInterval} onChange={(event) => setNewPlan((current) => ({ ...current, billingInterval: event.target.value as "month" | "year" }))} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                        <option value="month">Mensual</option>
                        <option value="year">Anual</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                <button disabled={workingId === "new-plan"} onClick={() => void addPlan()} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold">{workingId === "new-plan" ? "Creando..." : "Crear plan"}</button>
              </div>
            </Panel>

            <Panel title="Socios">
              <div className="space-y-2">
                {fanMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                    <span>{member.profile?.full_name || member.profile?.username || member.profile?.email || "Socio"}</span>
                    <span className="text-white/60">{member.plan?.is_free || !member.plan ? "Gratis" : `${new Intl.NumberFormat("es-AR", { style: "currency", currency: member.plan.currency, maximumFractionDigits: 0 }).format(Number(member.plan.price))}`}</span>
                    <span className={member.status === "active" ? "text-emerald-300" : "text-white/40"}>{member.status}</span>
                    <span className="text-xs text-white/40">Desde {new Date(member.joined_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  </div>
                ))}
                {fanMembers.length === 0 ? <p className="text-white/45">Todavía no tenés socios.</p> : null}
              </div>
            </Panel>
          </div> : null}

          {section === "Servicios" ? <Panel title="Catálogo de servicios">
            <div className="mb-5 rounded-2xl border border-violet-400/15 bg-violet-500/[0.06] p-4"><p className="text-sm font-semibold text-violet-100">Servicios del Spot</p><p className="mt-1 text-xs text-white/45">Los servicios activos se consumen desde la misma fuente canónica que la página pública.</p></div>
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{service.name}</p>
                      {!service.is_active ? <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase text-white/40">Inactivo</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-white/45">{service.category || "Sin categoría"} · {service.price_type === "consultar" ? "A consultar" : new Intl.NumberFormat("es-AR", { style: "currency", currency: service.currency, maximumFractionDigits: 0 }).format(Number(service.price))}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button disabled={workingId === service.id} onClick={() => void toggleService(service)} className="rounded-xl border border-white/15 px-3 py-2 text-xs">{service.is_active ? "Desactivar" : "Activar"}</button>
                    <button disabled={workingId === service.id} onClick={() => void deleteService(service.id)} className="rounded-xl border border-red-400/20 px-3 py-2 text-xs text-red-300">Borrar</button>
                  </div>
                </div>
              ))}
              {services.length === 0 ? <p className="text-white/45">Todavía no cargaste servicios.</p> : null}
            </div>

            <div className="mt-6 space-y-3 rounded-2xl border border-dashed border-white/15 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Agregar servicio</p>
              <Field label="Nombre" value={newService.name} onChange={(value) => setNewService((current) => ({ ...current, name: value }))} />
              <Field label="Categoría (ej. Grabación, Mezcla, Diseño)" value={newService.category} onChange={(value) => setNewService((current) => ({ ...current, category: value }))} />
              <TextArea label="Descripción" value={newService.description} onChange={(value) => setNewService((current) => ({ ...current, description: value }))} rows={3} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">Precio</span>
                  <select value={newService.priceType} onChange={(event) => setNewService((current) => ({ ...current, priceType: event.target.value as "fixed" | "consultar" }))} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                    <option value="fixed">Precio fijo</option>
                    <option value="consultar">A consultar</option>
                  </select>
                </label>
                {newService.priceType === "fixed" ? <Field label="Monto (ARS)" value={newService.price} onChange={(value) => setNewService((current) => ({ ...current, price: value.replace(/[^0-9.]/g, "") }))} /> : null}
              </div>
              <button disabled={workingId === "new-service"} onClick={() => void addService()} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold">{workingId === "new-service" ? "Agregando..." : "Agregar servicio"}</button>
            </div>
          </Panel> : null}

          {section === "Solicitudes" ? <Panel title="Solicitudes de ingreso"><div className="space-y-3">{data.applications.map((application) => <ApplicationRow key={String(application.id)} application={application} working={workingId === application.id} onReview={review} />)}{data.applications.length === 0 ? <p className="text-white/45">Todavía no hay solicitudes.</p> : null}</div></Panel> : null}

          {section === "Roles" ? <Panel title="Roles internos"><div className="space-y-3">{data.members.map((member) => { const profile = member.profile as Record<string, unknown> | null; return <div key={String(member.id)} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 p-4"><div><p className="font-semibold">{String(profile?.display_name || profile?.full_name || profile?.username || "Miembro")}</p><p className="text-xs text-white/40">{String(member.status)}</p></div><span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs capitalize">{String(member.role)}</span></div>; })}</div></Panel> : null}

          {section === "Proyectos" ? <Panel title="Proyectos"><ContentList items={data.projects} empty="Todavía no hay proyectos." /></Panel> : null}
          {section === "Música" ? <Panel title="Música"><p className="text-white/50">La música publicada por el Spot se gestiona desde sus proyectos y links oficiales.</p></Panel> : null}
          {section === "Eventos" ? <Panel title="Eventos"><ContentList items={data.events} empty="Todavía no hay eventos." /></Panel> : null}
          {section === "QR del Spot" ? <SpotQrCard entityName={studioName} publicPath={publicSpotPath} isPublic={spotIsPublic} /> : null}
          {section === "Configuración" ? <Panel title="Configuración del Spot"><div className="space-y-4"><Field label="Sitio web" value={String(profileDraft.website_url || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, website_url: value }))} /><Field label="Correo de contacto" value={String(profileDraft.contact_email || "")} onChange={(value) => setProfileDraft((current) => ({ ...current, contact_email: value }))} /><div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-[0.16em] text-white/35">Página pública del Spot</p><p className="mt-2 break-all text-sm text-white/65">https://clouva.com.ar{publicSpotPath}</p></div><button disabled={workingId === "profile"} onClick={() => void saveStudio()} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold">Guardar configuración</button></div></Panel> : null}

          {error ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
          {message ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5"><p className="text-sm text-white/45">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-[2rem] border border-white/10 bg-[#0b0913] p-5 sm:p-7"><h2 className="mb-5 text-xl font-semibold">{title}</h2>{children}</div>; }
function ApplicationRow({ application, working, onReview }: { application: Record<string, unknown>; working: boolean; onReview: (id: string, status: "in_review" | "accepted" | "rejected") => Promise<void> }) { const id = String(application.id); const player = application.player as Record<string, unknown> | null; return <article className="rounded-2xl border border-white/10 bg-black/20 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{String(application.artist_name)}</h3><span className="rounded-full bg-white/8 px-2 py-1 text-[10px] uppercase text-white/45">{String(application.status)}</span></div><p className="mt-1 text-sm text-violet-300/70">{String(application.category || player?.display_name || "Player")}</p><p className="mt-3 line-clamp-3 text-sm leading-6 text-white/55">{String(application.presentation || "")}</p></div>{["submitted", "in_review"].includes(String(application.status)) ? <div className="flex shrink-0 gap-2"><button disabled={working} onClick={() => void onReview(id, "rejected")} className="rounded-xl border border-red-400/20 px-3 py-2 text-xs text-red-300">Rechazar</button>{application.status === "submitted" ? <button disabled={working} onClick={() => void onReview(id, "in_review")} className="rounded-xl border border-white/15 px-3 py-2 text-xs">Revisar</button> : null}<button disabled={working} onClick={() => void onReview(id, "accepted")} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold">Aceptar</button></div> : null}</div></article>; }
function ContentList({ items, empty }: { items: Array<Record<string, unknown>>; empty: string }) { if (!items.length) return <p className="text-white/45">{empty}</p>; return <div className="grid gap-3 sm:grid-cols-2">{items.map((item) => <article key={String(item.id)} className="rounded-2xl border border-white/10 p-4"><p className="font-semibold">{String(item.title || item.name || "Contenido")}</p><p className="mt-2 line-clamp-2 text-sm text-white/45">{String(item.description || item.location || "")}</p></article>)}</div>; }
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" /></label>; }
function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) { return <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-violet-400/60" /></label>; }
