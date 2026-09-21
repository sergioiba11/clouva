"use client";

import Link from "next/link";
import {
  Activity,
  Check,
  Copy,
  Crosshair,
  Eye,
  Gamepad2,
  Map,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Swords,
  UserRound,
  Users,
  Video,
} from "lucide-react";
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

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left transition hover:border-emerald-300/30 hover:bg-white/[0.04]"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{label}</span>
        <span className="mt-1 block truncate font-mono text-sm font-semibold text-white">{value}</span>
      </span>
      {copied ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5 text-white/45" />}
    </button>
  );
}

function rounded(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function playerBodyUrl(player: Pick<LiveMinecraftPlayer, "uuid" | "name"> | SavedMinecraftIdentity) {
  const identity = player.uuid || player.name;
  return `https://mc-heads.net/body/${encodeURIComponent(identity)}/260`;
}

function buildMapFocusHash(player: LiveMinecraftPlayer) {
  const distance = 95;
  const rotation = ((player.yaw || 0) * Math.PI) / 180;
  const angle = 1.05;
  return `#${player.worldId}:${rounded(player.x)}:${rounded(player.y)}:${rounded(player.z)}:${distance}:${rotation.toFixed(2)}:${angle}:0:0:perspective`;
}

export default function MinecraftFamilyPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<MinecraftStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [livePlayers, setLivePlayers] = useState<LiveMinecraftPlayer[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [myIdentity, setMyIdentity] = useState<SavedMinecraftIdentity | null>(null);
  const [spectatingUuid, setSpectatingUuid] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const mapFrameRef = useRef<HTMLIFrameElement | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/minecraft/status", { cache: "no-store" });
      setStatus(await r.json());
    } catch {
      setStatus({
        configured: false,
        online: false,
        host: null,
        javaPort: 25565,
        bedrockPort: 19132,
        error: "No se pudo consultar el servidor.",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadLivePlayers = useCallback(async () => {
    try {
      const settingsResponse = await fetch(`${MAP_ROOT}/settings.json`, { cache: "no-store" });
      if (!settingsResponse.ok) throw new Error("BlueMap settings no disponible");

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
              `${MAP_ROOT}/${liveRoot}/${encodeURIComponent(worldId)}/live/players.json?t=${Date.now()}`,
              { cache: "no-store" },
            );
            if (!response.ok) return [] as LiveMinecraftPlayer[];
            const data = (await response.json()) as { players?: BlueMapPlayer[] };
            if (!Array.isArray(data.players)) return [];

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
                headUrl: `${MAP_ROOT}/maps/${encodeURIComponent(worldId)}/assets/playerheads/${player.uuid}.png`,
              }));
          } catch {
            return [] as LiveMinecraftPlayer[];
          }
        }),
      );

      const byUuid = new Map<string, LiveMinecraftPlayer>();
      snapshots.flat().forEach((player) => byUuid.set(player.uuid, player));
      const nextPlayers = Array.from(byUuid.values()).sort((a, b) => a.name.localeCompare(b.name));
      setLivePlayers(nextPlayers);
      setLiveError(null);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "No se pudo leer la posición de los jugadores.");
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
    const i = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(i);
  }, [load, user]);

  useEffect(() => {
    if (!user || !status?.online) return;
    void loadLivePlayers();
    const i = window.setInterval(() => void loadLivePlayers(), LIVE_REFRESH_MS);
    return () => window.clearInterval(i);
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
      // Ignore an invalid local identity and let the player choose again.
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
      const base = status?.mapUrl || `${MAP_ROOT}/index.html`;
      mapFrameRef.current.src = `${base.split("#")[0]}${buildMapFocusHash(spectatingPlayer)}`;
    }
  }, [spectatingPlayer, status?.mapUrl]);

  const javaAddress = status?.publicJavaHost || (status?.host ? `${status.host}:${status.javaPort}` : "Preparando servidor");
  const bedrockAddress = status?.publicBedrockHost || status?.host || "Preparando servidor";
  const playerSummary = useMemo(
    () => (status?.players ? `${status.players.online} / ${status.players.max}` : "—"),
    [status],
  );

  const saveAsMine = (player: LiveMinecraftPlayer) => {
    const identity = { uuid: player.uuid, name: player.name };
    window.localStorage.setItem(MINECRAFT_IDENTITY_KEY, JSON.stringify(identity));
    setMyIdentity(identity);
    setSelectedUuid(player.uuid);
  };

  const startSpectating = (player: LiveMinecraftPlayer) => {
    setSelectedUuid(player.uuid);
    setSpectatingUuid(player.uuid);
  };

  const stopSpectating = () => setSpectatingUuid(null);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#050607] text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 text-sm text-white/45">Cargando Minecraft…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-[#050607] text-white">
        <div className="mx-auto max-w-xl px-5 py-20 text-center">
          <Gamepad2 className="mx-auto h-10 w-10 text-emerald-300" />
          <h1 className="mt-5 text-3xl font-black">Minecraft</h1>
          <p className="mt-3 text-sm text-white/50">Entrá a CLOUVA para abrir el panel del server.</p>
          <Link href="/login" className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black">
            Entrar
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,.12),_transparent_34%),#050607] text-white">
      <div className="mx-auto w-full max-w-7xl px-4 pb-20 pt-8 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300/80">
              <Gamepad2 className="h-4 w-4" /> CLOUVA · NIÑOS RATA
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-[-.04em] sm:text-5xl">Control del server</h1>
            <p className="mt-2 text-sm text-white/45">Jugadores, personajes, mapa y cámara en vivo desde CLOUVA.</p>
          </div>
          <button
            onClick={() => {
              void load();
              void loadLivePlayers();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.035] px-4 py-2.5 text-xs font-semibold text-white/65"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
            <Activity className="h-5 w-5 text-emerald-300" />
            <p className="mt-4 text-2xl font-black">{status?.online ? "ONLINE" : "OFFLINE"}</p>
            <p className="text-xs text-white/35">Estado</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
            <Users className="h-5 w-5 text-sky-300" />
            <p className="mt-4 text-2xl font-black">{playerSummary}</p>
            <p className="text-xs text-white/35">Jugadores</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
            <Server className="h-5 w-5 text-violet-300" />
            <p className="mt-4 text-2xl font-black">{status?.latencyMs != null ? `${status.latencyMs} ms` : "—"}</p>
            <p className="text-xs text-white/35">Respuesta</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[.035] p-4">
            <Swords className="h-5 w-5 text-amber-300" />
            <p className="mt-4 truncate text-lg font-black">{status?.version || "—"}</p>
            <p className="text-xs text-white/35">Paper / versión</p>
          </div>
        </section>

        <section className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_.75fr]">
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#090c0a]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.07] px-5 py-4">
              <div className="flex items-center gap-2">
                <Map className="h-5 w-5 text-emerald-300" />
                <b>Mapa en vivo</b>
                {spectatingPlayer ? (
                  <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] text-rose-200">
                    REC · siguiendo {spectatingPlayer.name}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {spectatingPlayer ? (
                  <button onClick={stopSpectating} className="text-xs font-semibold text-white/55 hover:text-white">
                    Soltar cámara
                  </button>
                ) : null}
                {status?.mapUrl ? (
                  <a href={status.mapUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-300">
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
                className="h-[58vh] min-h-[430px] w-full border-0"
                allow="fullscreen"
              />
            ) : (
              <div className="flex h-[430px] items-center justify-center px-6 text-center text-sm text-white/35">
                BlueMap está instalado; falta publicar su URL para incrustarlo acá.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_50%_10%,rgba(74,222,128,.14),transparent_38%),#090c0a]">
              <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-4">
                <div className="flex items-center gap-2">
                  <UserRound className="h-5 w-5 text-emerald-300" />
                  <h2 className="font-bold">Mi personaje</h2>
                </div>
                {myLivePlayer ? (
                  <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.16em] text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> online
                  </span>
                ) : null}
              </div>

              {myIdentity ? (
                <div className="p-5">
                  <div className="relative mx-auto flex min-h-[300px] max-w-[230px] items-end justify-center overflow-hidden rounded-[26px] border border-white/[.08] bg-black/30 px-4 pt-5">
                    <div className="absolute inset-x-8 bottom-4 h-10 rounded-[100%] bg-emerald-300/10 blur-xl" />
                    <img
                      src={playerBodyUrl(myIdentity)}
                      alt={`Skin Minecraft de ${myIdentity.name}`}
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
                      {myLivePlayer ? (
                        <p className="mt-1 text-xs text-white/40">
                          {myLivePlayer.worldId} · X {rounded(myLivePlayer.x)} · Y {rounded(myLivePlayer.y)} · Z {rounded(myLivePlayer.z)}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-white/35">Tu skin queda vinculada aunque estés fuera del server.</p>
                      )}
                    </div>
                    {myLivePlayer ? (
                      <button
                        onClick={() => startSpectating(myLivePlayer)}
                        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-400 px-3 py-2 text-[11px] font-black text-black"
                      >
                        <Eye className="h-4 w-4" /> Seguir
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="p-5 text-sm leading-6 text-white/45">
                  Elegí tu nombre en <b className="text-white/75">Conectados ahora</b> y tocá <b className="text-white/75">Este soy yo</b>. CLOUVA va a guardar tu identidad Minecraft en este dispositivo.
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#090c0a] p-5">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-sky-300" />
                <h2 className="font-bold">Conectados ahora</h2>
              </div>
              <div className="mt-4 space-y-2">
                {livePlayers.length ? (
                  livePlayers.map((player) => {
                    const selected = player.uuid === selectedUuid;
                    const mine = player.uuid === myIdentity?.uuid;
                    const watching = player.uuid === spectatingUuid;
                    return (
                      <div
                        key={player.uuid}
                        className={`rounded-2xl border p-3 transition ${
                          selected ? "border-emerald-300/30 bg-emerald-300/[.06]" : "border-white/[.07] bg-white/[.025]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedUuid(player.uuid)}
                          className="flex w-full items-center gap-3 text-left"
                        >
                          <img
                            src={player.headUrl}
                            alt=""
                            className="h-10 w-10 rounded-lg border border-white/10 bg-black/30 [image-rendering:pixelated]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-semibold">{player.name}</span>
                              {mine ? (
                                <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-[.12em] text-emerald-300">
                                  vos
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-1 block truncate text-[10px] text-white/35">
                              {player.worldId} · {rounded(player.x)}, {rounded(player.y)}, {rounded(player.z)}
                            </span>
                          </span>
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                        </button>

                        {selected ? (
                          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[.06] pt-3">
                            <button
                              onClick={() => saveAsMine(player)}
                              className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-[10px] font-black uppercase tracking-[.12em] text-white/70 hover:bg-white/[.07]"
                            >
                              {mine ? "Mi PJ ✓" : "Este soy yo"}
                            </button>
                            <button
                              onClick={() => (watching ? stopSpectating() : startSpectating(player))}
                              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[.12em] ${
                                watching ? "bg-rose-400 text-black" : "bg-emerald-400 text-black"
                              }`}
                            >
                              <Video className="h-3.5 w-3.5" /> {watching ? "Siguiendo" : "Espectear"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-white/35">
                    {liveError || (status?.players?.online ? "BlueMap está sincronizando las posiciones…" : "No hay jugadores conectados.")}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#090c0a] p-5">
              <div className="flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-rose-300" />
                <h2 className="font-bold">Cámara de contenido</h2>
              </div>
              <p className="mt-2 text-xs leading-5 text-white/40">
                Espectear fija el mapa 3D sobre un jugador y actualiza su posición en vivo. Sirve para tomas aéreas, seguimiento y grabación desde CLOUVA sin darle permisos de OP al jugador.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#090c0a] p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
              <h2 className="mt-3 font-bold">Administración</h2>
              <p className="mt-2 text-xs leading-5 text-white/40">
                Preparado para acciones del bridge seguro: teleport, hub, kick, anuncios, arenas y eventos. No se exponen comandos RCON al navegador.
              </p>
            </div>
          </div>
        </section>

        {selectedPlayer && selectedPlayer.uuid !== myIdentity?.uuid ? (
          <section className="mt-4 rounded-[28px] border border-white/[.08] bg-black/25 p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
              <div className="flex min-h-[190px] items-end justify-center overflow-hidden rounded-2xl border border-white/[.07] bg-white/[.025]">
                <img
                  src={playerBodyUrl(selectedPlayer)}
                  alt={`Personaje Minecraft de ${selectedPlayer.name}`}
                  className="max-h-[190px] w-auto select-none object-contain [image-rendering:pixelated]"
                  draggable={false}
                  onError={(event) => {
                    event.currentTarget.src = selectedPlayer.headUrl;
                  }}
                />
              </div>
              <div className="flex flex-col justify-center">
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-white/35">Jugador seleccionado</p>
                <h3 className="mt-2 text-2xl font-black">{selectedPlayer.name}</h3>
                <p className="mt-2 text-sm text-white/45">
                  {selectedPlayer.worldId} · X {rounded(selectedPlayer.x)} · Y {rounded(selectedPlayer.y)} · Z {rounded(selectedPlayer.z)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => startSpectating(selectedPlayer)}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-black text-black"
                  >
                    <Eye className="h-4 w-4" /> Espectear en mapa
                  </button>
                  <button
                    onClick={() => saveAsMine(selectedPlayer)}
                    className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-xs font-bold text-white/70"
                  >
                    Este soy yo
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/[.07] bg-black/25 p-4">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-emerald-300" />
              <b>Java</b>
            </div>
            <div className="mt-3">
              <CopyValue value={javaAddress} label="Dirección" />
            </div>
          </div>
          <div className="rounded-2xl border border-white/[.07] bg-black/25 p-4">
            <div className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-sky-300" />
              <b>Bedrock</b>
            </div>
            <div className="mt-3 grid gap-2">
              <CopyValue value={bedrockAddress} label="Servidor" />
              <CopyValue value={String(status?.bedrockPort ?? 19132)} label="Puerto" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
