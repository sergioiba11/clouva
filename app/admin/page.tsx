"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  BellRing,
  Boxes,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Coins,
  Command,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  FileBox,
  FlaskConical,
  FolderOpen,
  Gauge,
  HardDrive,
  Landmark,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Store,
  TriangleAlert,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type ActivityItem = {
  at: string;
  type: string;
  label: string;
  detail: string;
  href: string;
};

type ControlCenterPayload = {
  generatedAt: string;
  stats: {
    ingresos: number;
    ingresosVip: number;
    ingresosServicios: number;
    ingresosMarketplace: number;
    ingresosReservas: number;
    usuariosTotales: number;
    usuariosVip: number;
    playersTotal: number;
    playersPublished: number;
    studiosTotal: number;
    studiosPublished: number;
    flowsCirculation: number;
    activeSubscriptions: number;
    mrr: number;
    cancellingSubscriptions: number;
    membershipsActive: number;
  };
  commerce: {
    gmv: number;
    commissions: number;
    paidOrders: number;
    ordersToPrepare: number;
    ordersPending: number;
    bookingsPending: number;
    productsPublished: number;
    productsPending: number;
    stockCritical: number;
  };
  attention: {
    playersUnpublished: number;
    studiosUnpublished: number;
    ordersToPrepare: number;
    bookingsPending: number;
    productsPending: number;
    stockCritical: number;
  };
  activity: ActivityItem[];
  revenue7d: Array<{
    date: string;
    vip: number;
    marketplace: number;
    services: number;
    bookings: number;
    total: number;
  }>;
};

type TreasuryPayload = {
  snapshot?: {
    totalReserveUsd: number;
    allocatedReserveUsd: number;
    freeReserveUsd: number;
    pendingBackingFlows: number;
    paymentsAwaitingReserve?: number;
    reserveDeficit: boolean;
  };
  mercadoPago?: {
    connected: boolean;
    collectionAuthorized: boolean;
  };
  reserveAccounts?: Array<{ authorized_for_flow: boolean; is_active: boolean; status: string }>;
};

type StudioSummary = {
  id: string;
  slug: string;
  name: string;
  isPublished: boolean;
  membersActive: number;
  membersPaying: number;
  activePlans: number;
};

type ReleasesPayload = {
  releases: Array<{
    id: string;
    version: string;
    build_number: number;
    is_stable: boolean;
    file_size: number | null;
    published_at: string | null;
    created_at: string;
  }>;
};

type LabPayload = {
  pages: Array<{
    id: string;
    name: string;
    slug: string;
    draft_revision: number;
    published_version: number;
    updated_at: string;
    published_at: string | null;
  }>;
};

type AssetsPayload = {
  total: number;
  warnings?: Array<{ source: string; message: string }>;
};

const money = (value: number, currency = "ARS") => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency,
  maximumFractionDigits: currency === "USD" ? 2 : 0,
}).format(Number(value) || 0);

const number = (value: number) => Number(value || 0).toLocaleString("es-AR");

function ago(iso: string | null | undefined) {
  if (!iso) return "sin datos";
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return "sin datos";
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function Panel({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`rounded-[18px] border border-white/[0.07] bg-[#090a11]/88 shadow-[0_18px_55px_rgba(0,0,0,.22)] ${className}`}>
      {children}
    </section>
  );
}

function MetricCard({ href, icon: Icon, label, value, detail, tone = "violet" }: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: "violet" | "green" | "blue" | "amber";
}) {
  const toneClass = tone === "green"
    ? "bg-emerald-400/10 text-emerald-300"
    : tone === "blue"
      ? "bg-sky-400/10 text-sky-300"
      : tone === "amber"
        ? "bg-amber-400/10 text-amber-300"
        : "bg-violet-400/10 text-violet-300";
  return (
    <Link href={href} className="group rounded-[18px] border border-white/[0.07] bg-[#0a0b13]/90 p-4 transition hover:-translate-y-px hover:border-violet-300/20 hover:bg-[#0c0d17]">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${toneClass}`}><Icon className="h-4 w-4" /></span>
        <ChevronRight className="h-4 w-4 text-white/20 transition group-hover:translate-x-0.5 group-hover:text-violet-300" />
      </div>
      <p className="mt-4 text-[9px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-1 text-[27px] font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-[11px] text-white/38">{detail}</p>
    </Link>
  );
}

function StatusRow({ label, state, detail }: { label: string; state: "online" | "warning" | "unknown"; detail: string }) {
  const dot = state === "online" ? "bg-emerald-400" : state === "warning" ? "bg-amber-400" : "bg-white/25";
  const text = state === "online" ? "text-emerald-300" : state === "warning" ? "text-amber-200" : "text-white/35";
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.05] py-2.5 last:border-0">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 text-xs text-white/64">{label}</span>
      <span className={`text-[10px] font-semibold ${text}`}>{detail}</span>
    </div>
  );
}

function RevenueChart({ rows }: { rows: ControlCenterPayload["revenue7d"] }) {
  const max = Math.max(...rows.map((row) => row.total), 1);
  const points = rows.map((row, index) => {
    const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 100;
    const y = 30 - (row.total / max) * 24;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="mt-5">
      <div className="relative h-36 overflow-hidden rounded-2xl border border-white/[0.05] bg-black/20">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:100%_25%]" />
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)] overflow-visible" aria-label="Ingresos de los últimos siete días">
          <polyline points={points} fill="none" stroke="rgba(167,139,250,.95)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
          {rows.map((row, index) => {
            const x = rows.length <= 1 ? 0 : (index / (rows.length - 1)) * 100;
            const y = 30 - (row.total / max) * 24;
            return <circle key={row.date} cx={x} cy={y} r="0.75" fill="#c4b5fd" />;
          })}
        </svg>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[9px] text-white/28">
        {rows.map((row) => <span key={row.date}>{new Date(`${row.date}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short" })}</span>)}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { role, user, session } = useAuth();
  const [data, setData] = useState<ControlCenterPayload | null>(null);
  const [treasury, setTreasury] = useState<TreasuryPayload | null>(null);
  const [studios, setStudios] = useState<StudioSummary[]>([]);
  const [releases, setReleases] = useState<ReleasesPayload["releases"]>([]);
  const [labPages, setLabPages] = useState<LabPayload["pages"]>([]);
  const [assets, setAssets] = useState<AssetsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const controlResponse = await authenticatedFetch("/api/admin/control-center", { cache: "no-store" });
      const control = await readApiJson<ControlCenterPayload>(controlResponse);
      setData(control);

      const optional = await Promise.allSettled([
        authenticatedFetch("/api/admin/flows/treasury", { cache: "no-store" }).then((response) => readApiJson<TreasuryPayload>(response)),
        authenticatedFetch("/api/admin/studios/summary", { cache: "no-store" }).then((response) => readApiJson<{ studios: StudioSummary[] }>(response)),
        authenticatedFetch("/api/admin/clouva-control/releases", { cache: "no-store" }).then((response) => readApiJson<ReleasesPayload>(response)),
        authenticatedFetch("/api/admin/clouva-lab/pages", { cache: "no-store" }).then((response) => readApiJson<LabPayload>(response)),
        authenticatedFetch("/api/admin/assets", { cache: "no-store" }).then((response) => readApiJson<AssetsPayload>(response)),
      ]);

      if (optional[0].status === "fulfilled") setTreasury(optional[0].value);
      if (optional[1].status === "fulfilled") setStudios(optional[1].value.studios ?? []);
      if (optional[2].status === "fulfilled") setReleases(optional[2].value.releases ?? []);
      if (optional[3].status === "fulfilled") setLabPages(optional[3].value.pages ?? []);
      if (optional[4].status === "fulfilled") setAssets(optional[4].value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el Centro de Control.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stats = data?.stats;
  const commerce = data?.commerce;
  const attention = data?.attention;
  const latestRelease = releases.find((release) => release.is_stable) ?? releases[0] ?? null;
  const mobileHome = labPages.find((page) => page.slug === "mobile-home") ?? labPages[0] ?? null;
  const reserveVerified = Boolean(treasury?.reserveAccounts?.some((account) => account.authorized_for_flow && account.is_active && account.status === "active"));

  const attentionItems = useMemo(() => {
    if (!attention) return [];
    return [
      { label: "Players sin publicar", value: attention.playersUnpublished, href: "/admin/clientes" },
      { label: "Estudios sin publicar", value: attention.studiosUnpublished, href: "/admin/estudios" },
      { label: "Pedidos para preparar", value: attention.ordersToPrepare, href: "/admin/marketplace" },
      { label: "Reservas pendientes", value: attention.bookingsPending, href: "/admin/reservas" },
      { label: "Productos pendientes", value: attention.productsPending, href: "/admin/marketplace" },
      { label: "Stock crítico", value: attention.stockCritical, href: "/admin/marketplace" },
      { label: "FLOW PENDING_BACKING", value: treasury?.snapshot?.pendingBackingFlows ?? 0, href: "/admin/flows/tesoreria" },
      { label: "Pagos esperando Reserva", value: treasury?.snapshot?.paymentsAwaitingReserve ?? 0, href: "/admin/flows/tesoreria" },
      { label: "Assets con warnings", value: assets?.warnings?.length ?? 0, href: "/admin/assets" },
    ];
  }, [assets?.warnings?.length, attention, treasury?.snapshot?.paymentsAwaitingReserve, treasury?.snapshot?.pendingBackingFlows]);

  const hasCriticalAttention = attentionItems.some((item) => item.value > 0) || Boolean(treasury?.snapshot?.reserveDeficit);

  if (loading && !data) {
    return (
      <div className="grid min-h-[70vh] place-items-center rounded-[22px] border border-white/[0.06] bg-[#090a11]/70 text-sm text-white/45">
        <div className="flex items-center gap-3"><RefreshCw className="h-4 w-4 animate-spin text-violet-300" /> Cargando CLOUVA Control Center...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 rounded-[20px] border border-violet-300/10 bg-[radial-gradient(circle_at_78%_0%,rgba(124,58,237,.15),transparent_34%),rgba(9,10,17,.9)] p-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/70">Centro de Control</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">CLOUVA Business OS</h1>
          <p className="mt-1 text-xs text-white/38">Usuarios · Comercio · FLOWS · Estudios · Experiencia · Infraestructura</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-emerald-300/10 bg-emerald-400/[0.045] px-3 py-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-400" /> SISTEMA OPERATIVO</div>
            <p className="mt-1 text-[9px] text-white/32">{data ? `Actualizado ${ago(data.generatedAt)}` : "Sin datos"}</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-semibold text-white/75 transition hover:bg-white/[0.07] disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
          <Link href="#acciones" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white transition hover:bg-violet-500">
            Acciones rápidas <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm text-red-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard href="#finanzas" icon={CircleDollarSign} label="Ingresos" value={stats ? money(stats.ingresos) : "…"} detail={`VIP ${stats ? money(stats.ingresosVip) : "…"}`} tone="green" />
        <MetricCard href="/admin/clientes" icon={Users} label="Usuarios" value={stats ? number(stats.usuariosTotales) : "…"} detail={`${stats?.usuariosVip ?? 0} VIP`} tone="blue" />
        <MetricCard href="/admin/clientes" icon={UserRound} label="Players" value={stats ? `${stats.playersPublished}/${stats.playersTotal}` : "…"} detail={`${pct(stats?.playersPublished ?? 0, stats?.playersTotal ?? 0)}% publicados`} />
        <MetricCard href="/admin/estudios" icon={Building2} label="Estudios" value={stats ? `${stats.studiosPublished}/${stats.studiosTotal}` : "…"} detail={`${pct(stats?.studiosPublished ?? 0, stats?.studiosTotal ?? 0)}% publicados`} />
        <MetricCard href="/admin/marketplace" icon={PackageCheck} label="Pedidos" value={commerce ? number(commerce.ordersToPrepare) : "…"} detail={`${commerce?.ordersPending ?? 0} pendientes de pago`} tone="amber" />
        <MetricCard href="/admin/flows" icon={Coins} label="FLOWS" value={stats ? number(stats.flowsCirculation) : "…"} detail={treasury?.snapshot?.reserveDeficit ? "Backing crítico" : "Backing controlado"} />
      </div>

      <div id="finanzas" className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,.8fr)]">
        <Panel className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.19em] text-white/32">Operación financiera</p>
              <div className="mt-2 flex items-end gap-3">
                <p className="text-3xl font-semibold tracking-tight">{stats ? money(stats.ingresos) : "…"}</p>
                <span className="pb-1 text-[10px] text-white/28">registrados</span>
              </div>
            </div>
            <div className="flex gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1 text-[9px] font-semibold text-white/35">
              <span className="rounded-lg bg-violet-500/20 px-3 py-1.5 text-violet-200">7D</span>
              <span className="px-3 py-1.5">30D</span>
              <span className="px-3 py-1.5">90D</span>
            </div>
          </div>

          {data?.revenue7d?.length ? <RevenueChart rows={data.revenue7d} /> : <div className="mt-5 grid h-36 place-items-center rounded-2xl border border-dashed border-white/10 text-xs text-white/30">Todavía no hay histórico para graficar.</div>}

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["CLOUVA VIP", stats?.ingresosVip ?? 0],
              ["Marketplace", stats?.ingresosMarketplace ?? 0],
              ["Servicios", stats?.ingresosServicios ?? 0],
              ["Reservas", stats?.ingresosReservas ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3">
                <p className="text-[9px] uppercase tracking-[0.13em] text-white/32">{label}</p>
                <p className="mt-1 text-lg font-semibold">{money(Number(value))}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.19em] text-white/32">FLOW / Reserva</p>
              <h2 className="mt-1 text-lg font-semibold">Tesorería</h2>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold ${treasury?.snapshot?.reserveDeficit ? "border-red-400/25 bg-red-400/10 text-red-200" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
              {treasury?.snapshot?.reserveDeficit ? "CRÍTICO" : "1:1 OK"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 text-xs">
            <div className="flex justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5"><span className="text-white/45">FLOWS en circulación</span><b>{number(stats?.flowsCirculation ?? 0)}</b></div>
            <div className="flex justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5"><span className="text-white/45">Reserva total</span><b>{money(treasury?.snapshot?.totalReserveUsd ?? 0, "USD")}</b></div>
            <div className="flex justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5"><span className="text-white/45">Reserva asignada</span><b>{money(treasury?.snapshot?.allocatedReserveUsd ?? 0, "USD")}</b></div>
            <div className="flex justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5"><span className="text-white/45">Reserva libre</span><b>{money(treasury?.snapshot?.freeReserveUsd ?? 0, "USD")}</b></div>
            <div className="flex justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5"><span className="text-white/45">PENDING_BACKING</span><b>{treasury?.snapshot?.pendingBackingFlows ?? 0}</b></div>
            <div className="flex justify-between rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2.5"><span className="text-white/45">Pagos esperando Reserva</span><b>{treasury?.snapshot?.paymentsAwaitingReserve ?? 0}</b></div>
          </div>
          <div className="mt-4 grid gap-2 text-[11px]">
            <div className="flex items-center justify-between"><span className="text-white/42">Mercado Pago rail</span><span className={treasury?.mercadoPago?.connected ? "text-emerald-300" : "text-amber-200"}>{treasury?.mercadoPago?.connected ? "Conectado" : "Revisar"}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/42">Reserva</span><span className={reserveVerified ? "text-emerald-300" : "text-amber-200"}>{reserveVerified ? "Verificada" : "Revisar"}</span></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/admin/flows/tesoreria" className="rounded-xl bg-violet-600 px-3 py-2.5 text-center text-xs font-semibold">Abrir Tesorería</Link>
            <Link href="/admin/flows/pagos-manuales" className="rounded-xl border border-white/10 px-3 py-2.5 text-center text-xs text-white/70">Registrar pago</Link>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel id="actividad" className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Actividad en vivo</h2><Activity className="h-4 w-4 text-violet-300" /></div>
          <div className="mt-3 space-y-1">
            {(data?.activity ?? []).slice(0, 8).map((item, index) => (
              <Link key={`${item.type}:${item.at}:${index}`} href={item.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.035]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-white/78">{item.label}</span><span className="mt-0.5 block truncate text-[10px] text-white/32">{item.detail}</span></span>
                <span className="text-[9px] text-white/24">{ago(item.at)}</span>
              </Link>
            ))}
            {!data?.activity?.length ? <p className="py-6 text-center text-xs text-white/30">Todavía no hay actividad registrada.</p> : null}
          </div>
        </Panel>

        <Panel id="alertas" className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Requiere atención</h2><BellRing className="h-4 w-4 text-amber-300" /></div>
          <div className="mt-3 space-y-1.5">
            {attentionItems.map((item) => (
              <Link key={item.label} href={item.href} className="flex items-center gap-3 rounded-xl border border-white/[0.045] bg-black/15 px-3 py-2.5 transition hover:border-violet-300/15">
                <span className={`grid h-6 w-6 place-items-center rounded-lg text-[10px] font-bold ${item.value > 0 ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-300"}`}>{item.value > 0 ? item.value : <Check className="h-3.5 w-3.5" />}</span>
                <span className="min-w-0 flex-1 text-[11px] text-white/62">{item.label}</span>
                <span className="text-[9px] text-violet-300/65">Revisar</span>
              </Link>
            ))}
          </div>
          <div className={`mt-3 rounded-xl border px-3 py-2.5 text-[10px] ${hasCriticalAttention ? "border-amber-300/15 bg-amber-300/[0.045] text-amber-100" : "border-emerald-300/15 bg-emerald-300/[0.045] text-emerald-100"}`}>
            {hasCriticalAttention ? "Hay elementos operativos para revisar." : "Todo operativo · no hay pendientes detectados."}
          </div>
        </Panel>

        <Panel id="sistema" className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Estado del sistema</h2><Database className="h-4 w-4 text-emerald-300" /></div>
          <div className="mt-3">
            <StatusRow label="Supabase · datos Admin" state={data ? "online" : "warning"} detail={data ? "Operativo" : "Revisar"} />
            <StatusRow label="Mercado Pago" state={treasury?.mercadoPago?.connected ? "online" : "warning"} detail={treasury?.mercadoPago?.connected ? "Conectado" : "Revisar"} />
            <StatusRow label="Reserva FLOW" state={reserveVerified ? "online" : "warning"} detail={reserveVerified ? "Verificada" : "Revisar"} />
            <StatusRow label="CLOUVA Control" state={latestRelease ? "online" : "unknown"} detail={latestRelease ? `v${latestRelease.version}` : "Sin release"} />
            <StatusRow label="CLOUVA Lab" state={mobileHome ? "online" : "unknown"} detail={mobileHome ? `v${mobileHome.published_version}` : "Sin datos"} />
            <StatusRow label="Asset Explorer" state={assets ? "online" : "unknown"} detail={assets ? `${assets.total} assets` : "No medido"} />
            <StatusRow label="Workers / infraestructura" state="unknown" detail="No medido" />
          </div>
          <p className="mt-3 text-[9px] leading-4 text-white/24">No se muestran latencias inventadas. Este panel solo afirma estados que el Admin pudo verificar.</p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel className="p-5 xl:col-span-1">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Comunidad CLOUVA</h2><Users className="h-4 w-4 text-sky-300" /></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["Usuarios", stats?.usuariosTotales ?? 0],
              ["VIP", stats?.usuariosVip ?? 0],
              ["Players", stats?.playersTotal ?? 0],
              ["Publicados", stats?.playersPublished ?? 0],
              ["Estudios", stats?.studiosTotal ?? 0],
              ["Miembros activos", stats?.membershipsActive ?? 0],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-xl font-semibold">{number(Number(value))}</p><p className="mt-1 text-[9px] text-white/30">{label}</p></div>)}
          </div>
          <Link href="/admin/clientes" className="mt-3 flex items-center justify-between rounded-xl border border-violet-300/10 bg-violet-400/[0.04] px-3 py-2.5 text-xs text-violet-200">Administrar usuarios <ChevronRight className="h-4 w-4" /></Link>
        </Panel>

        <Panel className="p-5 xl:col-span-1">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Comercio</h2><Store className="h-4 w-4 text-violet-300" /></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-lg font-semibold">{money(commerce?.gmv ?? 0)}</p><p className="mt-1 text-[9px] text-white/30">GMV Marketplace</p></div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-lg font-semibold">{money(commerce?.commissions ?? 0)}</p><p className="mt-1 text-[9px] text-white/30">Comisiones CLOUVA</p></div>
          </div>
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex justify-between"><span className="text-white/40">Pedidos pagos</span><b>{commerce?.paidOrders ?? 0}</b></div>
            <div className="flex justify-between"><span className="text-white/40">Para preparar</span><b>{commerce?.ordersToPrepare ?? 0}</b></div>
            <div className="flex justify-between"><span className="text-white/40">Productos publicados</span><b>{commerce?.productsPublished ?? 0}</b></div>
            <div className="flex justify-between"><span className="text-white/40">Productos pendientes</span><b>{commerce?.productsPending ?? 0}</b></div>
            <div className="flex justify-between"><span className="text-white/40">Stock crítico</span><b>{commerce?.stockCritical ?? 0}</b></div>
          </div>
          <Link href="/admin/marketplace" className="mt-3 flex items-center justify-between rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/65">Abrir Marketplace <ChevronRight className="h-4 w-4" /></Link>
        </Panel>

        <Panel className="p-5 xl:col-span-2">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Studios</h2><Building2 className="h-4 w-4 text-violet-300" /></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {studios.slice(0, 4).map((studio) => (
              <div key={studio.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold">{studio.name}</p><span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${studio.isPublished ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[0.05] text-white/35"}`}>{studio.isPublished ? "Publicado" : "Borrador"}</span></div>
                <p className="mt-2 text-[10px] text-white/36">{studio.membersActive} miembros · {studio.membersPaying} pagos · {studio.activePlans} planes</p>
                <div className="mt-3 flex gap-2"><Link href={`/studio-dashboard/${studio.id}`} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[10px] font-semibold">Administrar</Link><Link href={`/studios/${studio.slug}`} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] text-white/55">Ver página</Link></div>
              </div>
            ))}
            {!studios.length ? <p className="col-span-2 py-8 text-center text-xs text-white/30">Todavía no hay Estudios disponibles en el resumen.</p> : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2"><Link href="/admin/estudios" className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/60">Todos los Estudios</Link><Link href="/admin/estudios/membresias" className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/60">Membresías</Link><Link href="/admin/estudios/studio-os" className="rounded-lg border border-white/10 px-3 py-2 text-[10px] text-white/60">Studio OS</Link></div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_.8fr_.8fr]">
        <Panel className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Experiencia CLOUVA</h2><FlaskConical className="h-4 w-4 text-violet-300" /></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/admin/clouva-lab" className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-violet-300/20"><FlaskConical className="h-5 w-5 text-violet-300" /><p className="mt-3 text-xs font-semibold">CLOUVA Lab</p><p className="mt-1 text-[9px] text-white/30">{mobileHome ? `Publicado v${mobileHome.published_version}` : "Editor interno"}</p></Link>
            <Link href="/admin/clouva-control" className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-violet-300/20"><Smartphone className="h-5 w-5 text-sky-300" /><p className="mt-3 text-xs font-semibold">CLOUVA Control</p><p className="mt-1 text-[9px] text-white/30">{latestRelease ? `v${latestRelease.version} · build ${latestRelease.build_number}` : "Sin release estable"}</p></Link>
            <Link href="/admin/assets" className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-violet-300/20"><FolderOpen className="h-5 w-5 text-emerald-300" /><p className="mt-3 text-xs font-semibold">Assets</p><p className="mt-1 text-[9px] text-white/30">{assets ? `${assets.total} archivos · ${assets.warnings?.length ?? 0} warnings` : "Supabase · GCS · GitHub"}</p></Link>
            <Link href="/admin/avatar-oficial" className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-violet-300/20"><ScanFace className="h-5 w-5 text-fuchsia-300" /><p className="mt-3 text-xs font-semibold">Avatar Oficial</p><p className="mt-1 text-[9px] text-white/30">Administrar GLB base</p></Link>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Suscripciones</h2><CreditCard className="h-4 w-4 text-violet-300" /></div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-xl font-semibold">{stats?.activeSubscriptions ?? 0}</p><p className="text-[9px] text-white/30">Activas</p></div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-xl font-semibold">{money(stats?.mrr ?? 0)}</p><p className="text-[9px] text-white/30">MRR estimado</p></div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-xl font-semibold">{stats?.cancellingSubscriptions ?? 0}</p><p className="text-[9px] text-white/30">Cancelando</p></div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"><p className="text-xl font-semibold">{stats?.usuariosVip ?? 0}</p><p className="text-[9px] text-white/30">VIP activos</p></div>
          </div>
          <Link href="/admin/suscripciones" className="mt-3 flex items-center justify-between rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/60">Administrar <ChevronRight className="h-4 w-4" /></Link>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Seguridad</h2><ShieldCheck className="h-4 w-4 text-emerald-300" /></div>
          <div className="mt-4 space-y-2 text-[11px]">
            <div className="flex justify-between"><span className="text-white/38">Admin</span><span className="text-emerald-300">Verificado</span></div>
            <div className="flex justify-between"><span className="text-white/38">Auth</span><span className={session ? "text-emerald-300" : "text-amber-200"}>{session ? "Activo" : "Revisar"}</span></div>
            <div className="flex justify-between"><span className="text-white/38">Rol</span><span className="text-white/65">{role}</span></div>
            <div className="flex justify-between"><span className="text-white/38">Sesión</span><span className="text-emerald-300">Protegida</span></div>
            <div className="flex justify-between"><span className="text-white/38">Último acceso</span><span className="text-white/50">{ago(user?.last_sign_in_at)}</span></div>
          </div>
          <p className="mt-4 text-[9px] leading-4 text-white/24">No se exponen tokens, service keys ni secretos desde este panel.</p>
        </Panel>
      </div>

      <Panel id="acciones" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Acciones rápidas</h2><p className="mt-1 text-[10px] text-white/30">Ctrl + K abre la búsqueda administrativa y el Command Center global.</p></div>
          <Command className="h-5 w-5 text-violet-300" />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[
            ["Crear producto", "/admin/productos/nuevo", PackagePlus],
            ["Gestionar usuarios", "/admin/clientes", Users],
            ["Abrir Assets", "/admin/assets", FolderOpen],
            ["Registrar pago", "/admin/flows/pagos-manuales", WalletCards],
            ["Abrir Tesorería", "/admin/flows/tesoreria", Landmark],
            ["Administrar Estudios", "/admin/estudios", Building2],
            ["CLOUVA Lab", "/admin/clouva-lab", FlaskConical],
            ["CLOUVA Control", "/admin/clouva-control", Smartphone],
            ["Marketplace", "/admin/marketplace", Store],
            ["Reservas", "/admin/reservas", CalendarClock],
            ["Studio OS", "/admin/estudios/studio-os", Gauge],
            ["Compatibilidad", "/admin/marketplace/compatibilidad", FileBox],
          ].map(([label, href, Icon]) => {
            const QuickIcon = Icon as React.ComponentType<{ className?: string }>;
            return <Link key={String(label)} href={String(href)} className="flex min-h-12 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-[11px] font-semibold text-white/65 transition hover:border-violet-300/20 hover:bg-violet-400/[0.045] hover:text-white"><QuickIcon className="h-4 w-4 text-violet-300" />{String(label)}</Link>;
          })}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="p-5">
          <div className="flex items-center gap-2"><Boxes className="h-4 w-4 text-amber-300" /><h2 className="text-sm font-semibold">Módulos aún no configurados</h2></div>
          <div className="mt-3 space-y-2 text-[11px]">
            <Link href="/admin/stock" className="flex justify-between rounded-xl border border-white/[0.05] px-3 py-2.5"><span>Stock clásico</span><span className="text-amber-200">NO CONFIGURADO</span></Link>
            <Link href="/admin/envios" className="flex justify-between rounded-xl border border-white/[0.05] px-3 py-2.5"><span>Envíos clásicos</span><span className="text-amber-200">NO CONFIGURADO</span></Link>
            <Link href="/admin/cupones" className="flex justify-between rounded-xl border border-white/[0.05] px-3 py-2.5"><span>Cupones</span><span className="text-amber-200">NO CONFIGURADO</span></Link>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-emerald-300" /><h2 className="text-sm font-semibold">Assets</h2></div>
          <p className="mt-4 text-3xl font-semibold">{assets ? number(assets.total) : "—"}</p>
          <p className="mt-1 text-[10px] text-white/30">archivos entre Supabase · Google Cloud · GitHub/public</p>
          <p className="mt-3 text-[10px] text-white/42">Warnings: <span className={assets?.warnings?.length ? "text-amber-200" : "text-emerald-300"}>{assets?.warnings?.length ?? 0}</span></p>
          <Link href="/admin/assets" className="mt-3 flex items-center justify-between rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/60">Abrir Asset Explorer <ExternalLink className="h-3.5 w-3.5" /></Link>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-center gap-2"><Command className="h-4 w-4 text-violet-300" /><h2 className="text-sm font-semibold">Command Center</h2></div>
          <p className="mt-3 text-xs leading-5 text-white/42">Usá <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-violet-200">Ctrl + K</kbd> desde cualquier pantalla Admin.</p>
          <p className="mt-2 text-[10px] leading-5 text-white/30">Busca usuarios, Players, Estudios y productos, además de acciones directas como Tesorería, CLOUVA Lab, APK, Avatar Oficial y configuración.</p>
        </Panel>
      </div>
    </div>
  );
}
