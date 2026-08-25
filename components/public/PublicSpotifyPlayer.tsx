"use client";

import Link from "next/link";
import { ExternalLink, Heart, Loader2, Music2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type SpotifyPlaybackEvent = {
  data?: { playingURI?: string };
};

type SpotifyEmbedController = {
  addListener: (event: string, listener: (event: SpotifyPlaybackEvent) => void) => void;
  destroy: () => void;
};

type SpotifyIframeApi = {
  createController: (
    element: HTMLElement,
    options: { url: string; width?: string | number; height?: string | number },
    callback: (controller: SpotifyEmbedController) => void,
  ) => void;
};

type SpotifyWindow = Window & {
  onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  __clouvaSpotifyIframeApi?: SpotifyIframeApi;
};

type ApiPayload = {
  ok?: boolean;
  saved?: boolean;
  code?: string;
  authorizeUrl?: string;
};

function messageForCode(code?: string) {
  if (code === "spotify_access_denied") return "Spotify no habilitó esta cuenta para usar la integración todavía.";
  if (code === "spotify_rate_limited") return "Spotify está limitando solicitudes por un momento. Probá de nuevo en un rato.";
  if (code === "unauthorized") return "Iniciá sesión en CLOUVA para guardar este tema en tu Spotify.";
  return "No pude actualizar tu Spotify. Probá de nuevo.";
}

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as ApiPayload;
}

export function PublicSpotifyPlayer({ spotifyUrl, artistName }: { spotifyUrl: string; artistName: string }) {
  const { user } = useAuth();
  const mountRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyEmbedController | null>(null);
  const [currentUri, setCurrentUri] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [embedReady, setEmbedReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const spotifyWindow = window as SpotifyWindow;

    const mountPlayer = (api: SpotifyIframeApi) => {
      if (cancelled || !mountRef.current || controllerRef.current) return;
      api.createController(
        mountRef.current,
        { url: spotifyUrl, width: "100%", height: 352 },
        (controller) => {
          if (cancelled) {
            controller.destroy();
            return;
          }
          controllerRef.current = controller;
          setEmbedReady(true);
          const captureTrack = (event: SpotifyPlaybackEvent) => {
            const playingUri = event.data?.playingURI;
            if (playingUri?.startsWith("spotify:track:")) {
              setCurrentUri(playingUri);
              setStatusMessage(null);
            }
          };
          controller.addListener("playback_started", captureTrack);
          controller.addListener("playback_update", captureTrack);
        },
      );
    };

    if (spotifyWindow.__clouvaSpotifyIframeApi) {
      mountPlayer(spotifyWindow.__clouvaSpotifyIframeApi);
    } else {
      const ready = (api: SpotifyIframeApi) => {
        spotifyWindow.__clouvaSpotifyIframeApi = api;
        mountPlayer(api);
      };
      spotifyWindow.onSpotifyIframeApiReady = ready;
      if (!document.getElementById("spotify-iframe-api")) {
        const script = document.createElement("script");
        script.id = "spotify-iframe-api";
        script.src = "https://open.spotify.com/embed/iframe-api/v1";
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [spotifyUrl]);

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    if (!currentUri || !user) return () => { cancelled = true; };

    void (async () => {
      try {
        const response = await authenticatedFetch(`/api/integrations/spotify/library?uri=${encodeURIComponent(currentUri)}`, { cache: "no-store" });
        const payload = await readPayload(response);
        if (!cancelled && response.ok) setSaved(payload.saved === true);
      } catch {
        if (!cancelled) setSaved(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUri, user]);

  const connectAndSave = async (uri: string) => {
    const returnPath = `${window.location.pathname}${window.location.search}#musica`;
    const response = await authenticatedFetch("/api/integrations/spotify/connect", {
      method: "POST",
      body: JSON.stringify({
        returnPath,
        pendingAction: { type: "save_track", uri },
      }),
    });
    const payload = await readPayload(response);
    if (response.ok && payload.authorizeUrl) {
      window.location.assign(payload.authorizeUrl);
      return true;
    }
    setStatusMessage(messageForCode(payload.code));
    return false;
  };

  const toggleSaved = async () => {
    if (!currentUri) {
      setStatusMessage("Elegí y reproducí un tema primero; después tocá el corazón.");
      return;
    }
    if (!user) {
      setStatusMessage("Iniciá sesión en CLOUVA para guardar este tema en tu Spotify.");
      return;
    }

    setSaving(true);
    setStatusMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/library", {
        method: saved ? "DELETE" : "PUT",
        body: JSON.stringify({ uri: currentUri }),
      });
      const payload = await readPayload(response);

      if (response.ok) {
        const nextSaved = payload.saved === true;
        setSaved(nextSaved);
        setStatusMessage(nextSaved ? "Guardado en tu Spotify." : "Quitado de tu Spotify.");
        return;
      }

      if (!saved && (payload.code === "spotify_connection_required" || payload.code === "spotify_reconnect_required")) {
        await connectAndSave(currentUri);
        return;
      }
      setStatusMessage(messageForCode(payload.code));
    } catch (error) {
      setStatusMessage(error instanceof Error && /sesión requerida/i.test(error.message)
        ? "Iniciá sesión en CLOUVA para guardar este tema en tu Spotify."
        : "No pude conectar con Spotify. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="musica" className="scroll-mt-24 border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,.16),transparent_38%)]">
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#0b0a12]/92 shadow-2xl">
          <div className="flex flex-col gap-4 border-b border-white/10 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300/75"><Music2 size={14} /> Música en CLOUVA</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">Escuchá a {artistName}</h2>
              <p className="mt-1 text-xs text-white/45">Reproducí sin salir del perfil. Cuando suene un tema, podés guardarlo en tu propia cuenta de Spotify.</p>
            </div>
            <a href={spotifyUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-white/75 transition hover:border-[#1DB954]/50 hover:text-white">
              Abrir Spotify <ExternalLink size={13} />
            </a>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:p-5">
            <div className="min-h-[352px] overflow-hidden rounded-2xl bg-black/35">
              <div ref={mountRef} className="min-h-[352px] w-full" />
              {!embedReady ? <div className="-mt-[352px] grid h-[352px] place-items-center text-xs text-white/35"><Loader2 size={20} className="animate-spin" /></div> : null}
            </div>

            <aside className="flex min-h-40 flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Me gusta</p>
                <p className="mt-2 text-sm leading-5 text-white/65">{currentUri ? "Este corazón guarda el tema que está sonando en la biblioteca de Spotify del visitante." : "Poné un tema en el reproductor para activar el corazón."}</p>
              </div>
              <div className="mt-6">
                <button type="button" onClick={toggleSaved} disabled={saving} className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold transition disabled:cursor-wait disabled:opacity-60 ${saved ? "bg-[#1DB954] text-black hover:bg-[#28d867]" : "border border-white/15 bg-white/[0.05] text-white hover:border-violet-400/55 hover:bg-violet-500/10"}`}>
                  {saving ? <Loader2 size={17} className="animate-spin" /> : <Heart size={17} fill={saved ? "currentColor" : "none"} />}
                  {saved ? "Guardado en Spotify" : "Me gusta / Guardar"}
                </button>
                {statusMessage ? <p className="mt-3 text-center text-[11px] leading-4 text-white/50">{statusMessage}</p> : null}
                {!user ? <Link href="/login" className="mt-3 block text-center text-[11px] font-semibold text-violet-300 hover:text-violet-200">Entrar a CLOUVA</Link> : null}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
