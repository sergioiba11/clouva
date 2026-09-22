"use client";

import Link from "next/link";
import { Check, Copy, Eye, RefreshCw, Server, Smartphone, Users, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";

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
  background: ASSET_ROOT + "/ratcraft_background_mobile_vertical.png",
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
        <img src={ASSETS.background} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
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
      <section id="inicio" className="relative min-h-[100svh] overflow-hidden">
        <img
          src={ASSETS.background}
          alt=""
          className="absolute inset-0 h-full w-full scale-[1.03] object-cover object-center md:object-[50%_48%]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,0,12,.52)_0%,rgba(5,0,12,.04)_24%,rgba(5,0,12,.18)_58%,rgba(5,0,12,.92)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(168,85,247,.04),transparent_52%)]" />

        <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[1500px] flex-col px-3 pb-8 pt-3 sm:px-5 md:px-8 md:pt-5">
          <header className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#090311]/70 px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,.24)] backdrop-blur-xl md:px-5">
            <button type="button" onClick={() => scrollTo("inicio")} className="flex items-center gap-3 text-left">
              <div className="grid h-10 w-10 place-items-center rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 text-xl font-black">C</div>
              <div>
                <p className="text-base font-black tracking-[.12em] md:text-lg">CLOUVA</p>
                <p className="hidden text-[9px] font-bold uppercase tracking-[.26em] text-fuchsia-200/45 sm:block">Universo Gaming</p>
              </div>
            </button>

            <div className="flex items-center gap-2">
              <div className="hidden rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-right sm:block">
                <p className={"text-[11px] font-black " + (status?.online ? "text-emerald-300" : "text-white/55")}>
                  {status?.online ? "● Servidor en línea" : starting ? "● Prendiendo..." : "○ Servidor apagado"}
                </p>
                <p className="mt-0.5 text-[10px] text-white/40">{onlineCount} jugadores</p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/30 text-white/65 transition hover:border-fuchsia-300/25 hover:text-white"
                aria-label="Actualizar estado"
              >
                <RefreshCw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")} />
              </button>
            </div>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center pb-3 pt-8 text-center md:pt-12">
            <img
              src={ASSETS.logo}
              alt="Niños Rata Server"
              className="w-[min(92vw,720px)] select-none drop-shadow-[0_22px_60px_rgba(168,85,247,.35)] md:w-[min(58vw,760px)]"
              draggable={false}
            />
            <p className="mt-2 text-sm font-black uppercase tracking-[.12em] text-white/75 drop-shadow-lg sm:text-base md:text-lg">
              Más que un servidor, una banda.
            </p>

            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={starting}
              className="group relative mt-5 w-[min(94vw,650px)] transition duration-200 hover:scale-[1.018] active:scale-[.985] disabled:cursor-wait disabled:opacity-70 md:mt-7"
            >
              <img
                src={ASSETS.start}
                alt="Prender server"
                className="h-auto w-full select-none drop-shadow-[0_0_30px_rgba(217,70,239,.44)]"
                draggable={false}
              />
              {starting ? (
                <span className="absolute inset-0 grid place-items-center rounded-[24px] bg-[#130022]/68 text-lg font-black uppercase tracking-[.1em] backdrop-blur-[2px]">
                  Prendiendo...
                </span>
              ) : null}
            </button>

            <div className="mt-3 min-h-6">
              {startError ? <p className="rounded-full border border-rose-300/15 bg-black/40 px-4 py-1.5 text-xs text-rose-100">{startError}</p> : null}
              {!startError && status?.online ? <p className="text-xs font-bold text-emerald-300">Servidor online · tocá el botón para ver cómo entrar</p> : null}
            </div>

            <div className="mt-5 grid w-full max-w-[900px] grid-cols-2 gap-2.5 sm:grid-cols-4 md:gap-3">
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

            <button type="button" onClick={() => scrollTo("server-info")} className="mt-4 w-[min(42vw,180px)] opacity-75 transition hover:opacity-100 sm:hidden">
              <img src={ASSETS.mas} alt="Más" className="w-full" />
            </button>
          </div>
        </div>
      </section>

      <section id="server-info" className="relative overflow-hidden border-t border-fuchsia-300/10 bg-[#08020f]">
        <div className="absolute inset-0 opacity-20">
          <img src={ASSETS.background} alt="" className="h-full w-full object-cover blur-[2px]" />
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
