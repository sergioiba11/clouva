import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getActiveKickLive } from "@/core/integrations/kick/public";
import { getActiveYoutubeLive } from "@/core/integrations/youtube/service";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IGLU_SLUG = "el-iglu";
const BUCKET = "iglu-radio";
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/x-flac"]);
const MAX_BYTES = 120 * 1024 * 1024;

async function igluStudio(admin: ReturnType<typeof createAdminSupabase>) {
  const { data, error } = await admin.from("studios").select("id,name").eq("slug", IGLU_SLUG).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No encontramos El Iglú.");
  return data;
}

export async function GET() {
  try {
    const admin = createAdminSupabase();
    const studio = await igluStudio(admin);
    const [{ data: radio, error: radioError }, { data: tracks, error: tracksError }] = await Promise.all([
      admin.from("profile_radio_settings").select("station_name,tagline,stream_url,artwork_url,is_enabled,is_public,primary_track_id,podcast_rss_url,kick_channel_url").eq("studio_id", studio.id).maybeSingle(),
      admin.from("radio_tracks").select("id,title,artist,album,duration_seconds,artwork_url,status,youtube_url,storage_bucket,storage_path,created_at").eq("studio_id", studio.id).in("status", ["ready", "synced"]).order("created_at", { ascending: false }).limit(30),
    ]);
    if (radioError) throw new Error(radioError.message);
    if (tracksError) throw new Error(tracksError.message);

    const publicTracks = await Promise.all((tracks ?? []).map(async (track) => {
      let audioUrl: string | null = null;
      if (track.storage_bucket && track.storage_path) {
        const { data } = await admin.storage.from(String(track.storage_bucket)).createSignedUrl(String(track.storage_path), 3600);
        audioUrl = data?.signedUrl ?? null;
      }
      return { ...track, audioUrl };
    }));

    const { data: space } = await admin
      .from("spaces")
      .select("owner_player_id")
      .eq("legacy_studio_id", studio.id)
      .eq("status", "active")
      .maybeSingle();
    const { data: ownerPlayer } = space?.owner_player_id
      ? await admin.from("players").select("owner_user_id").eq("id", space.owner_player_id).maybeSingle()
      : { data: null };
    const [youtubeLive, kickLive] = await Promise.all([
      ownerPlayer?.owner_user_id
        ? getActiveYoutubeLive(admin, String(ownerPlayer.owner_user_id)).catch(() => null)
        : Promise.resolve(null),
      getActiveKickLive(radio?.kick_channel_url).catch(() => null),
    ]);

    const primaryTrackId = radio?.primary_track_id ? String(radio.primary_track_id) : null;
    const primaryTrack = primaryTrackId
      ? publicTracks.find((track) => String(track.id) === primaryTrackId) || null
      : publicTracks[0] || null;
    const playableTracks = publicTracks.filter((track) => Boolean(track.audioUrl));
    const fallbackTrack = playableTracks.length
      ? playableTracks[Math.floor(Math.random() * playableTracks.length)]
      : primaryTrack;

    return NextResponse.json({
      studio: { id: studio.id, name: studio.name },
      radio: radio && radio.is_enabled && radio.is_public ? radio : null,
      tracks: publicTracks,
      primaryTrack,
      fallbackTrack,
      youtubeLive,
      kickLive,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar Media." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const studio = await igluStudio(admin);
    await requireStudioManager({ admin, userId: user.id, studioId: studio.id });

    const form = await request.formData();
    const file = form.get("file");
    const title = String(form.get("title") || "").trim().slice(0, 220);
    const artist = String(form.get("artist") || "").trim().slice(0, 220) || "IGLÚ Records";
    if (!(file instanceof File)) return NextResponse.json({ error: "Seleccioná un archivo de audio." }, { status: 400 });
    if (!title) return NextResponse.json({ error: "El título es obligatorio." }, { status: 400 });
    if (!AUDIO_TYPES.has(file.type)) return NextResponse.json({ error: "Formato no soportado. Usá MP3, WAV o FLAC." }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "El audio debe pesar menos de 120 MB." }, { status: 413 });

    const ext = (file.name.split(".").pop() || "audio").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) || "audio";
    const storagePath = `${studio.id}/tracks/${new Date().toISOString().slice(0,10)}/${randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);

    const { data: track, error: insertError } = await admin.from("radio_tracks").insert({
      studio_id: studio.id,
      title,
      artist,
      duration_seconds: null,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      mime_type: file.type,
      file_size: file.size,
      status: "ready",
      created_by: user.id,
    }).select("id,title,artist,status,created_at").single();

    if (insertError) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      throw new Error(insertError.message);
    }
    return NextResponse.json({ track }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo subir el audio." }, { status });
  }
}


export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const studio = await igluStudio(admin);
    await requireStudioManager({ admin, userId: user.id, studioId: studio.id });

    const body = (await request.json().catch(() => ({}))) as { trackId?: unknown };
    const trackId = typeof body.trackId === "string" && body.trackId.trim() ? body.trackId.trim() : null;
    if (!trackId) return NextResponse.json({ error: "Seleccioná un audio de la biblioteca." }, { status: 400 });

    const { data: track, error: trackError } = await admin
      .from("radio_tracks")
      .select("id")
      .eq("id", trackId)
      .eq("studio_id", studio.id)
      .in("status", ["ready", "synced"])
      .maybeSingle();
    if (trackError) throw new Error(trackError.message);
    if (!track) return NextResponse.json({ error: "Ese audio no pertenece a la biblioteca pública del IGLÚ." }, { status: 404 });

    const { data: settings, error: settingsError } = await admin
      .from("profile_radio_settings")
      .update({ primary_track_id: track.id, updated_at: new Date().toISOString() })
      .eq("studio_id", studio.id)
      .select("primary_track_id")
      .maybeSingle();
    if (settingsError) throw new Error(settingsError.message);
    if (!settings) return NextResponse.json({ error: "Activá primero la Radio del IGLÚ." }, { status: 409 });

    return NextResponse.json({ ok: true, primaryTrackId: settings.primary_track_id });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cambiar la reproducción principal." }, { status });
  }
}
