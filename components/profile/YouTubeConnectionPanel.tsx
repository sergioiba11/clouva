"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { SocialBrandIcon } from "@/components/public/SocialBrandIcon";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

type YoutubeConnection = {
  connected: boolean;
  displayName: string | null;
  externalUsername: string | null;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  status: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleOauthWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: GoogleTokenResponse) => void;
          error_callback?: (response: { type?: string }) => void;
        }) => {
          requestAccessToken: (options?: { prompt?: string }) => void;
        };
      };
    };
  };
};

type Props = {
  onChannelUrl?: (url: string) => void;
};

export function YouTubeConnectionPanel({ onChannelUrl }: Props) {
  const [connection, setConnection] = useState<YoutubeConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const googleOauth = () => (window as GoogleOauthWindow).google?.accounts?.oauth2;

  useEffect(() => {
    if (googleOauth()) setGoogleReady(true);
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/youtube/status");
      const payload = await readApiJson<{ connection: YoutubeConnection }>(response);
      setConnection(payload.connection);
      if (payload.connection?.channelUrl) onChannelUrl?.(payload.connection.channelUrl);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo leer YouTube.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const requestGoogleToken = (prompt: "consent" | "" = "") => new Promise<GoogleTokenResponse>((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error("Google no está configurado en CLOUVA."));
      return;
    }
    const oauth2 = googleOauth();
    if (!oauth2) {
      reject(new Error("Google todavía se está cargando. Probá de nuevo en un segundo."));
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: YOUTUBE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || "Google no devolvió acceso a YouTube."));
          return;
        }
        resolve(response);
      },
      error_callback: () => reject(new Error("No se pudo abrir la autorización de Google.")),
    });
    client.requestAccessToken({ prompt });
  });

  const connect = async () => {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const token = await requestGoogleToken("consent");
      const response = await authenticatedFetch("/api/integrations/youtube/connect", {
        method: "POST",
        body: JSON.stringify({ accessToken: token.access_token, scope: token.scope || YOUTUBE_SCOPE }),
      });
      const payload = await readApiJson<{ synced: number; channelUrl: string; displayName: string }>(response);
      onChannelUrl?.(payload.channelUrl);
      setMessage(`${payload.displayName} conectado. ${payload.synced} videos sincronizados con tu Player.`);
      await load();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo conectar YouTube.");
    } finally {
      setWorking(false);
    }
  };

  const sync = async () => {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const token = await requestGoogleToken("");
      const response = await authenticatedFetch("/api/integrations/youtube/sync", {
        method: "POST",
        body: JSON.stringify({ accessToken: token.access_token }),
      });
      const payload = await readApiJson<{ synced: number; channelUrl: string }>(response);
      onChannelUrl?.(payload.channelUrl);
      setMessage(`${payload.synced} videos sincronizados con tu Player.`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "No se pudo actualizar YouTube.");
    } finally {
      setWorking(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("¿Desconectar YouTube? Los videos ya publicados se conservan en tu Player.")) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/youtube/disconnect", { method: "DELETE" });
      await readApiJson(response);
      setConnection(null);
      setMessage("YouTube fue desconectado. Los videos públicos sincronizados se conservaron.");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "No se pudo desconectar YouTube.");
    } finally {
      setWorking(false);
    }
  };

  if (loading) return <div className="h-36 animate-pulse rounded-2xl bg-white/[0.04]" />;

  const googleUnavailable = !GOOGLE_CLIENT_ID || !googleReady;

  return (
    <>
      {GOOGLE_CLIENT_ID ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleReady(true)}
        />
      ) : null}
      <div className="space-y-4">
        {connection?.connected ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-5">
            <div className="flex items-center gap-4">
              {connection.thumbnailUrl ? <img src={connection.thumbnailUrl} alt="" className="h-14 w-14 rounded-full object-cover" /> : <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10"><SocialBrandIcon icon="youtube" className="h-7 w-7" /></span>}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-200/70">YouTube conectado</p>
                <p className="mt-1 truncate text-lg font-semibold">{connection.displayName || "Canal de YouTube"}</p>
                {connection.externalUsername ? <p className="text-sm text-white/45">{connection.externalUsername}</p> : null}
              </div>
            </div>
            {connection.channelUrl ? <a href={connection.channelUrl} target="_blank" rel="noopener noreferrer" className="mt-4 block truncate text-xs text-red-200/70">{connection.channelUrl}</a> : null}
            <p className="mt-3 text-xs text-white/35">Última sincronización: {connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "todavía no registrada"}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void sync()} disabled={working || googleUnavailable} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">Actualizar videos</button>
              <button type="button" onClick={() => void connect()} disabled={working || googleUnavailable} className="rounded-xl border border-white/15 px-4 py-2 text-sm disabled:opacity-50">Reconectar</button>
              <button type="button" onClick={() => void disconnect()} disabled={working} className="rounded-xl border border-red-400/20 px-4 py-2 text-sm text-red-200 disabled:opacity-50">Desconectar</button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white/[0.06]"><SocialBrandIcon icon="youtube" className="h-6 w-6" /></span>
            <p className="mt-4 font-semibold">YouTube todavía no está conectado.</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/45">Conectá tu canal para traer sus videos públicos al Player. CLOUVA solicita acceso de solo lectura; el token temporal se usa únicamente para sincronizar y no se almacena.</p>
            <button type="button" onClick={() => void connect()} disabled={working || googleUnavailable} className="mt-4 rounded-xl bg-red-600 px-5 py-3 font-semibold disabled:opacity-50">{working ? "Conectando..." : "Conectar YouTube"}</button>
            {!GOOGLE_CLIENT_ID ? <p className="mt-3 text-xs text-red-200/70">Google no está configurado en este entorno.</p> : !googleReady ? <p className="mt-3 text-xs text-white/35">Cargando autorización de Google...</p> : null}
          </div>
        )}
        {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">{message}</p> : null}
        {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      </div>
    </>
  );
}
