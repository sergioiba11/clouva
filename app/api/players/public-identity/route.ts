import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MUSIC_PROVIDERS = new Set(["spotify", "apple_music", "youtube", "youtube_music", "soundcloud", "instagram"]);
const IDENTITY_FIELDS = new Set([
  "seo_title",
  "seo_description",
  "share_title",
  "share_description",
  "og_image_url",
  "alternate_names",
  "genres",
  "disciplines",
  "professional_categories",
  "country",
  "origin",
  "birth_place",
  "schema_job_title",
  "public_identity_label",
]);

async function resolveEditablePlayer(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const owned = await admin.from("players").select("*").eq("owner_user_id", userId).maybeSingle();
  if (owned.error) throw new Error(owned.error.message);
  if (owned.data) return owned.data;

  const membership = await admin
    .from("player_members")
    .select("player_id,role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (membership.error) throw new Error(membership.error.message);
  if (!membership.data) return null;

  const player = await admin.from("players").select("*").eq("id", membership.data.player_id).maybeSingle();
  if (player.error) throw new Error(player.error.message);
  return player.data;
}

function cleanString(value: unknown, max = 500) {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const clean = value.trim().slice(0, max);
  return clean || null;
}

function cleanStringArray(value: unknown, maxItems = 20) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 120))
      .filter(Boolean),
  )].slice(0, maxItems);
}

function cleanHttpUrl(value: unknown) {
  const clean = cleanString(value, 2000);
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeIdentity(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!IDENTITY_FIELDS.has(key)) continue;
    if (["alternate_names", "genres", "disciplines", "professional_categories"].includes(key)) {
      const cleaned = cleanStringArray(value);
      if (cleaned) output[key] = cleaned;
      continue;
    }
    if (key === "og_image_url") {
      output[key] = cleanHttpUrl(value);
      continue;
    }
    const max = key.includes("description") ? 1000 : 500;
    const cleaned = cleanString(value, max);
    if (cleaned !== undefined) output[key] = cleaned;
  }

  return output;
}

type MusicConnectionInput = {
  provider?: unknown;
  external_artist_id?: unknown;
  external_uri?: unknown;
  external_url?: unknown;
  artist_name?: unknown;
  artist_image_url?: unknown;
  verification_status?: unknown;
};

async function syncMusicConnections(
  admin: ReturnType<typeof createAdminSupabase>,
  playerId: string,
  input: unknown,
) {
  if (!Array.isArray(input)) return;

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as MusicConnectionInput;
    const provider = typeof item.provider === "string" ? item.provider.trim().toLowerCase() : "";
    if (!MUSIC_PROVIDERS.has(provider)) continue;
    const connectionType = "artist";
    const externalUrl = cleanHttpUrl(item.external_url);

    if (!externalUrl) {
      const removed = await admin
        .from("player_music_connections")
        .delete()
        .eq("player_id", playerId)
        .eq("provider", provider)
        .eq("connection_type", connectionType);
      if (removed.error) throw new Error(removed.error.message);
      continue;
    }

    const artistName = cleanString(item.artist_name, 300);
    if (!artistName) throw new Error(`Completá el nombre del artista para ${provider}.`);
    const requestedStatus = cleanString(item.verification_status, 80);
    const verificationStatus = requestedStatus === "verified" ? "verified" : "unverified";

    const row = {
      player_id: playerId,
      provider,
      connection_type: connectionType,
      external_artist_id: cleanString(item.external_artist_id, 500),
      external_uri: cleanString(item.external_uri, 1000),
      external_url: externalUrl,
      artist_name: artistName,
      artist_image_url: cleanHttpUrl(item.artist_image_url),
      verification_status: verificationStatus,
      updated_at: new Date().toISOString(),
    };

    const saved = await admin
      .from("player_music_connections")
      .upsert(row, { onConflict: "player_id,provider,connection_type" });
    if (saved.error) throw new Error(saved.error.message);
  }
}

async function responsePayload(admin: ReturnType<typeof createAdminSupabase>, playerId: string) {
  const [playerResult, musicResult] = await Promise.all([
    admin.from("players").select("*").eq("id", playerId).single(),
    admin
      .from("player_music_connections")
      .select("id,player_id,provider,connection_type,external_artist_id,external_uri,external_url,artist_name,artist_image_url,verification_status,metadata,last_synced_at")
      .eq("player_id", playerId)
      .order("provider"),
  ]);
  if (playerResult.error) throw new Error(playerResult.error.message);
  if (musicResult.error) throw new Error(musicResult.error.message);
  return { player: playerResult.data, musicConnections: musicResult.data ?? [] };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await resolveEditablePlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });
    return NextResponse.json(await responsePayload(admin, player.id as string));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar la identidad pública.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await resolveEditablePlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const changes = sanitizeIdentity(body.identity);
    if (Object.keys(changes).length) {
      const updated = await admin.from("players").update(changes).eq("id", player.id);
      if (updated.error) throw new Error(updated.error.message);
    }
    await syncMusicConnections(admin, player.id as string, body.music_connections);

    return NextResponse.json(await responsePayload(admin, player.id as string));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la identidad pública.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
