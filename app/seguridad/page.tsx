"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Cable,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Cloud,
  ExternalLink,
  Fingerprint,
  Globe2,
  KeyRound,
  Laptop,
  Loader2,
  Network,
  Radar,
  RefreshCw,
  Router,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin } from "@/lib/auth";

type HeaderCheck = {
  key: string;
  label: string;
  present: boolean;
  value: string | null;
};

type PublicAsset = {
  id: string;
  label: string;
  host: string;
  kind: "web" | "game";
  ips: string[];
  dnsOk: boolean;
  reachable: boolean;
  latencyMs: number | null;
  httpStatus?: number | null;
  tls?: {
    valid: boolean;
    protocol: string | null;
    issuer: string | null;
    validTo: string | null;
    daysRemaining: number | null;
  } | null;
  headers?: HeaderCheck[];
  exposedPorts: Array<{ port: number; service: string; reachable: boolean; latencyMs: number | null }>;
  error?: string | null;
};

type SecurityOverview = {
  ok: boolean;
  checkedAt: string;
  refreshMs: number;
  assets: PublicAsset[];
  error?: string;
};

type Port = {
  port: number;
  protocol?: string;
  state?: string;
  service?: string | null;
  product?: string | null;
  version?: string | null;
};

type Device = {
  ip: string;
  hostname?: string | null;
  vendor?: string | null;
  ports?: Port[];
};

type Connection = {
  localPort?: number;
  remoteAddress: string;
  remotePort?: number;
  process?: string | null;
  hostname?: string | null;
};

type NetworkSnapshot = {
  scannedAt?: string;
  scanner?: string;
  local?: {
    hostname?: string | null;
    interface?: string | null;
    ip?: string | null;
    subnet?: string | null;
    gateway?: string | null;
  };
  devices?: Device[];
  connections?: Connection[];
};

type NetworkPayload = {
  ok?: boolean;
  result?: NetworkSnapshot;
  error?: string;
};

type Notice = {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  source: string;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function statusDot(ok: boolean) {
  return ok
    ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]"
    : "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,.75)]";
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function SecurityCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/25 p-4 backdrop-blur">
      <div className="flex items-center gap-2 text-cyan-100/65">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-[.16em]">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-black tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs leading-relaxed text-white/38">{detail}</div>
    </div>
  );
}

function SecurityNode({
  icon,
  title,
  subtitle,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative min-w-[150px] rounded-2xl border px-4 py-3 text-center",
        active
          ? "border-cyan-300/35 bg-cyan-300/[.08] shadow-[0_0_32px_rgba(34,211,238,.09)]"
          : "border-white/10 bg-black/30",
      )}
    >
      <span className={cn("mx-auto grid h-9 w-9 place-items-center rounded-xl border", active ? "border-cyan-300/25 bg-cyan-300/[.08] text-cyan-50" : "border-white/10 bg-white/[.035] text-white/55")}>
        {icon}
      </span>
      <div className="mt-2 text-xs font-black uppercase tracking-[.1em] text-white">{title}</div>
      <div className="mt-1 truncate font-mono text-[9px] text-white/35">{subtitle}</div>
    </div>
  );
}

export default function SecurityPage() {
  const { user, session, role, loading, hydrationReady, profileReady } = useAuth();
  const router = useRouter();
  const isAdmin = canAccessAdmin(role);

  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [network, setNetwork] = useState<NetworkSnapshot | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !hydrationReady || !profileReady) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) router.replace("/");
  }, [hydrationReady, isAdmin, loading, profileReady, router, user]);

  const loadPublic = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const response = await fetch("/api/security/overview", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as SecurityOverview;
      if (!response.ok) throw new Error(payload.error || "No se pudo revisar la superficie pública.");
      setOverview(payload);
      setPublicError(null);
    } catch (error) {
      setPublicError(error instanceof Error ? error.message : "No se pudo revisar la superficie pública.");
    }
  }, [session?.access_token]);

  const loadNetwork = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const response = await fetch("/api/network/scan", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "snapshot" }),
      });
      const payload = (await response.json().catch(() => ({}))) as NetworkPayload;
      if (!response.ok) throw new Error(payload.error || "El sensor local no respondió.");
      setNetwork(payload.result ?? null);
      setNetworkError(null);
    } catch (error) {
      setNetworkError(error instanceof Error ? error.message : "El sensor local no respondió.");
    }
  }, [session?.access_token]);

  const refreshAll = useCallback(async () => {
    setBusy(true);
    await Promise.all([loadPublic(), loadNetwork()]);
    setBusy(false);
  }, [loadNetwork, loadPublic]);

  useEffect(() => {
    if (!isAdmin || !session?.access_token) return;
    void refreshAll();
    const timer = window.setInterval(() => {
      void Promise.all([loadPublic(), loadNetwork()]);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [isAdmin, loadNetwork, loadPublic, refreshAll, session?.access_token]);

  const assets = overview?.assets ?? [];
  const devices = network?.devices ?? [];
  const connections = network?.connections ?? [];

  const publicPorts = useMemo(
    () => assets.flatMap((asset) => asset.exposedPorts.filter((port) => port.reachable).map((port) => ({
      owner: asset.label,
      host: asset.host,
      port: port.port,
      service: port.service,
      scope: "Internet" as const,
    }))),
    [assets],
  );

  const localPorts = useMemo(
    () => devices.flatMap((device) => (device.ports ?? []).map((port) => ({
      owner: device.hostname || device.vendor || device.ip,
      host: device.ip,
      port: port.port,
      service: port.service || "Servicio",
      scope: "LAN" as const,
    }))),
    [devices],
  );

  const notices = useMemo<Notice[]>(() => {
    const items: Notice[] = [];

    for (const asset of assets) {
      if (!asset.dnsOk) {
        items.push({ severity: "critical", title: `${asset.label}: DNS no resuelve`, detail: asset.host, source: "Internet" });
      } else if (!asset.reachable) {
        items.push({ severity: "warning", title: `${asset.label}: servicio no alcanzable`, detail: asset.host, source: "Internet" });
      }

      if (asset.kind === "web") {
        if (asset.tls && !asset.tls.valid) {
          items.push({ severity: "critical", title: "TLS no válido", detail: asset.host, source: "TLS" });
        }
        if (asset.tls?.daysRemaining !== null && asset.tls?.daysRemaining !== undefined && asset.tls.daysRemaining < 14) {
          items.push({ severity: "warning", title: "Certificado próximo a vencer", detail: `${asset.tls.daysRemaining} días restantes`, source: "TLS" });
        }
        for (const header of asset.headers ?? []) {
          if (!header.present) {
            items.push({ severity: "info", title: `Header no observado: ${header.label}`, detail: asset.host, source: "HTTP" });
          }
        }
      }
    }

    return items;
  }, [assets]);

  const criticalCount = notices.filter((notice) => notice.severity === "critical").length;
  const warningCount = notices.filter((notice) => notice.severity === "warning").length;
  const missingHeaders = assets.flatMap((asset) => asset.headers ?? []).filter((header) => !header.present).length;
  const tlsDays = assets.find((asset) => asset.kind === "web")?.tls?.daysRemaining ?? null;
  const latestCheck = overview?.checkedAt || network?.scannedAt || null;

  if (loading || !hydrationReady || !profileReady || !user || !isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#03070b] text-white">
        <div className="flex items-center gap-3 text-sm font-bold text-white/55">
          <Loader2 className="h-5 w-5 animate-spin" /> Abriendo Seguridad...
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#03070b] text-white">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(circle at 50% -10%, rgba(34,211,238,.14), transparent 34%), radial-gradient(circle at 8% 38%, rgba(124,58,237,.11), transparent 30%), radial-gradient(circle at 92% 48%, rgba(16,185,129,.07), transparent 26%), linear-gradient(180deg,#03070b,#05030a)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[.10]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(103,232,249,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,.22) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />

      <div className="relative mx-auto w-full max-w-[1720px] px-3 pb-16 pt-3 sm:px-5 sm:pt-5">
        <header className="sticky top-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-cyan-300/15 bg-[#050a10]/92 px-3 py-3 shadow-[0_20px_70px_rgba(0,0,0,.38)] backdrop-blur-2xl sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-white/70 transition hover:border-cyan-300/35 hover:text-white"
              aria-label="Volver"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/[.08] text-cyan-50 shadow-[0_0_30px_rgba(34,211,238,.1)]">
              <Shield className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black uppercase tracking-[.13em] sm:text-base">CLOUVA SECURITY</div>
              <div className="truncate text-[10px] font-bold uppercase tracking-[.18em] text-cyan-100/40">
                Mi seguridad · red · internet · cloud
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-400/[.06] px-3 py-2 text-[11px] font-black uppercase tracking-[.1em] text-emerald-100 sm:inline-flex">
              <Activity className="h-4 w-4" /> En vivo · 10s
            </span>
            <Link
              href="/red"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 text-xs font-black uppercase tracking-[.08em] text-white/70 transition hover:border-cyan-300/30 hover:text-white"
            >
              <Network className="h-4 w-4" /> Red
            </Link>
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={busy}
              className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-50 disabled:opacity-40"
              aria-label="Actualizar seguridad"
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            </button>
          </div>
        </header>

        <section className="mt-4 overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(8,145,178,.12),rgba(5,10,16,.88)_46%,rgba(124,58,237,.09))] p-5 shadow-[0_30px_90px_rgba(0,0,0,.34)] sm:p-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/[.06] px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-cyan-50">
                <Radar className="h-3.5 w-3.5" /> Tu mundo tecnológico
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-[-.05em] sm:text-5xl">Ver qué está pasando. Entenderlo. Cubrirlo.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/48 sm:text-base">
                Esta pantalla cruza lo que CLOUVA ve desde Internet con lo que tu Workspace ve desde adentro de tu red. Cada alerta sale de una observación concreta.
              </p>
            </div>

            <div className="min-w-[250px] rounded-[24px] border border-white/10 bg-black/30 p-4">
              <div className="text-[10px] font-black uppercase tracking-[.16em] text-white/35">Estado observado</div>
              <div className="mt-2 flex items-center gap-3">
                {criticalCount > 0 ? (
                  <ShieldAlert className="h-8 w-8 text-rose-300" />
                ) : warningCount > 0 ? (
                  <TriangleAlert className="h-8 w-8 text-amber-200" />
                ) : (
                  <ShieldCheck className="h-8 w-8 text-emerald-300" />
                )}
                <div>
                  <div className="text-xl font-black text-white">
                    {criticalCount > 0 ? `${criticalCount} alerta crítica${criticalCount === 1 ? "" : "s"}` : warningCount > 0 ? `${warningCount} observación${warningCount === 1 ? "" : "es"}` : "Sin alertas críticas"}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-white/30">última lectura {formatTime(latestCheck)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SecurityCard icon={<Globe2 className="h-5 w-5" />} label="Activos públicos" value={String(assets.length)} detail="Servicios CLOUVA observados desde Internet." />
          <SecurityCard icon={<Server className="h-5 w-5" />} label="Dispositivos LAN" value={networkError ? "—" : String(devices.length)} detail={networkError ? "Sensor local pendiente." : "Equipos detectados dentro de tu red."} />
          <SecurityCard icon={<Cable className="h-5 w-5" />} label="Puertas visibles" value={String(publicPorts.length + localPorts.length)} detail="Puertos observados entre Internet y tu LAN." />
          <SecurityCard icon={<KeyRound className="h-5 w-5" />} label="TLS" value={tlsDays === null ? "—" : `${tlsDays}d`} detail="Días restantes del certificado web observado." />
          <SecurityCard icon={<ShieldCheck className="h-5 w-5" />} label="Headers" value={missingHeaders ? `${missingHeaders} faltan` : assets.length ? "OK" : "—"} detail="Controles HTTP observados en CLOUVA Web." />
        </section>

        <section className="mt-4 rounded-[28px] border border-white/10 bg-black/25 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/40">Mapa general</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">YO → mi red → borde → Internet → mi cloud</h2>
            </div>
            <Link href="/red" className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[.08em] text-cyan-100/65 hover:text-cyan-50">
              Abrir mapa de red <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="overflow-x-auto pb-2">
            <div className="flex min-w-[930px] items-center justify-between gap-3">
              <SecurityNode icon={<Fingerprint className="h-5 w-5" />} title="YO" subtitle="identidad / sesión" active />
              <ChevronRight className="h-5 w-5 shrink-0 text-cyan-200/20" />
              <SecurityNode icon={<Laptop className="h-5 w-5" />} title="MI PC" subtitle={network?.local?.hostname || "Workspace"} active={!networkError} />
              <ChevronRight className="h-5 w-5 shrink-0 text-cyan-200/20" />
              <SecurityNode icon={<Wifi className="h-5 w-5" />} title="MI RED" subtitle={network?.local?.subnet || "LAN / Wi-Fi"} active={!networkError} />
              <ChevronRight className="h-5 w-5 shrink-0 text-cyan-200/20" />
              <SecurityNode icon={<Router className="h-5 w-5" />} title="BORDE" subtitle={network?.local?.gateway || "router / firewall"} active={!networkError} />
              <ChevronRight className="h-5 w-5 shrink-0 text-cyan-200/20" />
              <SecurityNode icon={<Globe2 className="h-5 w-5" />} title="INTERNET" subtitle="DNS / TLS / HTTPS" active={assets.length > 0} />
              <ChevronRight className="h-5 w-5 shrink-0 text-cyan-200/20" />
              <SecurityNode icon={<Cloud className="h-5 w-5" />} title="MI CLOUD" subtitle="CLOUVA / Ratcraft" active={assets.length > 0} />
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-[28px] border border-white/10 bg-black/25 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/40">Superficie pública</div>
                <h2 className="mt-1 text-xl font-black">Lo tuyo visto desde Internet</h2>
              </div>
              <Globe2 className="h-6 w-6 text-cyan-100/45" />
            </div>

            {publicError ? (
              <div className="rounded-2xl border border-rose-300/18 bg-rose-400/[.07] p-4 text-sm text-rose-50">{publicError}</div>
            ) : !overview ? (
              <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-white/40"><Loader2 className="h-5 w-5 animate-spin" /> Leyendo Internet...</div>
            ) : (
              <div className="space-y-3">
                {assets.map((asset) => (
                  <div key={asset.id} className="rounded-[22px] border border-white/9 bg-black/30 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-cyan-100">
                          {asset.kind === "web" ? <Globe2 className="h-5 w-5" /> : <Server className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("h-2.5 w-2.5 rounded-full", statusDot(asset.reachable))} />
                            <div className="truncate text-sm font-black">{asset.label}</div>
                          </div>
                          <div className="mt-1 truncate font-mono text-[11px] text-white/42">{asset.host}</div>
                          <div className="mt-1 truncate font-mono text-[10px] text-white/25">{asset.ips.join(" · ") || "DNS sin respuesta"}</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {asset.httpStatus ? <span className="rounded-lg border border-white/10 bg-white/[.035] px-2 py-1 font-mono text-[10px] font-bold text-white/55">HTTP {asset.httpStatus}</span> : null}
                        {asset.latencyMs !== null ? <span className="rounded-lg border border-cyan-300/15 bg-cyan-300/[.05] px-2 py-1 font-mono text-[10px] font-bold text-cyan-100/65">{asset.latencyMs} ms</span> : null}
                        {asset.tls?.protocol ? <span className="rounded-lg border border-emerald-300/15 bg-emerald-300/[.05] px-2 py-1 font-mono text-[10px] font-bold text-emerald-100/65">{asset.tls.protocol}</span> : null}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {asset.exposedPorts.map((port) => (
                        <span key={port.port} className={cn("rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-black", port.reachable ? "border-cyan-300/20 bg-cyan-300/[.07] text-cyan-50" : "border-white/8 bg-white/[.025] text-white/25")}>
                          {port.port} · {port.service}
                        </span>
                      ))}
                    </div>

                    {asset.headers?.length ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {asset.headers.map((header) => (
                          <div key={header.key} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold", header.present ? "border-emerald-300/12 bg-emerald-300/[.04] text-emerald-100/65" : "border-amber-300/12 bg-amber-300/[.04] text-amber-100/65")}>
                            {header.present ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <CircleDot className="h-3.5 w-3.5 shrink-0" />}
                            {header.label}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-black/25 p-4 sm:p-5">
            <div className="mb-4">
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/40">Alertas y observaciones</div>
              <h2 className="mt-1 text-xl font-black">Qué merece atención</h2>
            </div>

            <div className="space-y-2">
              {notices.length ? notices.slice(0, 12).map((notice, index) => (
                <div key={`${notice.title}:${index}`} className={cn(
                  "rounded-2xl border p-3",
                  notice.severity === "critical"
                    ? "border-rose-300/18 bg-rose-400/[.07]"
                    : notice.severity === "warning"
                      ? "border-amber-300/18 bg-amber-300/[.06]"
                      : "border-white/9 bg-white/[.025]",
                )}>
                  <div className="flex items-start gap-3">
                    {notice.severity === "critical" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" /> : notice.severity === "warning" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /> : <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-cyan-100/55" />}
                    <div className="min-w-0">
                      <div className="text-sm font-black text-white">{notice.title}</div>
                      <div className="mt-1 text-xs text-white/42">{notice.detail}</div>
                      <div className="mt-1 text-[9px] font-black uppercase tracking-[.14em] text-white/25">{notice.source}</div>
                    </div>
                  </div>
                </div>
              )) : overview ? (
                <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[.05] p-4">
                  <div className="flex items-center gap-3 text-emerald-50">
                    <ShieldCheck className="h-5 w-5" />
                    <div className="font-black">No hay alertas críticas en las comprobaciones actuales.</div>
                  </div>
                </div>
              ) : null}

              {networkError ? (
                <div className="rounded-2xl border border-violet-300/14 bg-violet-300/[.05] p-3">
                  <div className="flex items-start gap-3">
                    <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-violet-100/70" />
                    <div>
                      <div className="text-sm font-black">Sensor local sin datos</div>
                      <div className="mt-1 text-xs leading-relaxed text-white/38">{networkError}</div>
                      <Link href="/red" className="mt-2 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[.1em] text-violet-100/65">
                        Abrir Red <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-black/25 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/40">Mis puertas</div>
                <h2 className="mt-1 text-xl font-black">Puertos que CLOUVA puede ver</h2>
              </div>
              <Cable className="h-6 w-6 text-cyan-100/45" />
            </div>

            <div className="space-y-2">
              {[...publicPorts, ...localPorts].length ? [...publicPorts, ...localPorts].slice(0, 18).map((item, index) => (
                <div key={`${item.scope}:${item.host}:${item.port}:${index}`} className="flex items-center gap-3 rounded-2xl border border-white/9 bg-black/30 p-3">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl border font-mono text-xs font-black", item.scope === "Internet" ? "border-violet-300/18 bg-violet-300/[.06] text-violet-100" : "border-cyan-300/18 bg-cyan-300/[.06] text-cyan-100")}>
                    {item.port}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black">{item.service}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-white/35">{item.owner} · {item.host}</div>
                  </div>
                  <span className="rounded-full border border-white/10 px-2 py-1 text-[9px] font-black uppercase tracking-[.1em] text-white/38">{item.scope}</span>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/35">Todavía no hay puertos observados.</div>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-black/25 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/40">Aprender con tu infraestructura</div>
                <h2 className="mt-1 text-xl font-black">Qué significa cada cosa</h2>
              </div>
              <BookOpen className="h-6 w-6 text-cyan-100/45" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["443 / HTTPS", "La puerta web cifrada. CLOUVA la observa desde Internet junto con el certificado TLS."],
                ["25565 / Minecraft", "Puerto habitual de Minecraft Java. En Ratcraft es una puerta pública intencional mientras el server está accesible."],
                ["TLS", "Es el cifrado y la identidad del sitio HTTPS. Acá ves protocolo, validez y vencimiento del certificado."],
                ["Headers HTTP", "Reglas que el navegador recibe para limitar comportamientos peligrosos y endurecer la web."],
                ["LAN", "Tu red privada. Ahí viven tu PC, celular, router y demás equipos antes de salir a Internet."],
                ["Conexión saliente", "Un proceso de tu PC hablando con una IP o servicio remoto. /red te muestra el recorrido local."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-white/9 bg-black/30 p-4">
                  <div className="text-sm font-black text-white">{title}</div>
                  <div className="mt-2 text-xs leading-relaxed text-white/42">{body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-[28px] border border-cyan-300/12 bg-cyan-300/[.035] p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/40">Siguiente capa</div>
              <h2 className="mt-1 text-xl font-black">Identidades + Cloud + eventos</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/42">
                La arquitectura ya separa sensores: Internet desde CLOUVA Cloud y red local desde Workspace. Esto deja preparado sumar sesiones, 2FA, GitHub, Cloudflare, Supabase y Google Cloud como fuentes de seguridad sin mezclar datos inventados con observaciones reales.
              </p>
            </div>
            <Link href="/red" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-300/22 bg-cyan-300/[.08] px-4 text-xs font-black uppercase tracking-[.08em] text-cyan-50">
              Ver mi red <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
