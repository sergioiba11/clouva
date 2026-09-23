"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Cable,
  CircleDot,
  Globe2,
  Laptop,
  Loader2,
  Network,
  RefreshCw,
  Route,
  Router,
  ScanLine,
  Server,
  Shield,
  ShieldCheck,
  Waypoints,
  Wifi,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin } from "@/lib/auth";

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
  mac?: string | null;
  vendor?: string | null;
  latencyMs?: number | null;
  status?: string | null;
  ports?: Port[];
};

type Connection = {
  protocol?: string;
  localAddress?: string;
  localPort?: number;
  remoteAddress: string;
  remotePort?: number;
  state?: string | null;
  process?: string | null;
  pid?: number | null;
  hostname?: string | null;
};

type Hop = {
  hop: number;
  address?: string | null;
  hostname?: string | null;
  latencyMs?: number | null;
};

type Snapshot = {
  scannedAt?: string;
  scanner?: string;
  local?: {
    hostname?: string | null;
    interface?: string | null;
    ip?: string | null;
    mac?: string | null;
    subnet?: string | null;
    gateway?: string | null;
  };
  gateway?: Device | null;
  devices?: Device[];
  connections?: Connection[];
  hops?: Hop[];
  target?: string;
};

type ApiPayload = {
  ok?: boolean;
  action?: string;
  result?: Snapshot | Device | { device?: Device; hops?: Hop[]; target?: string };
  error?: string;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function titleForDevice(device: Device) {
  return device.hostname || device.vendor || device.ip;
}

function mergeDevice(devices: Device[], incoming: Device) {
  const index = devices.findIndex((device) => device.ip === incoming.ip);
  if (index < 0) return [...devices, incoming];
  const next = [...devices];
  next[index] = { ...next[index], ...incoming, ports: incoming.ports ?? next[index].ports };
  return next;
}

function PortPills({ ports, compact = false }: { ports?: Port[]; compact?: boolean }) {
  if (!ports?.length) {
    return <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-white/28">sin puertas leídas</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ports.slice(0, compact ? 5 : 12).map((port) => (
        <span
          key={`${port.protocol ?? "tcp"}:${port.port}`}
          title={[port.service, port.product, port.version].filter(Boolean).join(" · ")}
          className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.07] px-2 py-1 font-mono text-[10px] font-bold text-cyan-100"
        >
          {port.port}/{port.protocol ?? "tcp"}{port.service ? ` · ${port.service}` : ""}
        </span>
      ))}
      {ports.length > (compact ? 5 : 12) ? (
        <span className="rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-[10px] font-bold text-white/45">
          +{ports.length - (compact ? 5 : 12)}
        </span>
      ) : null}
    </div>
  );
}

function DeviceCard({
  device,
  selected,
  busy,
  onInspect,
}: {
  device: Device;
  selected: boolean;
  busy: boolean;
  onInspect: (device: Device) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInspect(device)}
      disabled={busy}
      className={cn(
        "group w-full rounded-2xl border p-3 text-left transition",
        selected
          ? "border-cyan-300/45 bg-cyan-300/[.09] shadow-[0_0_30px_rgba(34,211,238,.08)]"
          : "border-white/10 bg-black/25 hover:border-cyan-300/25 hover:bg-cyan-300/[.05]",
        busy && "cursor-wait",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-cyan-100">
          <Server className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-white">{titleForDevice(device)}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-white/45">{device.ip}</div>
          <div className="mt-2"><PortPills ports={device.ports} compact /></div>
        </div>
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.7)]" />
      </div>
    </button>
  );
}

export default function NetworkMapPage() {
  const { user, session, role, loading, hydrationReady, profileReady } = useAuth();
  const router = useRouter();
  const isAdmin = canAccessAdmin(role);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [traceTarget, setTraceTarget] = useState("");
  const [trace, setTrace] = useState<{ target?: string; hops: Hop[] } | null>(null);

  useEffect(() => {
    if (loading || !hydrationReady || !profileReady) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) router.replace("/");
  }, [hydrationReady, isAdmin, loading, profileReady, router, user]);

  const call = useCallback(async (action: "snapshot" | "discover" | "inspect" | "trace", extra: Record<string, string> = {}) => {
    if (!session?.access_token) throw new Error("Sesión requerida.");
    const response = await fetch("/api/network/scan", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...extra }),
    });
    const payload = (await response.json().catch(() => ({}))) as ApiPayload;
    if (!response.ok) throw new Error(payload.error || "No se pudo leer la red.");
    return payload.result;
  }, [session?.access_token]);

  const applySnapshot = useCallback((result: ApiPayload["result"]) => {
    if (!result || typeof result !== "object") return;

    const maybeSnapshot = result as Snapshot;
    if (
      "local" in maybeSnapshot ||
      "devices" in maybeSnapshot ||
      "connections" in maybeSnapshot ||
      "gateway" in maybeSnapshot
    ) {
      setSnapshot((current) => ({ ...(current ?? {}), ...maybeSnapshot }));
      return;
    }

    const wrapper = result as { device?: Device };
    if (wrapper.device?.ip) {
      setSnapshot((current) => ({
        ...(current ?? {}),
        devices: mergeDevice(current?.devices ?? [], wrapper.device!),
      }));
      setSelectedIp(wrapper.device.ip);
      return;
    }

    const device = result as Device;
    if (device.ip) {
      setSnapshot((current) => ({
        ...(current ?? {}),
        devices: mergeDevice(current?.devices ?? [], device),
      }));
      setSelectedIp(device.ip);
    }
  }, []);

  const refresh = useCallback(async (action: "snapshot" | "discover" = "snapshot") => {
    setBusy(action);
    setError(null);
    try {
      const result = await call(action);
      applySnapshot(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer la red.");
    } finally {
      setBusy(null);
    }
  }, [applySnapshot, call]);

  useEffect(() => {
    if (!isAdmin || !session?.access_token) return;
    void refresh("snapshot");
    const timer = window.setInterval(() => {
      void call("snapshot")
        .then((result) => {
          applySnapshot(result);
          setError(null);
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : "No se pudo leer la red.");
        });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [applySnapshot, call, isAdmin, refresh, session?.access_token]);

  const inspect = useCallback(async (device: Device) => {
    setSelectedIp(device.ip);
    setBusy(`inspect:${device.ip}`);
    setError(null);
    try {
      const result = await call("inspect", { target: device.ip });
      applySnapshot(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo inspeccionar el host.");
    } finally {
      setBusy(null);
    }
  }, [applySnapshot, call]);

  const runTrace = useCallback(async () => {
    const target = traceTarget.trim();
    if (!target) return;
    setBusy("trace");
    setError(null);
    try {
      const result = await call("trace", { target });
      const data = result as { hops?: Hop[]; target?: string } | undefined;
      setTrace({ target: data?.target ?? target, hops: data?.hops ?? [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo trazar la ruta.");
    } finally {
      setBusy(null);
    }
  }, [call, traceTarget]);

  const devices = snapshot?.devices ?? [];
  const connections = snapshot?.connections ?? [];
  const selected = devices.find((device) => device.ip === selectedIp) ?? null;

  const destinations = useMemo(() => {
    const map = new Map<string, Connection & { count: number }>();
    for (const connection of connections) {
      if (!connection.remoteAddress) continue;
      const key = `${connection.remoteAddress}:${connection.remotePort ?? 0}:${connection.process ?? ""}`;
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { ...connection, count: 1 });
    }
    return [...map.values()].slice(0, 30);
  }, [connections]);

  if (loading || !hydrationReady || !profileReady || !user || !isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#03070b] text-white">
        <div className="flex items-center gap-3 text-sm font-bold text-white/55">
          <Loader2 className="h-5 w-5 animate-spin" /> Abriendo mapa de red...
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
            "radial-gradient(circle at 48% -10%, rgba(34,211,238,.13), transparent 32%), radial-gradient(circle at 8% 40%, rgba(124,58,237,.10), transparent 28%), linear-gradient(180deg,#03070b,#05030a)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[.11]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(103,232,249,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,.22) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />

      <div className="relative mx-auto w-full max-w-[1680px] px-3 pb-16 pt-3 sm:px-5 sm:pt-5">
        <header className="sticky top-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-cyan-300/15 bg-[#050a10]/90 px-3 py-3 shadow-[0_20px_70px_rgba(0,0,0,.38)] backdrop-blur-2xl sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-white/70 transition hover:border-cyan-300/35 hover:text-white"
              aria-label="Volver"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] text-cyan-100 shadow-[0_0_30px_rgba(34,211,238,.08)]">
              <Network className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black uppercase tracking-[.13em] sm:text-base">CLOUVA RED</div>
              <div className="truncate text-[10px] font-bold uppercase tracking-[.18em] text-cyan-100/40">
                Mi PC → puertas → LAN → Internet
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-400/[.06] px-3 py-2 text-[11px] font-black uppercase tracking-[.1em] text-emerald-100 sm:inline-flex">
              <ShieldCheck className="h-4 w-4" /> En vivo · 10s
            </span>
            <Link
              href="/seguridad"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 text-xs font-black uppercase tracking-[.08em] text-white/70 transition hover:border-cyan-300/30 hover:text-white"
            >
              <Shield className="h-4 w-4" /> Seguridad
            </Link>
            <button
              type="button"
              onClick={() => void refresh("snapshot")}
              disabled={Boolean(busy)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-3 text-xs font-black uppercase tracking-[.08em] text-white/70 transition hover:border-cyan-300/30 hover:text-white disabled:opacity-40"
            >
              <RefreshCw className={cn("h-4 w-4", busy === "snapshot" && "animate-spin")} /> Actualizar
            </button>
            <button
              type="button"
              onClick={() => void refresh("discover")}
              disabled={Boolean(busy)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/[.08] px-3 text-xs font-black uppercase tracking-[.08em] text-cyan-50 transition hover:bg-cyan-300/[.13] disabled:opacity-40"
            >
              {busy === "discover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
              Escanear LAN
            </button>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[.07] p-4 text-sm leading-relaxed text-amber-50">
            <strong className="font-black">Workspace:</strong> {error}
            <div className="mt-1 text-xs text-amber-100/55">
              La web ya está lista. Para datos reales, el Workspace/Desktop conectado tiene que exponer las herramientas de red locales.
            </div>
          </div>
        ) : null}

        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Equipo", snapshot?.local?.hostname || "MI PC", <Laptop key="pc" className="h-5 w-5" />],
            ["Subred", snapshot?.local?.subnet || "—", <Wifi key="lan" className="h-5 w-5" />],
            ["Dispositivos", String(devices.length), <Server key="devices" className="h-5 w-5" />],
            ["Conexiones", String(connections.length), <Waypoints key="connections" className="h-5 w-5" />],
          ].map(([label, value, icon]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-black/25 p-4 backdrop-blur">
              <div className="flex items-center gap-2 text-cyan-100/70">{icon}<span className="text-[10px] font-black uppercase tracking-[.15em]">{label}</span></div>
              <div className="mt-2 truncate font-mono text-lg font-black text-white">{value}</div>
            </div>
          ))}
        </section>

        <section className="mt-4 overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[#050b11]/82 p-3 shadow-[0_30px_90px_rgba(0,0,0,.32)] backdrop-blur-xl sm:p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-100/45">Mapa vivo</div>
              <h1 className="mt-1 text-2xl font-black tracking-[-.04em] sm:text-3xl">Desde mi máquina hasta todo lo que toca</h1>
            </div>
            <div className="font-mono text-[10px] text-white/30">
              {snapshot?.scannedAt ? new Date(snapshot.scannedAt).toLocaleString("es-AR") : "sin captura todavía"}
            </div>
          </div>

          <div className="grid min-h-[560px] gap-4 xl:grid-cols-[minmax(260px,1fr)_320px_minmax(300px,1fr)]">
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-3">
              <div className="mb-3 flex items-center gap-2 px-1 text-[11px] font-black uppercase tracking-[.14em] text-white/45">
                <Server className="h-4 w-4" /> Mi red local
              </div>
              <div className="space-y-2">
                {devices.length ? devices.map((device) => (
                  <DeviceCard
                    key={device.ip}
                    device={device}
                    selected={selectedIp === device.ip}
                    busy={busy === `inspect:${device.ip}`}
                    onInspect={(item) => void inspect(item)}
                  />
                )) : (
                  <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-white/10 p-6 text-center">
                    <div>
                      <ScanLine className="mx-auto h-7 w-7 text-white/20" />
                      <div className="mt-2 text-sm font-bold text-white/50">Sin hosts detectados</div>
                      <div className="mt-1 text-xs text-white/30">Tocá “Escanear LAN”.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="relative flex flex-col items-center justify-center gap-5 rounded-[24px] border border-cyan-300/10 bg-[radial-gradient(circle_at_center,rgba(34,211,238,.08),transparent_58%)] p-4">
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-cyan-300/18 to-transparent" />

              <div className="relative z-10 w-full rounded-[22px] border border-cyan-300/30 bg-[#07131a]/95 p-4 text-center shadow-[0_0_50px_rgba(34,211,238,.10)]">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan-200/25 bg-cyan-300/[.10] text-cyan-50">
                  <Laptop className="h-7 w-7" />
                </span>
                <div className="mt-3 text-[10px] font-black uppercase tracking-[.18em] text-cyan-100/45">Origen</div>
                <div className="mt-1 text-xl font-black">{snapshot?.local?.hostname || "MI PC"}</div>
                <div className="mt-1 font-mono text-xs text-white/45">{snapshot?.local?.ip || "IP local pendiente"}</div>
                {snapshot?.local?.interface ? <div className="mt-1 text-[10px] text-white/28">{snapshot.local.interface}</div> : null}
              </div>

              <div className="relative z-10 flex items-center gap-2 rounded-full border border-cyan-300/20 bg-black/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-[.14em] text-cyan-100/70">
                <Cable className="h-3.5 w-3.5" /> puerta de enlace
              </div>

              <div className="relative z-10 w-full rounded-[22px] border border-violet-300/22 bg-[#0d0918]/95 p-4 text-center">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-violet-300/20 bg-violet-300/[.08] text-violet-100">
                  <Router className="h-6 w-6" />
                </span>
                <div className="mt-3 text-[10px] font-black uppercase tracking-[.16em] text-violet-100/45">Router / Gateway</div>
                <div className="mt-1 font-mono text-sm font-black text-white">{snapshot?.local?.gateway || snapshot?.gateway?.ip || "—"}</div>
                <div className="mt-3"><PortPills ports={snapshot?.gateway?.ports} compact /></div>
              </div>

              {selected ? (
                <div className="relative z-10 w-full rounded-[22px] border border-white/10 bg-black/50 p-4">
                  <div className="text-[10px] font-black uppercase tracking-[.15em] text-white/35">Nodo seleccionado</div>
                  <div className="mt-1 truncate text-base font-black">{titleForDevice(selected)}</div>
                  <div className="mt-1 font-mono text-xs text-white/45">{selected.ip}</div>
                  {selected.mac ? <div className="mt-1 font-mono text-[10px] text-white/30">{selected.mac}</div> : null}
                  <div className="mt-3"><PortPills ports={selected.ports} /></div>
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/8 bg-black/20 p-3">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[.14em] text-white/45">
                  <Globe2 className="h-4 w-4" /> Salidas activas
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[9px] text-white/35">{destinations.length}</span>
              </div>
              <div className="space-y-2">
                {destinations.length ? destinations.map((connection, index) => (
                  <div key={`${connection.remoteAddress}:${connection.remotePort ?? 0}:${connection.process ?? ""}:${index}`} className="rounded-2xl border border-white/9 bg-black/25 p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-violet-300/15 bg-violet-300/[.06] text-violet-100">
                        <Globe2 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-white">{connection.hostname || connection.remoteAddress}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-white/42">
                          {connection.remoteAddress}{connection.remotePort ? `:${connection.remotePort}` : ""}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {connection.process ? <span className="rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-[10px] font-bold text-white/55">{connection.process}</span> : null}
                          {connection.localPort ? <span className="rounded-lg border border-cyan-300/15 bg-cyan-300/[.05] px-2 py-1 font-mono text-[10px] font-bold text-cyan-100/70">mi puerta {connection.localPort}</span> : null}
                          {connection.remotePort ? <span className="rounded-lg border border-violet-300/15 bg-violet-300/[.05] px-2 py-1 font-mono text-[10px] font-bold text-violet-100/70">destino {connection.remotePort}</span> : null}
                        </div>
                      </div>
                      <CircleDot className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-300/70" />
                    </div>
                  </div>
                )) : (
                  <div className="grid min-h-44 place-items-center rounded-2xl border border-dashed border-white/10 p-6 text-center">
                    <div>
                      <Waypoints className="mx-auto h-7 w-7 text-white/20" />
                      <div className="mt-2 text-sm font-bold text-white/50">Sin conexiones cargadas</div>
                      <div className="mt-1 text-xs text-white/30">El Workspace puede leer las conexiones activas de tu PC.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[420px_1fr]">
          <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
            <div className="flex items-center gap-2 text-sm font-black"><Route className="h-5 w-5 text-cyan-100" /> Trazar un destino</div>
            <p className="mt-1 text-xs leading-relaxed text-white/40">Muestra el camino desde tu PC hasta un host elegido, salto por salto.</p>
            <div className="mt-4 flex gap-2">
              <input
                value={traceTarget}
                onChange={(event) => setTraceTarget(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runTrace();
                }}
                placeholder="ej: clouva.com.ar"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 font-mono text-sm text-white outline-none transition placeholder:text-white/20 focus:border-cyan-300/35"
              />
              <button
                type="button"
                onClick={() => void runTrace()}
                disabled={!traceTarget.trim() || Boolean(busy)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/[.08] text-cyan-50 disabled:opacity-35"
                aria-label="Trazar"
              >
                {busy === "trace" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
            <div className="mb-3 text-[10px] font-black uppercase tracking-[.16em] text-white/35">
              {trace?.target ? `MI PC → ${trace.target}` : "Ruta"}
            </div>
            {trace?.hops?.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xl border border-cyan-300/20 bg-cyan-300/[.07] px-3 py-2 text-xs font-black text-cyan-50">MI PC</span>
                {trace.hops.map((hop) => (
                  <div key={hop.hop} className="flex items-center gap-2">
                    <span className="text-white/18">→</span>
                    <span className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-2">
                      <span className="block text-[9px] font-black uppercase tracking-[.12em] text-white/28">salto {hop.hop}</span>
                      <span className="block max-w-[220px] truncate font-mono text-[11px] font-bold text-white/70">{hop.hostname || hop.address || "*"}</span>
                      {typeof hop.latencyMs === "number" ? <span className="block text-[9px] text-white/30">{hop.latencyMs.toFixed(1)} ms</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-20 items-center gap-3 text-sm text-white/35">
                <Route className="h-5 w-5" /> Escribí un destino para ver por dónde sale tu conexión.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
