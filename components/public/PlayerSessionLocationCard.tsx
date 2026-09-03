"use client";

import { LocateFixed, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { PlayerLocationMap } from "./PlayerLocationMap";

type SessionCoordinates = {
  latitude: number;
  longitude: number;
};

type LiveLocationState = "idle" | "prompt" | "locating" | "live" | "denied" | "unavailable";

export function PlayerSessionLocationCard({
  ownerUserId,
  latitude,
  longitude,
  label,
  accent,
}: {
  ownerUserId: string | null;
  latitude: number | null;
  longitude: number | null;
  label: string;
  accent?: string | null;
}) {
  const { user } = useAuth();
  const isOwner = Boolean(user && ownerUserId && user.id === ownerUserId);
  const watchIdRef = useRef<number | null>(null);
  const [sessionCoordinates, setSessionCoordinates] = useState<SessionCoordinates | null>(null);
  const [state, setState] = useState<LiveLocationState>("idle");

  const stopWatching = useCallback(() => {
    if (typeof navigator !== "undefined" && watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const startWatching = useCallback(() => {
    if (!isOwner || typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    if (watchIdRef.current !== null) return;

    setState("locating");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setSessionCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setState("live");
      },
      (error) => {
        stopWatching();
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      {
        enableHighAccuracy: false,
        maximumAge: 15_000,
        timeout: 12_000,
      },
    );
  }, [isOwner, stopWatching]);

  useEffect(() => {
    if (!isOwner) {
      stopWatching();
      setSessionCoordinates(null);
      setState("idle");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }

    let cancelled = false;
    if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: "geolocation" }).then((permission) => {
        if (cancelled) return;
        if (permission.state === "granted") startWatching();
        else setState(permission.state === "denied" ? "denied" : "prompt");
      }).catch(() => {
        if (!cancelled) setState("prompt");
      });
    } else {
      setState("prompt");
    }

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [isOwner, startWatching, stopWatching]);

  const isLive = Boolean(isOwner && sessionCoordinates && state === "live");
  const mapLatitude = isLive ? sessionCoordinates?.latitude ?? null : latitude;
  const mapLongitude = isLive ? sessionCoordinates?.longitude ?? null : longitude;
  const mapLabel = isLive ? "Sesión en vivo" : label;
  const mapAccent = accent || "#7ddfff";

  return (
    <section className="relative aspect-square w-full max-w-[260px] justify-self-end overflow-hidden rounded-[22px] border border-white/12 bg-[#05070b] shadow-[0_18px_55px_rgba(0,0,0,.38)]">
      <PlayerLocationMap
        latitude={mapLatitude}
        longitude={mapLongitude}
        label={mapLabel}
        accent={mapAccent}
        compact
        className="absolute inset-0"
      />

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,5,9,.72),transparent_32%,transparent_64%,rgba(2,5,9,.82))]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_52%,transparent_18%,rgba(2,5,9,.18)_55%,rgba(2,5,9,.5)_100%)]" />

      <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70 backdrop-blur">
          {isLive ? <Radio size={10} className="session-live-icon" /> : <LocateFixed size={10} />}
          {isLive ? "Sesión en vivo" : "Ubicación del Player"}
        </span>
        {isLive ? <span className="session-live-dot h-2 w-2 rounded-full" style={{ backgroundColor: mapAccent }} aria-label="Ubicación en vivo activa" /> : null}
      </div>

      <div className="absolute bottom-3 left-3 right-3">
        {isLive ? (
          <div className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78">Esta sesión está acá</p>
            <p className="mt-1 text-[9px] text-white/42">Se actualiza en este dispositivo · no se guarda</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-white/72">{label}</p>
            {isOwner && state === "prompt" ? (
              <button
                type="button"
                onClick={startWatching}
                className="pointer-events-auto mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.06] px-3 text-[10px] font-semibold text-white/75 transition hover:bg-white/[0.1]"
              >
                <Radio size={11} /> Mostrar mi sesión en vivo
              </button>
            ) : isOwner && state === "locating" ? (
              <p className="mt-1 text-[9px] text-white/45">Buscando esta sesión…</p>
            ) : isOwner && state === "denied" ? (
              <p className="mt-1 text-[9px] text-white/45">Activá ubicación del navegador para verla en vivo.</p>
            ) : null}
          </div>
        )}
      </div>

      <style jsx>{`
        .session-live-dot {
          box-shadow: 0 0 5px rgba(255,255,255,.95), 0 0 13px currentColor, 0 0 28px currentColor;
          animation: session-dot-flicker 3.1s steps(1,end) infinite;
        }
        .session-live-icon {
          animation: session-icon-breathe 2.4s ease-in-out infinite;
        }
        @keyframes session-dot-flicker {
          0%, 7%, 11%, 42%, 47%, 50%, 76%, 79%, 100% { opacity: 1; transform: scale(1); }
          8%, 45%, 77% { opacity: .48; transform: scale(.78); }
          9%, 46%, 78% { opacity: .82; transform: scale(1.18); }
        }
        @keyframes session-icon-breathe {
          0%, 100% { opacity: .58; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .session-live-dot,
          .session-live-icon { animation: none; }
        }
      `}</style>
    </section>
  );
}
