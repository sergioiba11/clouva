"use client";

import Link from "next/link";
import { Check, Copy, Eye, RefreshCw, Server, Smartphone, Users, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ClouvaLogoMark } from "@/components/brand/clouva-logo";

type MinecraftStatus = {
  configured: boolean;
  online: boolean;
  host: string | null;
  publicJavaHost?: string | null;
  publicBedrockHost?: string | null;
  javaPort: number;
  bedrockPort: number;
  latencyMs?: number;
  version?: string | null;
  motd?: string | null;
  mapUrl?: string | null;
  players?: { online: number; max: number; sample: string[] };
  error?: string;
};

type BlueMapSettings = {
  maps?: string[];
  liveDataRoot?: string;
};

type BlueMapPlayer = {
  uuid: string;
  name: string;
  foreign?: boolean;
  position?: { x?: number; y?: number; z?: number };
  rotation?: { yaw?: number; pitch?: number; roll?: number };
};

type LiveMinecraftPlayer = {
  uuid: string;
  name: string;
  worldId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  headUrl: string;
};

type SavedMinecraftIdentity = {
  uuid: string;
  name: string;
};

const REFRESH_MS = 10_000;
const LIVE_REFRESH_MS = 1_000;
const MAP_ROOT = "/minecraft/map";
const MINECRAFT_IDENTITY_KEY = "clouva.minecraft.identity";
const ASSET_ROOT = "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";
const ASSETS = {
  backgroundDesktop: ASSET_ROOT + "/ratcraft_background.png",
  backgroundMobile: ASSET_ROOT + "/ratcraft_background_mobile_vertical.png",
  poster: ASSET_ROOT + "/ratcraft_poster_mobile.png",
  logo: ASSET_ROOT + "/ratcraft_logo_principal.png",
  start: ASSET_ROOT + "/ratcraft_boton_prender_server.png",
  inicio: ASSET_ROOT + "/ratcraft_btn_inicio.png",
  mapa: ASSET_ROOT + "/ratcraft_btn_mapa.png",
  jugadores: ASSET_ROOT + "/ratcraft_btn_jugadores.png",
  tienda: ASSET_ROOT + "/ratcraft_btn_tienda.png",
  mas: ASSET_ROOT + "/ratcraft_btn_mas.png",
} as const;

function rounded(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function playerBodyUrl(player: Pick<LiveMinecraftPlayer, "uuid" | "name"> | SavedMinecraftIdentity) {
  const identity = player.uuid || player.name;
  return "https://mc-heads.net/body/" + encodeURIComponent(identity) + "/260";
}

function buildMapFocusHash(player: LiveMinecraftPlayer) {
  const distance = 95;
  const rotation = ((player.yaw || 0) * Math.PI) / 180;
  const angle = 1.05;
  return "#" + player.worldId + ":" + rounded(player.x) + ":" + rounded(player.y) + ":" + rounded(player.z) + ":" + distance + ":" + rotation.toFixed(2) + ":" + angle + ":0:0:perspective";
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-fuchsia-300/15 bg-black/35 px-4 py-3 text-left transition hover:border-fuchsia-300/35 hover:bg-fuchsia-400/[.06]"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-100/40">{label}</span>
        <span className="mt-1 block truncate font-mono text-sm font-bold text-white">{value}</span>
      </span>
      {copied ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5 text-white/45" />}
    </button>
  );
}

function AssetButton({
  src,
  alt,
  onClick,
}: {
  src: string;
  alt: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden rounded-[24px] transition duration-200 hover:-translate-y-1 hover:drop-shadow-[0_0_24px_rgba(217,70,239,.35)] active:scale-[.98]"
    >
      <img src={src} alt={alt} className="h-auto w-full select-none object-contain" draggable={false} />
      <span className="absolute inset-0 rounded-[24px] ring-1 ring-inset ring-white/0 transition group-hover:ring-fuchsia-300/30" />
    </button>
  );
}

export default function MinecraftFamilyPage() {
  const { user, session, loading } = useAuth();
  const [status, setStatus] = useState<MinecraftStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [livePlayers, setLivePlayers] = useState<LiveMinecraftPlayer[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [myIdentity, setMyIdentity] = useState<SavedMinecraftIdentity | null>(null);
  const [spectatingUuid, setSpectatingUuid] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const mapFrameRef = useRef<HTMLIFrameElement | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/minecraft/status", { cache: "no-store" });
      const next = (await response.json()) as MinecraftStatus;
      setStatus(next);
      return next;
    } catch {
      const fallback: MinecraftStatus = {
        configured: false,
        online: false,
        host: null,
        javaPort: 25565,
        bedrockPort: 19132,
        error: "No se pudo consultar el servidor.",
      };
      setStatus(fallback);
      return fallback;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadLivePlayers = useCallback(async () => {
    try {
      const settingsResponse = await fetch(MAP_ROOT + "/settings.json", { cache: "no-store" });
      if (!settingsResponse.ok) throw new Error("BlueMap no está disponible todavía.");

      const settings = (await settingsResponse.json()) as BlueMapSettings;
      const maps = Array.isArray(settings.maps) ? settings.maps : [];
      const liveRoot = (settings.liveDataRoot || "maps").replace(/^\.\//, "").replace(/\/$/, "");
      if (!maps.length) {
        setLivePlayers([]);
        return;
      }

      const snapshots = await Promise.all(
        maps.map(async (worldId) => {
          try {
            const response = await fetch(
              MAP_ROOT + "/" + liveRoot + "/" + encodeURIComponent(worldId) + "/live/players.json?t=" + Date.now(),
              { cache: "no-store" },
            );
            if (!response.ok) return [] as LiveMinecraftPlayer[];
            const data = (await response.json()) as { players?: BlueMapPlayer[] };
            if (!Array.isArray(data.players)) return [] as LiveMinecraftPlayer[];

            return data.players
              .filter((player) => player && player.uuid && player.name && !player.foreign)
              .map((player) => ({
                uuid: player.uuid,
                name: player.name,
                worldId,
                x: Number(player.position?.x ?? 0),
                y: Number(player.position?.y ?? 0),
                z: Number(player.position?.z ?? 0),
                yaw: Number(player.rotation?.yaw ?? 0),
                pitch: Number(player.rotation?.pitch ?? 0),
                headUrl: MAP_ROOT + "/maps/" + encodeURIComponent(worldId) + "/assets/playerheads/" + player.uuid + ".png",
              }));
          } catch {
            return [] as LiveMinecraftPlayer[];
          }
        }),
      );

      const byUuid = new globalThis.Map<string, LiveMinecraftPlayer>();
      snapshots.flat().forEach((player) => byUuid.set(player.uuid, player));
      setLivePlayers(Array.from(byUuid.values()).sort((a, b) => a.name.localeCompare(b.name)));
      setLiveError(null);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "No se pudo leer la posición de los jugadores.");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, user]);

  useEffect(() => {
    if (!user || !status?.online) {
      if (!status?.online) setLivePlayers([]);
      return;
    }
    void loadLivePlayers();
    const timer = window.setInterval(() => void loadLivePlayers(), LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadLivePlayers, status?.online, user]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(MINECRAFT_IDENTITY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedMinecraftIdentity;
      if (parsed?.uuid && parsed?.name) {
        setMyIdentity(parsed);
        setSelectedUuid(parsed.uuid);
      }
    } catch {
      // Invalid local identity: the player can choose again.
    }
  }, []);

  useEffect(() => {
    if (selectedUuid && livePlayers.some((player) => player.uuid === selectedUuid)) return;
    const mine = myIdentity && livePlayers.find((player) => player.uuid === myIdentity.uuid);
    if (mine) {
      setSelectedUuid(mine.uuid);
      return;
    }
    if (!selectedUuid && livePlayers[0]) setSelectedUuid(livePlayers[0].uuid);
  }, [livePlayers, myIdentity, selectedUuid]);

  const selectedPlayer = useMemo(
    () => livePlayers.find((player) => player.uuid === selectedUuid) || null,
    [livePlayers, selectedUuid],
  );

  const myLivePlayer = useMemo(
    () => (myIdentity ? livePlayers.find((player) => player.uuid === myIdentity.uuid) || null : null),
    [livePlayers, myIdentity],
  );

  const spectatingPlayer = useMemo(
    () => livePlayers.find((player) => player.uuid === spectatingUuid) || null,
    [livePlayers, spectatingUuid],
  );

  useEffect(() => {
    if (!spectatingPlayer || !mapFrameRef.current) return;
    try {
      mapFrameRef.current.contentWindow?.location.replace(buildMapFocusHash(spectatingPlayer));
    } catch {
      const base = status?.mapUrl || MAP_ROOT + "/index.html";
      mapFrameRef.current.src = base.split("#")[0] + buildMapFocusHash(spectatingPlayer);
    }
  }, [spectatingPlayer, status?.mapUrl]);

  const javaAddress = status?.publicJavaHost || (status?.host ? status.host + ":" + status.javaPort : "Preparando servidor");
  const bedrockAddress = status?.publicBedrockHost || status?.host || "Preparando servidor";
  const onlineCount = status?.players?.online ?? livePlayers.length;
  const maxPlayers = status?.players?.max ?? 100;

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleStart = async () => {
    setStartError(null);

    if (status?.online) {
      scrollTo("server-info");
      return;
    }

    if (!session?.access_token) {
      setStartError("Tu sesión venció. Volvé a entrar a CLOUVA.");
      return;
    }

    setStarting(true);
    try {
      const response = await fetch("/api/minecraft/start", {
        method: "POST",
        headers: { Authorization: "Bearer " + session.access_token },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo prender el server.");

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(3000);
        const next = await load();
        if (next.online) {
          setStartError(null);
          scrollTo("server-info");
          return;
        }
      }
      setStartError("El servidor está arrancando. La pantalla sigue consultando el estado automáticamente.");
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "No se pudo prender el server.");
    } finally {
      setStarting(false);
    }
  };

  const saveAsMine = (player: LiveMinecraftPlayer) => {
    const identity = { uuid: player.uuid, name: player.name };
    window.localStorage.setItem(MINECRAFT_IDENTITY_KEY, JSON.stringify(identity));
    setMyIdentity(identity);
    setSelectedUuid(player.uuid);
  };

  const startSpectating = (player: LiveMinecraftPlayer) => {
    setSelectedUuid(player.uuid);
    setSpectatingUuid(player.uuid);
    scrollTo("mapa");
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07010d] text-white">
        <div className="text-center">
          <img src={ASSETS.logo} alt="" className="mx-auto w-56 animate-pulse" />
          <p className="mt-4 text-xs font-black uppercase tracking-[.28em] text-fuchsia-200/55">Cargando Ratcraft</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#07010d] px-5 text-white">
        <img src={ASSETS.backgroundMobile} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07010d]/35 via-[#07010d]/45 to-[#07010d]" />
        <div className="relative z-10 max-w-xl text-center">
          <img src={ASSETS.logo} alt="Niños Rata Server" className="mx-auto w-[min(82vw,520px)]" />
          <p className="mt-5 text-sm text-white/70">Entrá a CLOUVA para abrir Ratcraft.</p>
          <Link href="/login" className="mt-6 inline-flex rounded-2xl border border-fuchsia-300/30 bg-fuchsia-500/20 px-6 py-3 text-sm font-black text-white shadow-[0_0_30px_rgba(217,70,239,.18)]">
            Entrar a CLOUVA
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#07010d] text-white">
      <section id="inicio" className="relative min-h-[100svh] overflow-hidden bg-[#08010e]">
        <img
          src={ASSETS.backgroundDesktop}
          alt=""
          className="absolute inset-0 hidden h-full w-full object-cover object-center md:block"
          onError={(event) => {
            event.currentTarget.src = ASSETS.backgroundMobile;
            event.currentTarget.classList.remove("hidden");
          }}
        />
        <img
          src={ASSETS.backgroundMobile}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center md:hidden"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,1,15,.34)_0%,rgba(7,1,15,.04)_25%,rgba(7,1,15,.08)_58%,rgba(7,1,15,.68)_100%)] md:bg-[linear-gradient(180deg,rgba(5,0,12,.30)_0%,rgba(5,0,12,.02)_24%,rgba(5,0,12,.05)_67%,rgba(5,0,12,.62)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(192,38,211,.08),transparent_46%)]" />

        <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[1700px] flex-col px-3 pb-3 pt-3 sm:px-5 md:px-7 md:pb-4 md:pt-4">
          <header className="flex items-center justify-between gap-2 rounded-2xl border border-fuchsia-300/15 bg-[#090313]/72 px-3 py-2.5 shadow-[0_14px_55px_rgba(0,0,0,.34)] backdrop-blur-xl sm:px-4 md:rounded-[22px] md:px-5 md:py-3">
            <button type="button" onClick={() => scrollTo("inicio")} className="flex min-w-0 items-center gap-2.5 text-left md:gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center text-fuchsia-100 md:h-10 md:w-10">
                <ClouvaLogoMark size={34} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-black tracking-[.08em] md:text-[18px]">CLOUVA</span>
                <span className="hidden text-[9px] font-black uppercase tracking-[.22em] text-fuchsia-200/65 sm:inline-flex sm:items-center sm:gap-2">
                  <span className="h-px w-4 bg-fuchsia-300/45" /> Universo Gaming
                </span>
              </span>
            </button>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-fuchsia-300/20 bg-black/35 px-2.5 py-2 text-[10px] font-black sm:px-3 md:text-[11px]">
                <span className={"h-2.5 w-2.5 rounded-full shadow-[0_0_12px_currentColor] " + (status?.online ? "bg-emerald-400 text-emerald-400" : starting ? "bg-amber-300 text-amber-300" : "bg-white/30 text-white/30")} />
                <span className="hidden sm:inline">{status?.online ? "Servidor en línea" : starting ? "Prendiendo..." : "Servidor apagado"}</span>
                <span className="sm:hidden">{status?.online ? "Online" : starting ? "..." : "Offline"}</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-xl border border-fuchsia-300/20 bg-black/35 px-2.5 py-2 text-[10px] font-black text-white/85 sm:px-3 md:text-[11px]">
                <Users className="h-3.5 w-3.5 text-fuchsia-200" />
                <span>{onlineCount}</span>
                <span className="hidden sm:inline">jugadores</span>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="grid h-9 w-9 place-items-center rounded-xl border border-fuchsia-300/20 bg-black/35 text-white/65 transition hover:border-fuchsia-300/40 hover:bg-fuchsia-400/10 hover:text-white"
                aria-label="Actualizar estado"
              >
                <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} />
              </button>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-[980px] flex-1 flex-col items-center justify-center pb-2 pt-4 text-center sm:pt-5 md:pb-0 md:pt-3">
            <img
              src={ASSETS.logo}
              alt="Niños Rata Server"
              className="w-[min(88vw,430px)] select-none drop-shadow-[0_18px_48px_rgba(168,85,247,.40)] sm:w-[min(72vw,520px)] md:w-[min(46vw,610px)]"
              draggable={false}
            />

            <p className="-mt-1 text-[12px] font-black tracking-[.06em] text-white/90 drop-shadow-[0_2px_10px_rgba(0,0,0,.8)] sm:text-sm md:mt-0 md:text-[16px]">
              Más que un servidor, una banda.
            </p>
            <div className="mt-2 flex items-center gap-3 text-fuchsia-200/90">
              <span className="h-px w-10 bg-gradient-to-r from-transparent to-fuchsia-300/80 md:w-16" />
              <span className="text-lg leading-none">♕</span>
              <span className="h-px w-10 bg-gradient-to-l from-transparent to-fuchsia-300/80 md:w-16" />
            </div>

            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={starting}
              className="group relative mt-3 w-[min(92vw,560px)] transition duration-200 hover:scale-[1.018] hover:drop-shadow-[0_0_34px_rgba(217,70,239,.48)] active:scale-[.985] disabled:cursor-wait disabled:opacity-75 sm:mt-4 md:mt-3 md:w-[min(43vw,610px)]"
            >
              <img
                src={ASSETS.start}
                alt="Prender server"
                className="h-auto w-full select-none"
                draggable={false}
              />
              {starting ? (
                <span className="absolute inset-[8%_5%] grid place-items-center rounded-[20px] bg-[#12001f]/80 text-sm font-black uppercase tracking-[.12em] backdrop-blur-[2px] sm:text-base">
                  Prendiendo...
                </span>
              ) : null}
            </button>

            <div className="mt-1 min-h-5">
              {startError ? (
                <p className="rounded-full border border-rose-300/15 bg-black/55 px-3 py-1 text-[10px] text-rose-100 sm:text-xs">{startError}</p>
              ) : status?.online ? (
                <p className="text-[10px] font-black uppercase tracking-[.1em] text-emerald-300 sm:text-xs">Listo para entrar · {onlineCount}/{maxPlayers} online</p>
              ) : (
                <p className="text-[10px] font-bold text-white/55 sm:text-xs">Prendelo desde CLOUVA y entrá cuando quede online.</p>
              )}
            </div>

            <div className="mt-2 grid w-full max-w-[620px] grid-cols-2 gap-1.5 px-2 sm:max-w-[720px] sm:gap-2 md:mt-3 md:max-w-[820px] md:grid-cols-4 md:gap-2.5 md:px-0">
              <AssetButton src={ASSETS.inicio} alt="Inicio" onClick={() => scrollTo("inicio")} />
              <AssetButton src={ASSETS.mapa} alt="Mapa" onClick={() => scrollTo("mapa")} />
              <AssetButton src={ASSETS.jugadores} alt="Jugadores" onClick={() => scrollTo("jugadores")} />
              <Link
                href="/tienda"
                className="group relative overflow-hidden rounded-[24px] transition duration-200 hover:-translate-y-1 hover:drop-shadow-[0_0_24px_rgba(217,70,239,.35)] active:scale-[.98]"
              >
                <img src={ASSETS.tienda} alt="Tienda" className="h-auto w-full select-none object-contain" draggable={false} />
              </Link>
            </div>

            <button
              type="button"
              onClick={() => scrollTo("server-info")}
              className="mt-1.5 w-[132px] opacity-75 transition hover:opacity-100 sm:w-[150px] md:hidden"
            >
              <img src={ASSETS.mas} alt="Más" className="w-full" />
            </button>
          </div>

          <footer className="mx-auto flex w-full max-w-[860px] items-center justify-center gap-4 pb-1 pt-1 text-center text-[9px] font-black uppercase tracking-[.30em] text-white/55 md:text-[10px]">
            <span className="hidden h-px flex-1 bg-gradient-to-r from-transparent via-fuchsia-300/45 to-transparent sm:block" />
            <span>RATCRAFT&nbsp;&nbsp;×&nbsp;&nbsp;CLOUVA</span>
            <span className="hidden h-px flex-1 bg-gradient-to-r from-transparent via-fuchsia-300/45 to-transparent sm:block" />
          </footer>
        </div>
      </section>

      <section id="server-info" className="relative overflow-hidden border-t border-fuchsia-300/10 bg-[#08020f]">
        <div className="absolute inset-0 opacity-20">
          <img src={ASSETS.backgroundDesktop} alt="" className="h-full w-full object-cover blur-[2px]" />
        </div>
        <div className="absolute inset-0 bg-[#08020f]/88" />

        <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:py-14">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-fuchsia-300/15 bg-white/[.035] p-4 backdrop-blur-md">
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-200/45">Estado</p>
              <p className={"mt-2 text-2xl font-black " + (status?.online ? "text-emerald-300" : "text-white/60")}>
                {status?.online ? "ONLINE" : "OFFLINE"}
              </p>
            </div>
            <div className="rounded-2xl border border-fuchsia-300/15 bg-white/[.035] p-4 backdrop-blur-md">
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-200/45">Jugando ahora</p>
              <p className="mt-2 text-2xl font-black">{onlineCount} / {maxPlayers}</p>
            </div>
            <div className="rounded-2xl border border-fuchsia-300/15 bg-white/[.035] p-4 backdrop-blur-md">
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-200/45">Versión</p>
              <p className="mt-2 truncate text-lg font-black">{status?.version || "—"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-[26px] border border-fuchsia-300/15 bg-black/35 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-fuchsia-100"><Server className="h-5 w-5" /><b>Java</b></div>
              <div className="mt-3"><CopyValue value={javaAddress} label="Dirección" /></div>
            </div>
            <div className="rounded-[26px] border border-fuchsia-300/15 bg-black/35 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-fuchsia-100"><Smartphone className="h-5 w-5" /><b>Bedrock / Mobile</b></div>
              <div className="mt-3 grid gap-2">
                <CopyValue value={bedrockAddress} label="Servidor" />
                <CopyValue value={String(status?.bedrockPort ?? 19132)} label="Puerto" />
              </div>
            </div>
          </div>

          <div id="mapa" className="mt-5 scroll-mt-5 overflow-hidden rounded-[30px] border border-fuchsia-300/15 bg-black/40 shadow-[0_24px_80px_rgba(0,0,0,.35)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.22em] text-fuchsia-200/45">Ratcraft live</p>
                <h2 className="mt-1 text-xl font-black">Mapa en vivo</h2>
              </div>
              <div className="flex items-center gap-2">
                {spectatingPlayer ? (
                  <button
                    type="button"
                    onClick={() => setSpectatingUuid(null)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[.12em] text-rose-100"
                  >
                    <X className="h-3.5 w-3.5" /> Soltar {spectatingPlayer.name}
                  </button>
                ) : null}
                {status?.mapUrl ? (
                  <a href={status.mapUrl} target="_blank" rel="noreferrer" className="rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[.12em] text-fuchsia-100">
                    Abrir completo ↗
                  </a>
                ) : null}
              </div>
            </div>
            {status?.mapUrl ? (
              <iframe
                ref={mapFrameRef}
                title="Mapa Minecraft"
                src={status.mapUrl}
                className="h-[62vh] min-h-[440px] w-full border-0 bg-black"
                allow="fullscreen"
              />
            ) : (
              <div className="grid h-[440px] place-items-center px-6 text-center text-sm text-white/40">
                El mapa se activa cuando BlueMap está disponible.
              </div>
            )}
          </div>

          <div id="jugadores" className="mt-5 scroll-mt-5 grid gap-4 lg:grid-cols-[.72fr_1.28fr]">
            <div className="rounded-[30px] border border-fuchsia-300/15 bg-black/40 p-5">
              <div className="flex items-center gap-2"><Users className="h-5 w-5 text-fuchsia-200" /><h2 className="font-black">Mi personaje</h2></div>
              {myIdentity ? (
                <div className="mt-4">
                  <div className="relative mx-auto flex min-h-[300px] max-w-[250px] items-end justify-center overflow-hidden rounded-[26px] border border-fuchsia-300/15 bg-[radial-gradient(circle_at_50%_75%,rgba(217,70,239,.16),transparent_48%),rgba(0,0,0,.28)] px-4 pt-5">
                    <img
                      src={playerBodyUrl(myIdentity)}
                      alt={"Skin Minecraft de " + myIdentity.name}
                      className="relative z-10 max-h-[285px] w-auto select-none object-contain [image-rendering:pixelated]"
                      draggable={false}
                      onError={(event) => {
                        if (myLivePlayer?.headUrl) event.currentTarget.src = myLivePlayer.headUrl;
                      }}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-black">{myIdentity.name}</p>
                      <p className="mt-1 text-xs text-white/40">
                        {myLivePlayer ? myLivePlayer.worldId + " · " + rounded(myLivePlayer.x) + ", " + rounded(myLivePlayer.y) + ", " + rounded(myLivePlayer.z) : "Offline"}
                      </p>
                    </div>
                    {myLivePlayer ? (
                      <button
                        type="button"
                        onClick={() => startSpectating(myLivePlayer)}
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-fuchsia-500 px-3 py-2 text-[11px] font-black text-white"
                      >
                        <Eye className="h-4 w-4" /> Seguir
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-white/45">
                  Elegí tu nombre en Jugadores y tocá <b className="text-white">Este soy yo</b>.
                </p>
              )}
            </div>

            <div className="rounded-[30px] border border-fuchsia-300/15 bg-black/40 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-200/45">Banda en vivo</p>
                  <h2 className="mt-1 text-xl font-black">Jugadores</h2>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[.035] px-3 py-1.5 text-xs text-white/50">{livePlayers.length} online</span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {livePlayers.length ? livePlayers.map((player) => {
                  const mine = player.uuid === myIdentity?.uuid;
                  const watching = player.uuid === spectatingUuid;
                  const selected = player.uuid === selectedUuid;
                  return (
                    <div
                      key={player.uuid}
                      className={"rounded-2xl border p-3 transition " + (selected ? "border-fuchsia-300/30 bg-fuchsia-400/[.08]" : "border-white/[.07] bg-white/[.025]")}
                    >
                      <button type="button" onClick={() => setSelectedUuid(player.uuid)} className="flex w-full items-center gap-3 text-left">
                        <img src={player.headUrl} alt="" className="h-11 w-11 rounded-lg border border-white/10 bg-black/30 [image-rendering:pixelated]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-black">{player.name}</span>
                            {mine ? <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] text-emerald-300">vos</span> : null}
                          </span>
                          <span className="mt-1 block truncate text-[10px] text-white/35">{player.worldId} · {rounded(player.x)}, {rounded(player.y)}, {rounded(player.z)}</span>
                        </span>
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      </button>

                      {selected ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[.06] pt-3">
                          <button
                            type="button"
                            onClick={() => saveAsMine(player)}
                            className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-[10px] font-black uppercase tracking-[.1em] text-white/70"
                          >
                            {mine ? "Mi PJ ✓" : "Este soy yo"}
                          </button>
                          <button
                            type="button"
                            onClick={() => watching ? setSpectatingUuid(null) : startSpectating(player)}
                            className={"inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[.1em] " + (watching ? "bg-rose-400 text-black" : "bg-fuchsia-500 text-white")}
                          >
                            <Video className="h-3.5 w-3.5" /> {watching ? "Siguiendo" : "Espectear"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                }) : (
                  <div className="sm:col-span-2 rounded-2xl border border-white/[.06] bg-white/[.025] p-5 text-sm text-white/40">
                    {liveError || (status?.online ? "BlueMap está sincronizando jugadores..." : "No hay jugadores conectados.")}
                  </div>
                )}
              </div>

              {selectedPlayer && selectedPlayer.uuid !== myIdentity?.uuid ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-400/[.06] p-3">
                  <div className="min-w-0">
                    <p className="truncate font-black">{selectedPlayer.name}</p>
                    <p className="mt-1 text-[10px] text-white/40">Jugador seleccionado</p>
                  </div>
                  <button type="button" onClick={() => startSpectating(selectedPlayer)} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-500 px-3 py-2 text-[10px] font-black uppercase tracking-[.1em]">
                    <Eye className="h-3.5 w-3.5" /> Ver
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <footer className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-white/[.07] pt-6 text-center sm:flex-row sm:text-left">
            <div>
              <p className="font-black tracking-[.22em]">RATCRAFT × CLOUVA</p>
              <p className="mt-1 text-[10px] uppercase tracking-[.24em] text-white/30">Una comunidad, infinitas aventuras</p>
            </div>
            <button type="button" onClick={() => scrollTo("inicio")} className="text-xs font-bold text-fuchsia-200/65 hover:text-fuchsia-100">Volver arriba ↑</button>
          </footer>
        </div>
      </section>
    </main>
  );
}
