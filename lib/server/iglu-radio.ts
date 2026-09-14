import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireUser } from "@/lib/server/supabase";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { IGLU_STUDIO_SLUG } from "@/lib/iglu-radio/routes";

export const IGLU_RADIO_BUCKET = "iglu-radio";
export const IGLU_RADIO_TIMEZONE = "America/Argentina/Buenos_Aires";
export const IGLU_RADIO_MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const IGLU_RADIO_AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
]);

export type IgluRadioManagerContext = {
  admin: SupabaseClient;
  userId: string;
  studio: { id: string; slug: string; name: string };
  permission: { role: string; studioOsActive: true };
};

function httpError(message: string, status: number) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export async function resolveIgluStudio(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("studios")
    .select("id,slug,name")
    .eq("slug", IGLU_STUDIO_SLUG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw httpError("El Iglú no existe.", 404);
  return data as { id: string; slug: string; name: string };
}

export async function requireIgluRadioManager(request: NextRequest, slug: string): Promise<IgluRadioManagerContext> {
  if (slug.toLowerCase() !== IGLU_STUDIO_SLUG) throw httpError("Radio no encontrada.", 404);
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const studio = await resolveIgluStudio(admin);
  const permission = await requireStudioManager({ admin, userId: user.id, studioId: studio.id });
  return {
    admin,
    userId: user.id,
    studio,
    permission: { role: permission.role, studioOsActive: permission.studioOsActive },
  };
}

export function radioApiConfig() {
  const raw = process.env.IGLU_RADIO_API_URL?.trim() ?? "";
  const baseUrl = raw ? `${raw.replace(/\/+$/, "").replace(/\/api$/, "")}/api` : "";
  return {
    baseUrl,
    stationId: process.env.IGLU_RADIO_STATION_ID?.trim() ?? "",
    apiKey: process.env.IGLU_RADIO_API_KEY?.trim() ?? "",
    publicConfigured: Boolean(baseUrl && process.env.IGLU_RADIO_STATION_ID?.trim()),
    privateConfigured: Boolean(baseUrl && process.env.IGLU_RADIO_STATION_ID?.trim() && process.env.IGLU_RADIO_API_KEY?.trim()),
  };
}

async function azuraFetch(path: string, options: RequestInit = {}, auth = false) {
  const config = radioApiConfig();
  if (!config.baseUrl || !config.stationId) throw httpError("El servidor radial todavía no está configurado.", 503);
  if (auth && !config.apiKey) throw httpError("La API privada de IGLÚ RADIO todavía no está configurada.", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(auth ? { authorization: `Bearer ${config.apiKey}` } : {}),
        ...options.headers,
      },
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw httpError(`AzuraCast respondió HTTP ${response.status}.`, 502);
    return payload;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw httpError("AzuraCast no respondió a tiempo.", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getIgluNowPlaying() {
  const config = radioApiConfig();
  if (!config.publicConfigured) {
    return {
      configured: false,
      reachable: false,
      station: "IGLÚ RADIO",
      listenUrl: null,
      isLive: false,
      streamer: null,
      listeners: null,
      nowPlaying: null,
      playingNext: null,
      history: [],
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const raw = objectValue(await azuraFetch(`/nowplaying/${encodeURIComponent(config.stationId)}`));
    const station = objectValue(raw.station);
    const live = objectValue(raw.live);
    const listeners = objectValue(raw.listeners);
    const nowPlaying = objectValue(raw.now_playing);
    const nowSong = objectValue(nowPlaying.song);
    const playingNext = objectValue(raw.playing_next);
    const nextSong = objectValue(playingNext.song);
    const songHistory = Array.isArray(raw.song_history) ? raw.song_history : [];

    return {
      configured: true,
      reachable: true,
      station: text(station.name) ?? "IGLÚ RADIO",
      listenUrl: text(station.listen_url),
      isLive: live.is_live === true,
      streamer: text(live.streamer_name),
      listeners: numberValue(listeners.current),
      nowPlaying: text(nowSong.title) || text(nowSong.artist) ? {
        title: text(nowSong.title) ?? "IGLÚ RADIO",
        artist: text(nowSong.artist) ?? "IGLÚ RECORDS",
        album: text(nowSong.album),
        artwork: text(nowSong.art),
        playlist: text(nowPlaying.playlist),
        playedAt: numberValue(nowPlaying.played_at),
        duration: numberValue(nowPlaying.duration),
        source: live.is_live === true ? "live" : "autodj",
      } : null,
      playingNext: text(nextSong.title) || text(nextSong.artist) ? {
        title: text(nextSong.title) ?? "",
        artist: text(nextSong.artist) ?? "",
        artwork: text(nextSong.art),
      } : null,
      history: songHistory.slice(0, 5).map((entry) => {
        const row = objectValue(entry);
        const song = objectValue(row.song);
        return {
          title: text(song.title),
          artist: text(song.artist),
          artwork: text(song.art),
          playedAt: numberValue(row.played_at),
        };
      }),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      station: "IGLÚ RADIO",
      listenUrl: null,
      isLive: false,
      streamer: null,
      listeners: null,
      nowPlaying: null,
      playingNext: null,
      history: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function getIgluAzuraStatus() {
  const config = radioApiConfig();
  if (!config.privateConfigured) return { configured: config.publicConfigured, controllable: false, reachable: false, raw: null };
  try {
    const raw = await azuraFetch(`/station/${encodeURIComponent(config.stationId)}/status`, {}, true);
    return { configured: true, controllable: true, reachable: true, raw };
  } catch {
    return { configured: true, controllable: true, reachable: false, raw: null };
  }
}

export async function setIgluAutoDjRunning(enabled: boolean) {
  const config = radioApiConfig();
  if (!config.privateConfigured) throw httpError("Configurá IGLU_RADIO_API_URL, IGLU_RADIO_STATION_ID e IGLU_RADIO_API_KEY antes de activar AutoDJ.", 409);
  const action = enabled ? "start" : "stop";
  await azuraFetch(`/station/${encodeURIComponent(config.stationId)}/backend/${action}`, { method: "POST" }, true);
}

export function sanitizeRadioFilename(name: string) {
  const clean = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return clean.slice(-180) || `track-${Date.now()}.mp3`;
}
