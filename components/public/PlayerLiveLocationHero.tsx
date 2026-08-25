"use client";

import { LocateFixed, Radio, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

type LiveLocationRow = {
  player_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  is_enabled: boolean;
  updated_at: string;
};

type PlayerLiveLocationHeroProps = {
  playerId: string;
  ownerUserId: string | null;
  coverUrl: string;
};

const LIVE_FRESH_MS = 2 * 60 * 1000;
const WRITE_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 45_000;
const POLL_INTERVAL_MS = 30_000;
const TILE_SIZE = 256;
const MAP_ZOOM = 5;

function isFresh(row: LiveLocationRow | null) {
  if (!row?.is_enabled) return false;
  const timestamp = new Date(row.updated_at).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < LIVE_FRESH_MS;
}

function finiteOrNull(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatFreshness(updatedAt: string) {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000));
  if (ageSeconds < 15) return "Actualizado ahora";
  if (ageSeconds < 60) return `Actualizado hace ${ageSeconds} s`;
  return `Actualizado hace ${Math.floor(ageSeconds / 60)} min`;
}

function longitudeToTileX(longitude: number, zoom: number) {
  return ((longitude + 180) / 360) * 2 ** zoom;
}

function latitudeToTileY(latitude: number, zoom: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = (clamped * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * 2 ** zoom;
}

function LiveMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const tiles = useMemo(() => {
    const worldTiles = 2 ** MAP_ZOOM;
    const centerX = longitudeToTileX(longitude, MAP_ZOOM);
    const centerY = latitudeToTileY(latitude, MAP_ZOOM);
    const result: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];

    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        const rawX = Math.floor(centerX) + dx;
        const rawY = Math.floor(centerY) + dy;
        if (rawY < 0 || rawY >= worldTiles) continue;
        const wrappedX = ((rawX % worldTiles) + worldTiles) % worldTiles;
        result.push({
          key: `${rawX}:${rawY}`,
          x: wrappedX,
          y: rawY,
          left: (rawX - centerX) * TILE_SIZE,
          top: (rawY - centerY) * TILE_SIZE,
        });
      }
    }

    return result;
  }, [latitude, longitude]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#02070c]">
      <div
        className="absolute inset-0 opacity-90"
        style={{ filter: "grayscale(1) sepia(.22) hue-rotate(145deg) saturate(1.9) brightness(.42) contrast(1.25)" }}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={`https://tile.openstreetmap.org/${MAP_ZOOM}/${tile.x}/${tile.y}.png`}
            alt=""
            draggable={false}
            className="absolute h-64 w-64 max-w-none select-none"
            style={{ left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)` }}
          />
        ))}
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,196,255,.08),rgba(2,7,12,.08)_30%,rgba(2,7,12,.72)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#07060b_0%,rgba(7,6,11,.78)_31%,rgba(4,13,20,.16)_67%,#07060b_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,#07060b_0%,transparent_58%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(0,210,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(0,210,255,.16)_1px,transparent_1px)] [background-size:64px_64px]" />

      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2">
        <span className="absolute inset-0 animate-ping rounded-full border border-cyan-300/35 bg-cyan-400/10 [animation-duration:2s]" />
        <span className="absolute inset-5 animate-ping rounded-full border border-cyan-300/45 bg-cyan-400/10 [animation-delay:.55s] [animation-duration:2s]" />
        <span className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/70 bg-cyan-400/20 shadow-[0_0_34px_12px_rgba(34,211,238,.38)]" />
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-300 shadow-[0_0_18px_7px_rgba(34,211,238,.9)]" />
        <span className="absolute left-[calc(50%+30px)] top-[calc(50%-13px)] whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200 drop-shadow-[0_0_8px_rgba(34,211,238,.8)]">
          GPS LIVE
        </span>
      </div>

      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="pointer-events-auto absolute bottom-2 right-3 text-[8px] text-white/35 transition hover:text-white/60"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

export function PlayerLiveLocationHero({ playerId, ownerUserId, coverUrl }: PlayerLiveLocationHeroProps) {
  const { user } = useAuth();
  const isOwner = Boolean(user && ownerUserId && user.id === ownerUserId);
  const [row, setRow] = useState<LiveLocationRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [publishEnabled, setPublishEnabled] = useState(false);
  const [geoState, setGeoState] = useState<"idle" | "requesting" | "live" | "error">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [, setClock] = useState(0);
  const latestPositionRef = useRef<GeolocationPosition | null>(null);
  const lastWriteAtRef = useRef(0);
  const initializedOwnerStateRef = useRef(false);

  const fetchLocation = useCallback(async () => {
    const { data, error } = await supabase
      .from("player_live_locations")
      .select("player_id,latitude,longitude,accuracy_m,altitude_m,heading_deg,speed_mps,is_enabled,updated_at")
      .eq("player_id", playerId)
      .maybeSingle();

    if (!error) setRow((data as LiveLocationRow | null) ?? null);
    setLoaded(true);
  }, [playerId]);

  useEffect(() => {
    initializedOwnerStateRef.current = false;
    void fetchLocation();
  }, [fetchLocation, isOwner]);

  useEffect(() => {
    if (!isOwner || !loaded || initializedOwnerStateRef.current) return;
    initializedOwnerStateRef.current = true;
    setPublishEnabled(Boolean(row?.is_enabled));
  }, [isOwner, loaded, row?.is_enabled]);

  useEffect(() => {
    const channel = supabase
      .channel(`player-live-location:${playerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_live_locations", filter: `player_id=eq.${playerId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setRow(null);
            return;
          }
          const next = payload.new as LiveLocationRow;
          if (next?.player_id === playerId) setRow(next);
        },
      )
      .subscribe();

    const poll = window.setInterval(() => void fetchLocation(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [fetchLocation, playerId]);

  useEffect(() => {
    const tick = window.setInterval(() => setClock((value) => value + 1), 15_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!isOwner || !publishEnabled) return;

    if (!("geolocation" in navigator)) {
      setGeoState("error");
      setGeoError("Este dispositivo no ofrece ubicación GPS al navegador.");
      setPublishEnabled(false);
      return;
    }

    let cancelled = false;
    setGeoState("requesting");
    setGeoError(null);

    const persistPosition = async (position: GeolocationPosition, force = false) => {
      if (cancelled) return;
      const now = Date.now();
      if (!force && now - lastWriteAtRef.current < WRITE_INTERVAL_MS) return;
      lastWriteAtRef.current = now;

      const coords = position.coords;
      const optimistic: LiveLocationRow = {
        player_id: playerId,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_m: finiteOrNull(coords.accuracy),
        altitude_m: finiteOrNull(coords.altitude),
        heading_deg: finiteOrNull(coords.heading),
        speed_mps: finiteOrNull(coords.speed),
        is_enabled: true,
        updated_at: new Date().toISOString(),
      };
      setRow(optimistic);
      setGeoState("live");

      const { data, error } = await supabase
        .from("player_live_locations")
        .upsert(
          {
            player_id: playerId,
            latitude: optimistic.latitude,
            longitude: optimistic.longitude,
            accuracy_m: optimistic.accuracy_m,
            altitude_m: optimistic.altitude_m,
            heading_deg: optimistic.heading_deg,
            speed_mps: optimistic.speed_mps,
            is_enabled: true,
          },
          { onConflict: "player_id" },
        )
        .select("player_id,latitude,longitude,accuracy_m,altitude_m,heading_deg,speed_mps,is_enabled,updated_at")
        .single();

      if (cancelled) return;
      if (error) {
        setGeoState("error");
        setGeoError("No pude publicar la ubicación en vivo.");
        return;
      }
      setRow(data as LiveLocationRow);
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        latestPositionRef.current = position;
        void persistPosition(position);
      },
      (error) => {
        if (cancelled) return;
        setGeoState("error");
        setGeoError(error.code === error.PERMISSION_DENIED ? "Necesito permiso de ubicación para encender el punto en vivo." : "No pude obtener la ubicación GPS.");
        if (error.code === error.PERMISSION_DENIED) {
          setPublishEnabled(false);
          void supabase.from("player_live_locations").update({ is_enabled: false }).eq("player_id", playerId);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );

    const heartbeat = window.setInterval(() => {
      if (latestPositionRef.current) void persistPosition(latestPositionRef.current, true);
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(heartbeat);
    };
  }, [isOwner, playerId, publishEnabled]);

  const turnOff = useCallback(async () => {
    setPublishEnabled(false);
    setGeoState("idle");
    setGeoError(null);
    latestPositionRef.current = null;
    setRow((current) => (current ? { ...current, is_enabled: false, updated_at: new Date().toISOString() } : current));
    await supabase.from("player_live_locations").update({ is_enabled: false }).eq("player_id", playerId);
  }, [playerId]);

  const toggle = useCallback(() => {
    if (!isOwner) return;
    if (publishEnabled) {
      void turnOff();
      return;
    }
    lastWriteAtRef.current = 0;
    setGeoError(null);
    setGeoState("requesting");
    setPublishEnabled(true);
  }, [isOwner, publishEnabled, turnOff]);

  const liveRow = isFresh(row) ? row : null;
  const freshness = liveRow ? formatFreshness(liveRow.updated_at) : null;
  const accuracy = liveRow?.accuracy_m != null ? Math.round(liveRow.accuracy_m) : null;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        {liveRow ? (
          <LiveMap latitude={liveRow.latitude} longitude={liveRow.longitude} />
        ) : (
          <>
            <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${coverUrl})` }} />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,#07060b_0%,rgba(7,6,11,.94)_35%,rgba(7,6,11,.28)_70%,#07060b_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,#07060b_0%,transparent_50%)]" />
          </>
        )}
      </div>

      {(isOwner || liveRow) ? (
        <div className="absolute right-4 top-4 z-30 flex max-w-[calc(100%-2rem)] flex-col items-end gap-2 sm:right-6 sm:top-6">
          {isOwner ? (
            <button
              type="button"
              role="switch"
              aria-checked={publishEnabled}
              onClick={toggle}
              className={`pointer-events-auto flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left shadow-2xl backdrop-blur-xl transition ${
                publishEnabled
                  ? "border-cyan-300/35 bg-[#06151d]/88 text-cyan-100"
                  : "border-white/12 bg-[#0c0b16]/88 text-white/72 hover:border-violet-400/35"
              }`}
            >
              <span className={`grid h-9 w-9 place-items-center rounded-xl ${publishEnabled ? "bg-cyan-400/15 text-cyan-300" : "bg-white/[0.05] text-white/45"}`}>
                {geoState === "error" ? <WifiOff size={17} /> : <LocateFixed size={17} />}
              </span>
              <span className="min-w-0">
                <b className="block text-xs">Ubicación en vivo</b>
                <small className="block truncate text-[10px] text-white/45">
                  {liveRow ? freshness : publishEnabled ? "Buscando tu GPS…" : "Desactivada"}
                  {accuracy != null && liveRow ? ` · ±${accuracy} m` : ""}
                </small>
              </span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${publishEnabled ? "bg-cyan-400" : "bg-white/15"}`}>
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${publishEnabled ? "left-6" : "left-1"}`} />
              </span>
            </button>
          ) : liveRow ? (
            <div className="flex items-center gap-2 rounded-full border border-cyan-300/25 bg-[#04131b]/82 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200 shadow-xl backdrop-blur-xl">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300" />
              </span>
              <Radio size={13} /> En vivo · {freshness}
            </div>
          ) : null}

          {isOwner && geoError ? (
            <p className="pointer-events-auto max-w-xs rounded-xl border border-amber-300/20 bg-black/80 px-3 py-2 text-[10px] leading-4 text-amber-100/80 backdrop-blur-xl">
              {geoError}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
