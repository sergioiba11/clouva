"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Cable,
  Crosshair,
  Globe2,
  Laptop,
  Loader2,
  Minus,
  Network,
  Plus,
  RefreshCw,
  Route,
  Router,
  ScanLine,
  Server,
  Shield,
  Wifi,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin } from "@/lib/auth";
import styles from "./red.module.css";

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

type Neighbor = {
  ip: string;
  mac?: string | null;
  state?: string | null;
  interface?: string | null;
};

type RouteEntry = {
  destination?: string | null;
  nextHop?: string | null;
  metric?: number | null;
  interface?: string | null;
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
    dns?: string[];
  };
  activity?: {
    foregroundProcess?: string | null;
    foregroundPid?: number | null;
    foregroundTitle?: string | null;
    observedAt?: string | null;
  };
  gateway?: Device | null;
  devices?: Device[];
  neighbors?: Neighbor[];
  routes?: RouteEntry[];
  connections?: Connection[];
};

type ApiPayload = {
  ok?: boolean;
  result?: Snapshot | Device | { device?: Device; hops?: Hop[]; target?: string };
  error?: string;
};

type Destination = Connection & { count: number; id: string };

type Detail =
  | { kind: "pc" }
  | { kind: "gateway" }
  | { kind: "device"; device: Device }
  | { kind: "destination"; destination: Destination }
  | { kind: "neighbor"; neighbor: Neighbor };

const SCENE_W = 1100;
const SCENE_H = 700;
const PC = { x: 120, y: 307, w: 180, h: 66 };
const GATEWAY = { x: 430, y: 307, w: 180, h: 66 };

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function titleForDevice(device: Device) {
  return device.hostname || device.vendor || device.ip;
}

function serviceFromActivity(title?: string | null, process?: string | null) {
  const text = (title ?? "").toLowerCase();
  if (text.includes("youtube")) return "YouTube";
  if (text.includes("chatgpt")) return "ChatGPT";
  if (text.includes("discord")) return "Discord";
  if (text.includes("github")) return "GitHub";
  if (text.includes("cloudflare")) return "Cloudflare";
  if (text.includes("clouva")) return "CLOUVA";
  return process || "Sin actividad identificada";
}

function mergeDevice(devices: Device[], incoming: Device) {
  const index = devices.findIndex((device) => device.ip === incoming.ip);
  if (index < 0) return [...devices, incoming];
  const next = [...devices];
  next[index] = {
    ...next[index],
    ...incoming,
    ports: incoming.ports ?? next[index].ports,
  };
  return next;
}

function isUsefulConnection(connection: Connection) {
  const address = connection.remoteAddress;
  if (!address || address === "127.0.0.1" || address === "::1") return false;
  if (address === "0.0.0.0" || address === "::") return false;
  return true;
}

function curve(
  from: { x: number; y: number },
  to: { x: number; y: number },
  bend = 0.45,
) {
  const dx = to.x - from.x;
  const c1 = from.x + dx * bend;
  const c2 = to.x - dx * bend;
  return `M ${from.x} ${from.y} C ${c1} ${from.y}, ${c2} ${to.y}, ${to.x} ${to.y}`;
}

export default function NetworkMapPage() {
  const { user, session, role, loading, hydrationReady, profileReady } = useAuth();
  const router = useRouter();
  const isAdmin = canAccessAdmin(role);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [trace, setTrace] = useState<{ target: string; hops: Hop[] } | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (loading || !hydrationReady || !profileReady) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) router.replace("/");
  }, [hydrationReady, isAdmin, loading, profileReady, router, user]);

  const call = useCallback(
    async (
      action: "snapshot" | "discover" | "inspect" | "trace",
      extra: Record<string, string> = {},
    ) => {
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
    },
    [session?.access_token],
  );

  const applySnapshot = useCallback((result: ApiPayload["result"]) => {
    if (!result || typeof result !== "object") return;

    const maybeSnapshot = result as Snapshot;
    if (
      "local" in maybeSnapshot ||
      "devices" in maybeSnapshot ||
      "connections" in maybeSnapshot ||
      "neighbors" in maybeSnapshot
    ) {
      setSnapshot((current) => ({
        ...(current ?? {}),
        ...maybeSnapshot,
        devices:
          maybeSnapshot.devices?.length
            ? maybeSnapshot.devices
            : current?.devices ?? [],
      }));
      return;
    }

    const wrapper = result as { device?: Device };
    const device = wrapper.device ?? (result as Device);
    if (device?.ip) {
      setSnapshot((current) => ({
        ...(current ?? {}),
        devices: mergeDevice(current?.devices ?? [], device),
      }));
      setDetail({ kind: "device", device });
    }
  }, []);

  const refresh = useCallback(
    async (action: "snapshot" | "discover" = "snapshot") => {
      setBusy(action);
      try {
        const result = await call(action);
        applySnapshot(result);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo leer la red.");
      } finally {
        setBusy(null);
      }
    },
    [applySnapshot, call],
  );

  useEffect(() => {
    if (!isAdmin || !session?.access_token) return;
    void refresh("discover");
    const timer = window.setInterval(() => {
      void call("snapshot")
        .then((result) => {
          applySnapshot(result);
          setError(null);
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : "No se pudo leer la red.");
        });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [applySnapshot, call, isAdmin, refresh, session?.access_token]);

  const inspect = useCallback(
    async (device: Device) => {
      setDetail({ kind: "device", device });
      setBusy(`inspect:${device.ip}`);
      try {
        const result = await call("inspect", { target: device.ip });
        applySnapshot(result);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo inspeccionar el host.");
      } finally {
        setBusy(null);
      }
    },
    [applySnapshot, call],
  );

  const runTrace = useCallback(
    async (destination: Destination) => {
      setDetail({ kind: "destination", destination });
      setTrace(null);
      setBusy(`trace:${destination.id}`);
      try {
        const result = (await call("trace", {
          target: destination.remoteAddress,
        })) as { hops?: Hop[]; target?: string } | undefined;
        setTrace({
          target: result?.target ?? destination.remoteAddress,
          hops: result?.hops ?? [],
        });
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo trazar la ruta.");
      } finally {
        setBusy(null);
      }
    },
    [call],
  );

  const devices = snapshot?.devices ?? [];
  const neighbors = snapshot?.neighbors ?? [];
  const connections = snapshot?.connections ?? [];

  const gatewayIp = snapshot?.local?.gateway || snapshot?.gateway?.ip || null;
  const defaultRoute = (snapshot?.routes ?? []).find(
    (entry) => entry.destination === "0.0.0.0/0",
  );

  const lanDevices = useMemo(() => {
    const map = new Map<string, Device>();
    for (const device of devices) {
      if (!device.ip) continue;
      if (device.ip === snapshot?.local?.ip || device.ip === gatewayIp) continue;
      map.set(device.ip, device);
    }

    for (const neighbor of neighbors) {
      if (!neighbor.ip) continue;
      if (neighbor.ip === snapshot?.local?.ip || neighbor.ip === gatewayIp) continue;
      if (!map.has(neighbor.ip)) {
        map.set(neighbor.ip, {
          ip: neighbor.ip,
          mac: neighbor.mac,
          status: neighbor.state,
        });
      }
    }

    return [...map.values()].slice(0, 8);
  }, [devices, gatewayIp, neighbors, snapshot?.local?.ip]);

  const destinations = useMemo<Destination[]>(() => {
    const map = new Map<string, Destination>();
    for (const connection of connections) {
      if (!isUsefulConnection(connection)) continue;
      const id = [
        connection.process ?? "",
        connection.remoteAddress,
        connection.remotePort ?? 0,
      ].join(":");
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(id, { ...connection, count: 1, id });
      }
    }

    return [...map.values()]
      .sort((a, b) => {
        if ((a.process ?? "") === (snapshot?.activity?.foregroundProcess ?? "")) return -1;
        if ((b.process ?? "") === (snapshot?.activity?.foregroundProcess ?? "")) return 1;
        return b.count - a.count;
      })
      .slice(0, 10);
  }, [connections, snapshot?.activity?.foregroundProcess]);

  const devicePositions = useMemo(() => {
    const slots = [
      { x: 60, y: 100 },
      { x: 235, y: 105 },
      { x: 45, y: 500 },
      { x: 235, y: 515 },
      { x: 315, y: 185 },
      { x: 320, y: 445 },
      { x: 70, y: 220 },
      { x: 70, y: 410 },
    ];
    return lanDevices.map((device, index) => ({
      device,
      ...slots[index],
    }));
  }, [lanDevices]);

  const destinationPositions = useMemo(() => {
    const count = Math.max(destinations.length, 1);
    const top = 92;
    const bottom = 610;
    const step = count === 1 ? 0 : (bottom - top) / (count - 1);
    return destinations.map((destination, index) => ({
      destination,
      x: 780,
      y: count === 1 ? 307 : top + step * index,
    }));
  }, [destinations]);

  const selectedDestination =
    detail?.kind === "destination" ? detail.destination : null;

  const selectedDevice =
    detail?.kind === "device" ? detail.device : null;

  const clampScale = useCallback((value: number) => Math.min(2.2, Math.max(0.65, value)), []);

  const zoomBy = useCallback(
    (delta: number) => {
      setCamera((current) => ({
        ...current,
        scale: clampScale(current.scale + delta),
      }));
    },
    [clampScale],
  );

  const resetCamera = useCallback(() => {
    setCamera({ x: 0, y: 0, scale: 1 });
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: camera.x,
        originY: camera.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [camera.x, camera.y],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCamera((current) => ({
      ...current,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }));
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
  }, []);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
    },
    [zoomBy],
  );

  if (loading || !hydrationReady || !profileReady || !user || !isAdmin) {
    return (
      <main className={styles.page}>
        <div className="grid min-h-screen place-items-center">
          <div className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="h-5 w-5 animate-spin" /> Abriendo Red...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Link href="/" className={styles.back} aria-label="Volver">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className={styles.logo}>
              <Network className="h-5 w-5" />
            </span>
            <div className={styles.brandText}>
              <strong>CLOUVA RED</strong>
              <span>Topología real observada desde tu Workspace</span>
            </div>
          </div>

          <div className={styles.headerActions}>
            <span className={styles.live}>● EN VIVO · 5s</span>
            <Link href="/seguridad" className={styles.action}>
              <Shield className="h-4 w-4" />
              <span className={styles.actionText}>Seguridad</span>
            </Link>
            <button
              type="button"
              className={cn(styles.action, styles.actionPrimary)}
              disabled={Boolean(busy)}
              onClick={() => void refresh("discover")}
            >
              {busy === "discover" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4" />
              )}
              <span className={styles.actionText}>Escanear</span>
            </button>
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.hud}>
          <div className={cn(styles.hudCard, styles.activityCard)}>
            <div className={styles.hudLabel}>Actividad observada en mi PC</div>
            <div className={styles.activityTitle}>
              {serviceFromActivity(
                snapshot?.activity?.foregroundTitle,
                snapshot?.activity?.foregroundProcess,
              )}
            </div>
            <div className={styles.activitySub}>
              {snapshot?.activity?.foregroundTitle ||
                snapshot?.activity?.foregroundProcess ||
                "sin lectura de primer plano"}
            </div>
          </div>

          <button
            type="button"
            className={styles.hudCard}
            onClick={() => setDetail({ kind: "pc" })}
          >
            <div className={styles.hudLabel}>Sensor</div>
            <div className={cn(styles.hudValue, styles.hudValueMono)}>
              {snapshot?.local?.ip || "—"}
            </div>
          </button>

          <button
            type="button"
            className={styles.hudCard}
            onClick={() => setDetail({ kind: "gateway" })}
          >
            <div className={styles.hudLabel}>Gateway</div>
            <div className={cn(styles.hudValue, styles.hudValueMono)}>
              {gatewayIp || defaultRoute?.nextHop || "—"}
            </div>
          </button>

          <div className={styles.hudCard}>
            <div className={styles.hudLabel}>Ahora</div>
            <div className={styles.hudValue}>
              {lanDevices.length} LAN · {destinations.length} destinos
            </div>
          </div>
        </section>

        <section
          className={styles.mapFrame}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <div
            className={styles.scene}
            style={{
              transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`,
            }}
          >
            <span className={cn(styles.zoneLabel, styles.lanLabel)}>MI LAN</span>
            <span className={cn(styles.zoneLabel, styles.edgeLabel)}>BORDE</span>
            <span className={cn(styles.zoneLabel, styles.netLabel)}>DESTINOS ACTIVOS</span>

            <svg
              className={styles.svg}
              viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
              aria-hidden="true"
            >
              {devicePositions.map(({ device, x, y }) => (
                <path
                  key={`line-device-${device.ip}`}
                  d={curve(
                    { x: PC.x + PC.w / 2, y: PC.y + PC.h / 2 },
                    { x: x + 78, y: y + 33 },
                    0.38,
                  )}
                  className={styles.lanLine}
                  fill="none"
                />
              ))}

              <path
                d={curve(
                  { x: PC.x + PC.w, y: PC.y + PC.h / 2 },
                  { x: GATEWAY.x, y: GATEWAY.y + GATEWAY.h / 2 },
                  0.5,
                )}
                className={styles.gatewayLine}
                fill="none"
              />

              {destinationPositions.map(({ destination, x, y }) => (
                <path
                  key={`line-dest-${destination.id}`}
                  d={curve(
                    { x: GATEWAY.x + GATEWAY.w, y: GATEWAY.y + GATEWAY.h / 2 },
                    { x, y: y + 33 },
                    0.42,
                  )}
                  className={
                    selectedDestination?.id === destination.id
                      ? styles.trafficLine
                      : styles.trafficLineDim
                  }
                  fill="none"
                />
              ))}
            </svg>

            <button
              type="button"
              className={cn(
                styles.node,
                styles.pcNode,
                detail?.kind === "pc" && styles.nodeSelected,
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setDetail({ kind: "pc" })}
            >
              <span className={styles.nodeIcon}>
                <Laptop className="h-5 w-5 text-cyan-100" />
              </span>
              <span className={styles.nodeBody}>
                <strong>{snapshot?.local?.hostname || "MI PC"}</strong>
                <span>{snapshot?.local?.ip || "IP pendiente"}</span>
                <small>{snapshot?.local?.interface || "interfaz pendiente"}</small>
              </span>
              <i className={styles.statusDot} />
            </button>

            <button
              type="button"
              className={cn(
                styles.node,
                styles.gatewayNode,
                detail?.kind === "gateway" && styles.nodeSelected,
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setDetail({ kind: "gateway" })}
            >
              <span className={styles.nodeIcon}>
                <Router className="h-5 w-5 text-violet-100" />
              </span>
              <span className={styles.nodeBody}>
                <strong>ROUTER / GATEWAY</strong>
                <span>{gatewayIp || defaultRoute?.nextHop || "—"}</span>
                <small>salida observada de tu LAN</small>
              </span>
              <i className={styles.statusDot} />
            </button>

            {devicePositions.map(({ device, x, y }) => (
              <button
                key={device.ip}
                type="button"
                className={cn(
                  styles.node,
                  styles.deviceNode,
                  selectedDevice?.ip === device.ip && styles.nodeSelected,
                )}
                style={{ left: x, top: y }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void inspect(device)}
              >
                <span className={styles.nodeIcon}>
                  <Server className="h-4 w-4 text-cyan-100/80" />
                </span>
                <span className={styles.nodeBody}>
                  <strong>{titleForDevice(device)}</strong>
                  <span>{device.ip}</span>
                  <small>{device.mac || device.status || "host observado"}</small>
                </span>
                <i className={styles.statusDot} />
              </button>
            ))}

            {destinationPositions.map(({ destination, x, y }) => (
              <button
                key={destination.id}
                type="button"
                className={cn(
                  styles.node,
                  styles.destNode,
                  selectedDestination?.id === destination.id && styles.nodeSelected,
                )}
                style={{ left: x, top: y }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void runTrace(destination)}
              >
                <span className={styles.nodeIcon}>
                  <Globe2 className="h-4 w-4 text-emerald-100/80" />
                </span>
                <span className={styles.nodeBody}>
                  <strong>
                    {destination.hostname ||
                      `${destination.remoteAddress}:${destination.remotePort ?? "?"}`}
                  </strong>
                  <span>
                    {destination.remoteAddress}
                    {destination.remotePort ? `:${destination.remotePort}` : ""}
                  </span>
                  <small className={styles.processPill}>
                    {destination.process || "proceso no identificado"} · {destination.count} conexión
                    {destination.count === 1 ? "" : "es"}
                  </small>
                </span>
                <i className={styles.statusDot} />
              </button>
            ))}
          </div>

          <div
            className={styles.mapControls}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => zoomBy(0.15)} aria-label="Acercar">
              <Plus className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => zoomBy(-0.15)} aria-label="Alejar">
              <Minus className="h-4 w-4" />
            </button>
            <button type="button" onClick={resetCamera} aria-label="Centrar">
              <Crosshair className="h-4 w-4" />
            </button>
            <span className={styles.zoomText}>{Math.round(camera.scale * 100)}%</span>
          </div>

          <div className={styles.legend}>
            <span><i /> topología LAN</span>
            <span><i className={styles.activeI} /> conexión activa</span>
          </div>

          {!snapshot && !busy ? (
            <div className={styles.emptyMap}>
              <div>
                <strong>Esperando al sensor</strong>
                CLOUVA necesita tu Workspace conectado para dibujar la red.
              </div>
            </div>
          ) : null}

          {detail ? (
            <aside
              className={styles.drawer}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className={styles.drawerHead}>
                <div>
                  <div className={styles.drawerKind}>
                    {detail.kind === "pc"
                      ? "SENSOR"
                      : detail.kind === "gateway"
                        ? "BORDE"
                        : detail.kind === "device"
                          ? "NODO LAN"
                          : detail.kind === "neighbor"
                            ? "VECINO LAN"
                            : "MOVIMIENTO ACTIVO"}
                  </div>

                  <h2>
                    {detail.kind === "pc"
                      ? snapshot?.local?.hostname || "MI PC"
                      : detail.kind === "gateway"
                        ? "Router / Gateway"
                        : detail.kind === "device"
                          ? titleForDevice(detail.device)
                          : detail.kind === "neighbor"
                            ? detail.neighbor.ip
                            : detail.destination.hostname ||
                              `${detail.destination.remoteAddress}:${detail.destination.remotePort ?? "?"}`}
                  </h2>

                  <div className={styles.drawerSub}>
                    {detail.kind === "pc"
                      ? snapshot?.local?.ip || "—"
                      : detail.kind === "gateway"
                        ? gatewayIp || defaultRoute?.nextHop || "—"
                        : detail.kind === "device"
                          ? detail.device.ip
                          : detail.kind === "neighbor"
                            ? detail.neighbor.mac || "MAC no disponible"
                            : `${detail.destination.process || "proceso"} → ${detail.destination.remoteAddress}:${detail.destination.remotePort ?? "?"}`}
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.close}
                  onClick={() => {
                    setDetail(null);
                    setTrace(null);
                  }}
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {detail.kind === "pc" ? (
                <>
                  <div className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Observado</div>
                    <div className={styles.fact}><span>Hostname</span><strong>{snapshot?.local?.hostname || "—"}</strong></div>
                    <div className={styles.fact}><span>IP local</span><strong>{snapshot?.local?.ip || "—"}</strong></div>
                    <div className={styles.fact}><span>Interfaz</span><strong>{snapshot?.local?.interface || "—"}</strong></div>
                    <div className={styles.fact}><span>Subred</span><strong>{snapshot?.local?.subnet || "—"}</strong></div>
                    <div className={styles.fact}><span>Conexiones activas</span><strong>{connections.length}</strong></div>
                  </div>
                  <div className={styles.securityNote}>
                    Este equipo es el sensor. Nmap descubre la LAN y Windows aporta las conexiones activas.
                  </div>
                </>
              ) : null}

              {detail.kind === "gateway" ? (
                <>
                  <div className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Ruta de salida</div>
                    <div className={styles.fact}><span>Gateway</span><strong>{gatewayIp || "—"}</strong></div>
                    <div className={styles.fact}><span>Ruta por defecto</span><strong>{defaultRoute?.destination || "0.0.0.0/0"}</strong></div>
                    <div className={styles.fact}><span>Siguiente salto</span><strong>{defaultRoute?.nextHop || gatewayIp || "—"}</strong></div>
                    <div className={styles.fact}><span>DNS</span><strong>{snapshot?.local?.dns?.join(" · ") || "—"}</strong></div>
                  </div>
                  <div className={styles.securityNote}>
                    El gateway puede observar metadatos de las conexiones que atraviesan la red. El contenido protegido por TLS no se vuelve legible sólo por pasar por él.
                  </div>
                </>
              ) : null}

              {detail.kind === "device" ? (
                <>
                  <div className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Host LAN</div>
                    <div className={styles.fact}><span>IP</span><strong>{detail.device.ip}</strong></div>
                    <div className={styles.fact}><span>MAC</span><strong>{detail.device.mac || "—"}</strong></div>
                    <div className={styles.fact}><span>Fabricante</span><strong>{detail.device.vendor || "—"}</strong></div>
                    <div className={styles.fact}><span>Estado</span><strong>{detail.device.status || "observado"}</strong></div>
                  </div>

                  <div className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Puertos observados</div>
                    {busy === `inspect:${detail.device.ip}` ? (
                      <div className={styles.loadingInline}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> inspeccionando...
                      </div>
                    ) : (
                      <div className={styles.pills}>
                        {(devices.find((device) => device.ip === detail.device.ip)?.ports ?? []).length ? (
                          (devices.find((device) => device.ip === detail.device.ip)?.ports ?? []).map((port) => (
                            <span className={styles.pill} key={`${port.protocol ?? "tcp"}:${port.port}`}>
                              {port.port}/{port.protocol ?? "tcp"}{port.service ? ` · ${port.service}` : ""}
                            </span>
                          ))
                        ) : (
                          <span className={styles.pill}>sin puertos leídos</span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {detail.kind === "destination" ? (
                <>
                  <div className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Movimiento</div>
                    <div className={styles.fact}><span>Proceso</span><strong>{detail.destination.process || "—"}</strong></div>
                    <div className={styles.fact}><span>PID</span><strong>{detail.destination.pid ?? "—"}</strong></div>
                    <div className={styles.fact}><span>Mi puerto</span><strong>{detail.destination.localPort ?? "—"}</strong></div>
                    <div className={styles.fact}><span>Destino</span><strong>{detail.destination.remoteAddress}:{detail.destination.remotePort ?? "?"}</strong></div>
                    <div className={styles.fact}><span>Conexiones</span><strong>{detail.destination.count}</strong></div>
                  </div>

                  <div className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Camino observado</div>
                    {busy === `trace:${detail.destination.id}` ? (
                      <div className={styles.loadingInline}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> trazando desde tu PC...
                      </div>
                    ) : trace?.hops?.length ? (
                      <div className={styles.trace}>
                        <div className={styles.hop}>
                          <b>{snapshot?.local?.ip || "MI PC"}</b>
                          <span>origen</span>
                        </div>
                        {trace.hops.map((hop) => (
                          <div className="contents" key={`${hop.hop}:${hop.address ?? ""}`}>
                            <span className={styles.hopArrow}>›</span>
                            <div className={styles.hop}>
                              <b>{hop.address || "*"}</b>
                              <span>
                                hop {hop.hop}
                                {hop.latencyMs != null ? ` · ${Math.round(hop.latencyMs)} ms` : ""}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.securityNote}>
                        No hubo saltos visibles. Algunos routers no responden a traceroute aunque la conexión funcione.
                      </div>
                    )}
                  </div>

                  <div className={styles.securityNote}>
                    {detail.destination.remotePort === 443
                      ? "Puerto 443: el sensor ve origen, destino, puertos, proceso y ruta; no está leyendo el contenido HTTPS cifrado."
                      : "El sensor muestra la conexión y sus metadatos. No asume el contenido que transporta."}
                  </div>
                </>
              ) : null}
            </aside>
          ) : null}
        </section>
      </div>
    </main>
  );
}
