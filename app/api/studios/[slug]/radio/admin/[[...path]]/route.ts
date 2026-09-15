import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  IGLU_RADIO_AUDIO_MIME_TYPES,
  IGLU_RADIO_BUCKET,
  IGLU_RADIO_MAX_UPLOAD_BYTES,
  IGLU_RADIO_TIMEZONE,
  getIgluAzuraStatus,
  getIgluNowPlaying,
  radioApiConfig,
  requireIgluRadioManager,
  sanitizeRadioFilename,
  setIgluAutoDjRunning,
} from "@/lib/server/iglu-radio";
import { isAuthError } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown, fallback: string) {
  const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

function bodyRecord(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max = 1000) {
  const result = cleanText(value, max);
  return result || null;
}

function safeExternalUrl(value: unknown) {
  const candidate = cleanText(value, 2000);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function enforceUploadRateLimit(admin: Awaited<ReturnType<typeof requireIgluRadioManager>>["admin"], userId: string) {
  const bucket = new Date();
  bucket.setUTCSeconds(0, 0);
  const keyHash = createHash("sha256").update(`iglu-radio:${userId}`).digest("hex");
  const { data, error } = await admin
    .from("public_form_rate_limits")
    .select("request_count")
    .eq("action", "iglu-radio-upload")
    .eq("key_hash", keyHash)
    .eq("bucket_started_at", bucket.toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  const nextCount = Number(data?.request_count ?? 0) + 1;
  if (nextCount > 20) {
    const limited = new Error("Demasiados uploads iniciados. Esperá un minuto y volvé a intentar.") as Error & { status?: number };
    limited.status = 429;
    throw limited;
  }
  const { error: upsertError } = await admin.from("public_form_rate_limits").upsert({
    action: "iglu-radio-upload",
    key_hash: keyHash,
    bucket_started_at: bucket.toISOString(),
    request_count: nextCount,
    updated_at: new Date().toISOString(),
  }, { onConflict: "action,key_hash,bucket_started_at" });
  if (upsertError) throw new Error(upsertError.message);
}

async function loadOverview(ctx: Awaited<ReturnType<typeof requireIgluRadioManager>>) {
  const [tracksResult, playlistsResult, settingsResult, scheduleResult, historyResult, signal, server] = await Promise.all([
    ctx.admin.from("radio_tracks").select("id,file_size,status").eq("studio_id", ctx.studio.id).neq("status", "archived"),
    ctx.admin.from("radio_playlists").select("id,name,status,created_at").eq("studio_id", ctx.studio.id).neq("status", "archived").order("created_at", { ascending: false }),
    ctx.admin.from("radio_station_settings").select("*").eq("studio_id", ctx.studio.id).maybeSingle(),
    ctx.admin.from("radio_schedule_blocks").select("id,title,kind,day_of_week,start_time,starts_at,status").eq("studio_id", ctx.studio.id).eq("status", "scheduled").limit(10),
    ctx.admin.from("radio_play_history").select("id,title,artist,source,started_at,ended_at").eq("studio_id", ctx.studio.id).order("started_at", { ascending: false }).limit(10),
    getIgluNowPlaying(),
    getIgluAzuraStatus(),
  ]);
  for (const result of [tracksResult, playlistsResult, settingsResult, scheduleResult, historyResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const tracks = tracksResult.data ?? [];
  const settings = settingsResult.data;
  return {
    permission: ctx.permission,
    studio: ctx.studio,
    signal,
    server: {
      configured: radioApiConfig().publicConfigured,
      controllable: server.controllable,
      reachable: server.reachable,
    },
    settings: settings ?? { station_name: "IGLÚ RADIO", timezone: IGLU_RADIO_TIMEZONE, autodj_enabled: false, active_playlist_id: null },
    library: {
      count: tracks.length,
      ready: tracks.filter((row) => row.status === "ready" || row.status === "synced").length,
      synced: tracks.filter((row) => row.status === "synced").length,
      bytes: tracks.reduce((sum, row) => sum + Number(row.file_size || 0), 0),
    },
    playlists: playlistsResult.data ?? [],
    schedule: scheduleResult.data ?? [],
    history: historyResult.data ?? [],
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  try {
    const { slug, path = [] } = await params;
    const ctx = await requireIgluRadioManager(request, slug);
    const route = path.join("/");

    if (!route) return NextResponse.json(await loadOverview(ctx));
    if (route === "library") {
      const { data, error } = await ctx.admin.from("radio_tracks").select("*").eq("studio_id", ctx.studio.id).order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return NextResponse.json({ tracks: data ?? [] });
    }
    if (route === "playlists") {
      const { data, error } = await ctx.admin
        .from("radio_playlists")
        .select("*,items:radio_playlist_items(id,position,track:radio_tracks(id,title,artist,duration_seconds,status,storage_path))")
        .eq("studio_id", ctx.studio.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return NextResponse.json({ playlists: data ?? [] });
    }
    if (route === "schedule") {
      const { data, error } = await ctx.admin.from("radio_schedule_blocks").select("*").eq("studio_id", ctx.studio.id).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return NextResponse.json({ schedule: data ?? [] });
    }
    if (route === "history") {
      const { data, error } = await ctx.admin.from("radio_play_history").select("*").eq("studio_id", ctx.studio.id).order("started_at", { ascending: false }).limit(200);
      if (error) throw new Error(error.message);
      return NextResponse.json({ history: data ?? [] });
    }
    return NextResponse.json({ error: "Ruta de administración radial no encontrada." }, { status: 404 });
  } catch (error) {
    return fail(error, "No se pudo cargar IGLÚ RADIO Admin.");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  try {
    const { slug, path = [] } = await params;
    const ctx = await requireIgluRadioManager(request, slug);
    const route = path.join("/");
    const body = bodyRecord(await request.json().catch(() => ({})));

    if (route === "library/upload-url") {
      await enforceUploadRateLimit(ctx.admin, ctx.userId);
      const filename = sanitizeRadioFilename(cleanText(body.filename, 300));
      const mimeType = cleanText(body.mimeType, 120).toLowerCase();
      const fileSize = Number(body.fileSize);
      const title = cleanText(body.title, 240) || filename.replace(/\.[^.]+$/, "");
      if (!IGLU_RADIO_AUDIO_MIME_TYPES.has(mimeType)) return NextResponse.json({ error: "Formato no permitido. Usá MP3, WAV o FLAC." }, { status: 400 });
      if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > IGLU_RADIO_MAX_UPLOAD_BYTES) return NextResponse.json({ error: "El archivo supera el límite permitido o su tamaño no es válido." }, { status: 400 });

      const trackId = randomUUID();
      const storagePath = `${ctx.studio.id}/audio/${trackId}/${filename}`;
      const { data: track, error: insertError } = await ctx.admin.from("radio_tracks").insert({
        id: trackId,
        studio_id: ctx.studio.id,
        title,
        artist: cleanText(body.artist, 240) || "IGLÚ RECORDS",
        album: nullableText(body.album, 240),
        storage_bucket: IGLU_RADIO_BUCKET,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size: Math.floor(fileSize),
        status: "uploading",
        genre: nullableText(body.genre, 120),
        notes: nullableText(body.notes, 2000),
        spotify_url: safeExternalUrl(body.spotifyUrl),
        youtube_url: safeExternalUrl(body.youtubeUrl),
        created_by: ctx.userId,
      }).select("*").single();
      if (insertError) throw new Error(insertError.message);

      const signed = await ctx.admin.storage.from(IGLU_RADIO_BUCKET).createSignedUploadUrl(storagePath, { upsert: false });
      if (signed.error || !signed.data) {
        await ctx.admin.from("radio_tracks").delete().eq("id", trackId).eq("studio_id", ctx.studio.id);
        throw new Error(signed.error?.message || "No se pudo preparar el upload.");
      }
      return NextResponse.json({
        track,
        upload: { bucket: IGLU_RADIO_BUCKET, path: signed.data.path, token: signed.data.token },
      });
    }

    if (route === "library/complete") {
      const trackId = cleanText(body.trackId, 80);
      const { data: track, error: trackError } = await ctx.admin.from("radio_tracks").select("id,storage_path,status").eq("id", trackId).eq("studio_id", ctx.studio.id).maybeSingle();
      if (trackError) throw new Error(trackError.message);
      if (!track) return NextResponse.json({ error: "Track no encontrado." }, { status: 404 });
      const slash = track.storage_path.lastIndexOf("/");
      const folder = track.storage_path.slice(0, slash);
      const filename = track.storage_path.slice(slash + 1);
      const listed = await ctx.admin.storage.from(IGLU_RADIO_BUCKET).list(folder, { limit: 20, search: filename });
      if (listed.error) throw new Error(listed.error.message);
      if (!(listed.data ?? []).some((object) => object.name === filename)) return NextResponse.json({ error: "El archivo todavía no terminó de subirse." }, { status: 409 });
      const { data, error } = await ctx.admin.from("radio_tracks").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", trackId).eq("studio_id", ctx.studio.id).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ track: data, sync: { status: "pending_server", message: "Archivo guardado en CLOUVA. Se sincronizará con AzuraCast cuando el servidor radial esté conectado." } });
    }

    if (route === "playlists") {
      const name = cleanText(body.name, 160);
      if (!name) return NextResponse.json({ error: "El nombre de la playlist es obligatorio." }, { status: 400 });
      const { data, error } = await ctx.admin.from("radio_playlists").insert({
        studio_id: ctx.studio.id,
        name,
        description: nullableText(body.description, 1000),
        shuffle: body.shuffle !== false,
        repeat: body.repeat !== false,
        created_by: ctx.userId,
      }).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ playlist: data });
    }

    if (path.length === 3 && path[0] === "playlists" && path[2] === "items") {
      const playlistId = path[1];
      const trackId = cleanText(body.trackId, 80);
      const [{ data: playlist }, { data: track }, { data: last }] = await Promise.all([
        ctx.admin.from("radio_playlists").select("id").eq("id", playlistId).eq("studio_id", ctx.studio.id).maybeSingle(),
        ctx.admin.from("radio_tracks").select("id,status").eq("id", trackId).eq("studio_id", ctx.studio.id).maybeSingle(),
        ctx.admin.from("radio_playlist_items").select("position").eq("playlist_id", playlistId).order("position", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!playlist || !track) return NextResponse.json({ error: "Playlist o track no encontrado." }, { status: 404 });
      const { data, error } = await ctx.admin.from("radio_playlist_items").upsert({ playlist_id: playlistId, track_id: trackId, position: Number(last?.position ?? -1) + 1 }, { onConflict: "playlist_id,track_id" }).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ item: data });
    }

    if (path.length === 3 && path[0] === "playlists" && path[2] === "reorder") {
      const playlistId = path[1];
      const trackIds = Array.isArray(body.trackIds) ? body.trackIds.map(String) : [];
      const { data: playlist } = await ctx.admin.from("radio_playlists").select("id").eq("id", playlistId).eq("studio_id", ctx.studio.id).maybeSingle();
      if (!playlist) return NextResponse.json({ error: "Playlist no encontrada." }, { status: 404 });
      for (const [position, trackId] of trackIds.entries()) {
        const { error } = await ctx.admin.from("radio_playlist_items").update({ position }).eq("playlist_id", playlistId).eq("track_id", trackId);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({ reordered: true });
    }

    if (path.length === 3 && path[0] === "playlists" && path[2] === "activate") {
      const playlistId = path[1];
      const { data: playlist } = await ctx.admin.from("radio_playlists").select("id").eq("id", playlistId).eq("studio_id", ctx.studio.id).maybeSingle();
      if (!playlist) return NextResponse.json({ error: "Playlist no encontrada." }, { status: 404 });
      await ctx.admin.from("radio_playlists").update({ status: "draft", updated_at: new Date().toISOString() }).eq("studio_id", ctx.studio.id).eq("status", "active");
      const { error: activeError } = await ctx.admin.from("radio_playlists").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", playlistId);
      if (activeError) throw new Error(activeError.message);
      const { error: settingsError } = await ctx.admin.from("radio_station_settings").upsert({ studio_id: ctx.studio.id, active_playlist_id: playlistId, updated_at: new Date().toISOString() }, { onConflict: "studio_id" });
      if (settingsError) throw new Error(settingsError.message);
      return NextResponse.json({ active: true, playlistId });
    }

    if (route === "schedule") {
      const title = cleanText(body.title, 200);
      if (!title) return NextResponse.json({ error: "El título del bloque es obligatorio." }, { status: 400 });
      const dayValue = body.dayOfWeek === null || body.dayOfWeek === undefined || body.dayOfWeek === "" ? null : Number(body.dayOfWeek);
      const startsAt = nullableText(body.startsAt, 80);
      const startTime = nullableText(body.startTime, 20);
      if (dayValue === null && !startsAt) return NextResponse.json({ error: "Definí un día semanal o una fecha de inicio." }, { status: 400 });
      if (dayValue !== null && (!Number.isInteger(dayValue) || dayValue < 0 || dayValue > 6 || !startTime)) return NextResponse.json({ error: "Día u horario semanal inválido." }, { status: 400 });
      const kind = ["autodj", "program", "session", "live"].includes(String(body.kind)) ? String(body.kind) : "autodj";
      const { data, error } = await ctx.admin.from("radio_schedule_blocks").insert({
        studio_id: ctx.studio.id,
        playlist_id: nullableText(body.playlistId, 80),
        title,
        description: nullableText(body.description, 1200),
        kind,
        day_of_week: dayValue,
        start_time: startTime,
        end_time: nullableText(body.endTime, 20),
        starts_at: startsAt,
        ends_at: nullableText(body.endsAt, 80),
        timezone: cleanText(body.timezone, 100) || IGLU_RADIO_TIMEZONE,
        status: "scheduled",
        created_by: ctx.userId,
      }).select("*").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ block: data });
    }

    if (route === "settings/autodj") {
      const enabled = body.enabled === true;
      if (enabled) {
        const { data: settings, error: settingsReadError } = await ctx.admin.from("radio_station_settings").select("active_playlist_id").eq("studio_id", ctx.studio.id).maybeSingle();
        if (settingsReadError) throw new Error(settingsReadError.message);
        if (!settings?.active_playlist_id) return NextResponse.json({ error: "Elegí una playlist activa antes de iniciar AutoDJ." }, { status: 409 });
        const { count, error: countError } = await ctx.admin.from("radio_playlist_items").select("id", { count: "exact", head: true }).eq("playlist_id", settings.active_playlist_id);
        if (countError) throw new Error(countError.message);
        if (!count) return NextResponse.json({ error: "La playlist activa está vacía." }, { status: 409 });
        const { count: syncedCount, error: syncedError } = await ctx.admin.from("radio_playlist_items").select("id,track:radio_tracks!inner(id,status)", { count: "exact", head: true }).eq("playlist_id", settings.active_playlist_id).eq("track.status", "synced");
        if (syncedError) throw new Error(syncedError.message);
        if (!syncedCount) return NextResponse.json({ error: "Todavía no hay audio sincronizado con AzuraCast. Conectá el servidor radial antes de activar AutoDJ." }, { status: 409 });
        await setIgluAutoDjRunning(true);
      } else if (radioApiConfig().privateConfigured) {
        await setIgluAutoDjRunning(false);
      }
      const { error } = await ctx.admin.from("radio_station_settings").upsert({ studio_id: ctx.studio.id, autodj_enabled: enabled, updated_at: new Date().toISOString() }, { onConflict: "studio_id" });
      if (error) throw new Error(error.message);
      return NextResponse.json({ autodj: enabled });
    }

    return NextResponse.json({ error: "Acción de administración radial no encontrada." }, { status: 404 });
  } catch (error) {
    return fail(error, "No se pudo actualizar IGLÚ RADIO.");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  try {
    const { slug, path = [] } = await params;
    const ctx = await requireIgluRadioManager(request, slug);

    if (path.length === 2 && path[0] === "library") {
      const trackId = path[1];
      const { data: track, error } = await ctx.admin.from("radio_tracks").select("id,storage_path").eq("id", trackId).eq("studio_id", ctx.studio.id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!track) return NextResponse.json({ error: "Track no encontrado." }, { status: 404 });
      const removed = await ctx.admin.storage.from(IGLU_RADIO_BUCKET).remove([track.storage_path]);
      if (removed.error) throw new Error(removed.error.message);
      const deleted = await ctx.admin.from("radio_tracks").delete().eq("id", trackId).eq("studio_id", ctx.studio.id);
      if (deleted.error) throw new Error(deleted.error.message);
      return NextResponse.json({ deleted: true });
    }

    if (path.length === 4 && path[0] === "playlists" && path[2] === "items") {
      const [playlistId, trackId] = [path[1], path[3]];
      const { data: playlist } = await ctx.admin.from("radio_playlists").select("id").eq("id", playlistId).eq("studio_id", ctx.studio.id).maybeSingle();
      if (!playlist) return NextResponse.json({ error: "Playlist no encontrada." }, { status: 404 });
      const { error } = await ctx.admin.from("radio_playlist_items").delete().eq("playlist_id", playlistId).eq("track_id", trackId);
      if (error) throw new Error(error.message);
      return NextResponse.json({ deleted: true });
    }

    if (path.length === 2 && path[0] === "playlists") {
      const { error } = await ctx.admin.from("radio_playlists").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", path[1]).eq("studio_id", ctx.studio.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ archived: true });
    }

    if (path.length === 2 && path[0] === "schedule") {
      const { error } = await ctx.admin.from("radio_schedule_blocks").delete().eq("id", path[1]).eq("studio_id", ctx.studio.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ deleted: true });
    }

    return NextResponse.json({ error: "Acción de borrado no encontrada." }, { status: 404 });
  } catch (error) {
    return fail(error, "No se pudo borrar el recurso radial.");
  }
}
