"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  Headphones,
  LayoutDashboard,
  Music2,
  PackageSearch,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
  UserCog,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type DashboardPayload = {
  permission: { role: string; studio_os_active?: boolean };
  studio: Record<string, unknown>;
  applications: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  players: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

type ServiceRow = {
  id: string;
  is_active: boolean;
};

type InventorySummary = {
  totalItems: number;
  lowStock: number;
  pendingPurchases: number;
  estimatedValue: number;
  expenses: number;
  operationalSales: number;
};

type Props = {
  studioId: string;
  studioName: string;
  logoUrl?: string | null;
  backgroundUrl?: string | null;
  publicPath: string;
  mediaPath: string;
  agendaPath: string;
};

function money(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

export function IgluAdminHome({
  studioId,
  studioName,
  logoUrl,
  backgroundUrl,
  publicPath,
  mediaPath,
  agendaPath,
}: Props) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [inventory, setInventory] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user || !studioId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const dashboardResponse = await authenticatedFetch("/api/studios/" + encodeURIComponent(studioId) + "/dashboard");
        const dashboardPayload = await readApiJson<DashboardPayload>(dashboardResponse);

        const [servicesPayload, inventoryPayload] = await Promise.all([
          authenticatedFetch("/api/studios/" + encodeURIComponent(studioId) + "/services")
            .then((response) => readApiJson<{ services: ServiceRow[] }>(response))
            .catch(() => ({ services: [] })),
          authenticatedFetch("/api/studios/" + encodeURIComponent(studioId) + "/inventory")
            .then((response) => readApiJson<{ summary: InventorySummary }>(response))
            .catch(() => null),
        ]);

        if (cancelled) return;
        setDashboard(dashboardPayload);
        setServices(servicesPayload.services || []);
        setInventory(inventoryPayload?.summary || null);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "No se pudo abrir la administración de El Iglú.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [studioId, user]);

  const pendingApplications = useMemo(
    () => dashboard?.applications.filter((item) => ["submitted", "in_review"].includes(String(item.status))).length || 0,
    [dashboard],
  );
  const activeServices = useMemo(() => services.filter((item) => item.is_active).length, [services]);

  if (loading || authLoading) {
    return (
      <main className="min-h-screen bg-[#01070d] px-6 py-8 text-white">
        <div className="mx-auto h-[84vh] max-w-[1800px] animate-pulse rounded-[32px] border border-cyan-200/10 bg-white/[0.025]" />
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="min-h-screen bg-[#01070d] px-6 py-16 text-white">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-red-300/15 bg-red-500/[0.06] p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-200/60">IGLÚ CONTROL</p>
          <h1 className="mt-3 text-3xl font-semibold">No se pudo abrir la administración</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">{error || "Tu usuario no tiene acceso a este Studio."}</p>
          <Link href={publicPath} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/75">
            Volver a El Iglú <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      </main>
    );
  }

  const published =
    Boolean(dashboard.studio.is_published) &&
    String(dashboard.studio.publication_status || "") === "published";
  const dashboardBase = "/studio-dashboard/" + studioId;

  const attentionCount =
    pendingApplications +
    (inventory?.lowStock || 0) +
    (inventory?.pendingPurchases || 0);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#01070d] text-white">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-cover bg-center opacity-[0.22]"
        style={backgroundUrl ? { backgroundImage: "url('" + backgroundUrl + "')" } : undefined}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[linear-gradient(180deg,rgba(1,7,13,0.15),#01070d_88%)]" />
      <div className="pointer-events-none absolute left-[28%] top-[-180px] h-[520px] w-[520px] rounded-full bg-cyan-300/[0.08] blur-[130px]" />
      <div className="pointer-events-none absolute right-[8%] top-[120px] h-[420px] w-[420px] rounded-full bg-blue-600/[0.08] blur-[130px]" />

      <div className="relative mx-auto w-full max-w-[1800px] px-5 pb-16 pt-5 sm:px-7 lg:px-10">
        <header className="flex min-h-16 items-center justify-between gap-5 rounded-2xl border border-cyan-100/[0.09] bg-[#03101a]/80 px-4 py-3 shadow-[0_20px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-11 w-11 rounded-xl object-contain drop-shadow-[0_0_14px_rgba(128,220,255,0.45)]" />
            ) : (
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-cyan-200/15 bg-cyan-300/[0.06] font-semibold text-cyan-100">I</div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/45">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" />
                CLOUVA · Studio OS
              </div>
              <p className="truncate text-sm font-semibold sm:text-base">{studioName} · Administración</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full border border-cyan-200/10 bg-cyan-200/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-50/55 md:inline-flex">
              {dashboard.permission.role}
            </span>
            <Link
              href={publicPath}
              target="_blank"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/10 bg-white/[0.03] px-3.5 py-2 text-xs font-semibold text-white/70 transition hover:border-cyan-200/25 hover:bg-cyan-200/[0.06] hover:text-white"
            >
              Ver home <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        <section className="mt-5 overflow-hidden rounded-[30px] border border-cyan-100/[0.1] bg-[#03101a]/72 shadow-[0_28px_100px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <div className="grid min-h-[270px] gap-8 p-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.6fr)] lg:p-10">
            <div className="flex flex-col justify-between gap-8">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.05] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/65">
                    CONTROL ROOM
                  </span>
                  <span className={"rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] " + (published ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200/70" : "border-white/10 bg-white/[0.03] text-white/45")}>
                    {published ? "Spot publicado" : "Spot en borrador"}
                  </span>
                </div>
                <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                  El Iglú desde un solo lugar.
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-7 text-white/48 sm:text-base">
                  Reservas, caja, inventario, Players, música, stream, identidad y equipo conectados al mismo Studio.
                </p>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <Link href={agendaPath} className="inline-flex items-center gap-2 rounded-xl bg-cyan-100 px-4 py-2.5 text-sm font-semibold text-[#03101a] transition hover:bg-white">
                  <CalendarDays className="h-4 w-4" /> Abrir agenda
                </Link>
                <Link href={dashboardBase + "/commerce"} className="inline-flex items-center gap-2 rounded-xl border border-cyan-100/15 bg-cyan-200/[0.05] px-4 py-2.5 text-sm font-semibold text-cyan-50/85 transition hover:bg-cyan-200/[0.1]">
                  <CircleDollarSign className="h-4 w-4" /> Comercio / Caja
                </Link>
                <Link href={mediaPath} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm font-semibold text-white/65 transition hover:text-white">
                  <Radio className="h-4 w-4" /> Stream
                </Link>
              </div>
            </div>

            <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <StatusPanel label="Atención" value={attentionCount} detail="cosas para revisar" active={attentionCount > 0} />
              <StatusPanel label="Servicios" value={activeServices} detail="activos en el Spot" />
              <StatusPanel label="Players" value={dashboard.players.length} detail="vinculados" />
              <StatusPanel label="Proyectos" value={dashboard.projects.length} detail="en el Studio" />
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Solicitudes" value={pendingApplications} detail="pendientes" />
          <MetricCard label="Eventos" value={dashboard.events.length} detail="registrados" />
          <MetricCard label="Equipo" value={dashboard.members.length} detail="miembros internos" />
          <MetricCard label="Inventario" value={inventory?.totalItems ?? 0} detail="ítems" />
          <MetricCard label="Stock bajo" value={inventory?.lowStock ?? 0} detail="requieren atención" danger={Boolean(inventory?.lowStock)} />
          <MetricCard label="Compras" value={inventory?.pendingPurchases ?? 0} detail="pendientes" danger={Boolean(inventory?.pendingPurchases)} />
        </section>

        <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.45fr)]">
          <div className="space-y-5">
            <section className="rounded-[28px] border border-cyan-100/[0.08] bg-[#03101a]/68 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-6">
              <SectionHeading eyebrow="OPERACIÓN" title="Mover El Iglú" description="Accesos de trabajo diario del Studio." />
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <ModuleCard href={agendaPath} icon={CalendarDays} title="Reservas y agenda" description="Sesiones, fechas y disponibilidad." tone="cyan" />
                <ModuleCard href={dashboardBase + "/commerce"} icon={ShoppingBag} title="Comercio / Caja" description="Productos, publicaciones y ventas." tone="cyan" />
                <ModuleCard href={dashboardBase + "/inventario"} icon={Boxes} title="Mi Spot / Inventario" description="Stock, compras, consumos y provisiones." tone="cyan" />
                <ModuleCard href={dashboardBase + "?tab=services"} icon={Wrench} title="Servicios" description="Grabación, mezcla, master y servicios activos." />
                <ModuleCard href={dashboardBase + "?tab=events"} icon={Activity} title="Eventos" description="Fechas y actividad vinculada al Studio." />
                <ModuleCard href={mediaPath} icon={Headphones} title="Media / Stream" description="Kick, YouTube, radio, live y reproducción." />
              </div>
            </section>

            <section className="rounded-[28px] border border-cyan-100/[0.08] bg-[#03101a]/68 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-6">
              <SectionHeading eyebrow="MÚSICA + COMUNIDAD" title="Identidad viva del Studio" description="Players, proyectos y publicación conectados a El Iglú." />
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ModuleCard href={dashboardBase + "?tab=players"} icon={Users} title="Players" description="Artistas y personas vinculadas." />
                <ModuleCard href={dashboardBase + "?tab=projects"} icon={Music2} title="Proyectos" description="Singles, EPs, álbumes y trabajos." />
                <ModuleCard href={dashboardBase + "?tab=requests"} icon={ShieldCheck} title="Solicitudes" description="Ingresos pendientes y revisiones." badge={pendingApplications || undefined} />
                <ModuleCard href={dashboardBase + "?tab=memberships"} icon={Sparkles} title="Membresías" description="Planes, socios y beneficios." />
              </div>
            </section>

            <section className="rounded-[28px] border border-cyan-100/[0.08] bg-[#03101a]/68 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:p-6">
              <SectionHeading eyebrow="SISTEMA" title="Control del Studio" description="Identidad, equipo, permisos y herramientas de CLOUVA." />
              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <ModuleCard href={dashboardBase + "?tab=profile"} icon={LayoutDashboard} title="Home pública" description="Nombre, portada, presentación y publicación." />
                <ModuleCard href={dashboardBase + "?tab=ai-profile"} icon={Sparkles} title="Identidad IA" description="Workspace visual de la identidad del Spot." />
                <ModuleCard href={dashboardBase + "/team"} icon={UserCog} title="Equipo / Roles" description="Accesos y funciones internas." />
                <ModuleCard href={dashboardBase + "?tab=clouva-ai"} icon={Sparkles} title="CLOUVA AI" description="Asistente con contexto real del Studio." />
                <ModuleCard href={dashboardBase + "?tab=spot-qr"} icon={PackageSearch} title="QR del Spot" description="Acceso directo a la identidad pública." />
                <ModuleCard href={dashboardBase + "?tab=config"} icon={Settings} title="Configuración" description="Contacto, URLs y opciones generales." />
              </div>
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-[28px] border border-cyan-100/[0.08] bg-[#03101a]/76 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/45">MI SPOT</p>
                  <h2 className="mt-1 text-xl font-semibold">Inventario operativo</h2>
                </div>
                <Boxes className="h-5 w-5 text-cyan-200/55" />
              </div>

              <div className="mt-5 grid gap-2">
                <InventoryRow label="Valor estimado" value={inventory ? money(inventory.estimatedValue) : "—"} />
                <InventoryRow label="Ventas operativas" value={inventory ? money(inventory.operationalSales) : "—"} />
                <InventoryRow label="Gastos registrados" value={inventory ? money(inventory.expenses) : "—"} />
                <InventoryRow label="Stock bajo" value={String(inventory?.lowStock ?? 0)} alert={Boolean(inventory?.lowStock)} />
                <InventoryRow label="Compras pendientes" value={String(inventory?.pendingPurchases ?? 0)} alert={Boolean(inventory?.pendingPurchases)} />
              </div>

              <Link href={dashboardBase + "/inventario"} className="mt-5 flex items-center justify-between rounded-xl border border-cyan-100/10 bg-cyan-200/[0.04] px-4 py-3 text-sm font-semibold text-cyan-50/75 transition hover:bg-cyan-200/[0.08] hover:text-white">
                Abrir Mi Spot <ArrowUpRight className="h-4 w-4" />
              </Link>
            </section>

            <section className="rounded-[28px] border border-cyan-100/[0.08] bg-[#03101a]/76 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/45">REQUIERE ATENCIÓN</p>
              <div className="mt-4 space-y-2.5">
                <AttentionItem
                  label="Solicitudes de Players"
                  value={pendingApplications}
                  href={dashboardBase + "?tab=requests"}
                />
                <AttentionItem
                  label="Ítems con stock bajo"
                  value={inventory?.lowStock ?? 0}
                  href={dashboardBase + "/inventario"}
                />
                <AttentionItem
                  label="Compras pendientes"
                  value={inventory?.pendingPurchases ?? 0}
                  href={dashboardBase + "/inventario"}
                />
              </div>
            </section>

            <section className="rounded-[28px] border border-cyan-100/[0.08] bg-[#03101a]/76 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-xl">
              <div className="flex items-center gap-2 text-cyan-100/55">
                <Radio className="h-4 w-4" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em]">SALIDA PÚBLICA</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/50">
                La administración y la experiencia pública quedan separadas, pero trabajan sobre la misma identidad y datos del Studio.
              </p>
              <div className="mt-4 grid gap-2">
                <Link href={publicPath} target="_blank" className="flex items-center justify-between rounded-xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/65 hover:text-white">
                  Home de El Iglú <ExternalLink className="h-4 w-4" />
                </Link>
                <Link href={mediaPath} target="_blank" className="flex items-center justify-between rounded-xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/65 hover:text-white">
                  Media / Live <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/40">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em] sm:text-2xl">{title}</h2>
      <p className="mt-1.5 text-sm text-white/42">{description}</p>
    </div>
  );
}

function MetricCard({ label, value, detail, danger = false }: { label: string; value: number; detail: string; danger?: boolean }) {
  return (
    <div className={"rounded-2xl border p-4 " + (danger ? "border-amber-300/15 bg-amber-300/[0.045]" : "border-cyan-100/[0.07] bg-[#03101a]/60")}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/34">{label}</p>
      <p className={"mt-2 text-2xl font-semibold " + (danger ? "text-amber-100" : "text-white")}>{value}</p>
      <p className="mt-1 text-[11px] text-white/32">{detail}</p>
    </div>
  );
}

function StatusPanel({ label, value, detail, active = false }: { label: string; value: number; detail: string; active?: boolean }) {
  return (
    <div className={"rounded-2xl border p-4 " + (active ? "border-amber-300/15 bg-amber-300/[0.05]" : "border-cyan-100/[0.09] bg-black/20")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-white/48">{label}</p>
        <span className={"h-1.5 w-1.5 rounded-full " + (active ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.7)]" : "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.55)]")} />
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{value}</p>
      <p className="mt-1 text-[11px] text-white/32">{detail}</p>
    </div>
  );
}

function ModuleCard({
  href,
  icon: Icon,
  title,
  description,
  badge,
  tone = "neutral",
}: {
  href: string;
  icon: typeof CalendarDays;
  title: string;
  description: string;
  badge?: number;
  tone?: "neutral" | "cyan";
}) {
  return (
    <Link
      href={href}
      className={"group relative min-h-[150px] overflow-hidden rounded-2xl border p-5 transition duration-200 hover:-translate-y-0.5 " + (tone === "cyan" ? "border-cyan-200/15 bg-cyan-200/[0.045] hover:border-cyan-200/30 hover:bg-cyan-200/[0.075]" : "border-white/[0.075] bg-black/15 hover:border-cyan-200/18 hover:bg-cyan-200/[0.035]")}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-100/10 bg-cyan-100/[0.045] text-cyan-100/70">
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex items-center gap-2">
          {badge ? <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-[#271b00]">{badge}</span> : null}
          <ArrowUpRight className="h-4 w-4 text-white/20 transition group-hover:text-cyan-100/70" />
        </div>
      </div>
      <h3 className="mt-5 font-semibold text-white/88">{title}</h3>
      <p className="mt-1.5 text-xs leading-5 text-white/38">{description}</p>
    </Link>
  );
}

function InventoryRow({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-black/15 px-3.5 py-3">
      <span className="text-xs text-white/42">{label}</span>
      <span className={"text-xs font-semibold " + (alert ? "text-amber-200" : "text-white/72")}>{value}</span>
    </div>
  );
}

function AttentionItem({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-black/15 px-3.5 py-3 transition hover:border-cyan-200/15 hover:bg-cyan-200/[0.035]">
      <span className="text-xs text-white/48">{label}</span>
      <span className={"min-w-7 rounded-full px-2 py-1 text-center text-[10px] font-bold " + (value > 0 ? "bg-amber-300 text-[#241900]" : "bg-white/[0.06] text-white/35")}>{value}</span>
    </Link>
  );
}
