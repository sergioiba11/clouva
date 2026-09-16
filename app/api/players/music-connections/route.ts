import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANUAL_PROVIDERS = new Set(["apple_music", "youtube_music", "soundcloud"]);
const ALL_PROVIDERS = new Set(["spotify", "youtube", ...MANUAL_PROVIDERS]);

const PROVIDER_HOSTS: Record<string, string[]> = {
  spotify: ["open.spotify.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  apple_music: ["music.apple.com"],
  youtube_music: ["music.youtube.com"],
  soundcloud: ["soundcloud.com", "www.soundcloud.com"],
};

async function editablePlayerId(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data: owned, error: ownedError } = await admin.from("players").select("id").eq("owner_user_id", userId).maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (owned?.id) return owned.id as string;

  const { data: member, error: memberError } = await admin
    .from("player_members")
    .select("player_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  return member?.player_id as string | undefined;
}

function normalizedUrl(value: unknown, provider: string) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const allowed = PROVIDER_HOSTS[provider] || [];
    if (allowed.length && !allowed.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanText(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const playerId = await editablePlayerId(admin, user.id);
    if (!playerId) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });

    const { data, error } = await admin
      .from("player_music_connections")
      .select("id,player_id,provider,connection_type,external_artist_id,external_uri,external_url,artist_name,artist_image_url,verification_status,metadata,last_synced_at,updated_at")
      .eq("player_id", playerId)
      .order("provider");
    if (error) throw new Error(error.message);
    return NextResponse.json({ connections: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron cargar las plataformas musicales." },
      { status: isAuthError(error) ? 401 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const playerId = await editablePlayerId(admin, user.id);
    if (!playerId) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = cleanText(body.provider, 40)?.toLowerCase() || "";
    if (!ALL_PROVIDERS.has(provider)) return NextResponse.json({ error: "Proveedor musical no válido." }, { status: 400 });
    if (!MANUAL_PROVIDERS.has(provider)) {
      return NextResponse.json({
        error: provider === "spotify"
          ? "Spotify se administra desde la conexión oficial de Spotify del Player."
          : "YouTube se administra desde la conexión oficial de YouTube del Player.",
        code: "managed_provider",
      }, { status: 409 });
    }

    const externalUrl = normalizedUrl(body.external_url, provider);
    if (!externalUrl) return NextResponse.json({ error: "La URL no corresponde al proveedor seleccionado." }, { status: 400 });

    const row = {
      player_id: playerId,
      provider,
      connection_type: "artist",
      external_artist_id: cleanText(body.external_artist_id, 180),
      external_uri: cleanText(body.external_uri, 300),
      external_url: externalUrl,
      artist_name: cleanText(body.artist_name, 180),
      artist_image_url: normalizedUrl(body.artist_image_url, provider) || cleanText(body.artist_image_url, 1200),
      verification_status: "unverified",
      metadata: { source: "player_identity_editor", manually_added: true },
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("player_music_connections")
      .upsert(row, { onConflict: "player_id,provider,connection_type" })
      .select("id,player_id,provider,connection_type,external_artist_id,external_uri,external_url,artist_name,artist_image_url,verification_status,metadata,last_synced_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ connection: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar la plataforma musical." },
      { status: isAuthError(error) ? 401 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const playerId = await editablePlayerId(admin, user.id);
    if (!playerId) return NextResponse.json({ error: "No pudimos resolver tu Player." }, { status: 404 });

    const provider = request.nextUrl.searchParams.get("provider")?.trim().toLowerCase() || "";
    if (!MANUAL_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Esa conexión se administra desde su integración oficial." }, { status: 409 });
    }
    const { error } = await admin
      .from("player_music_connections")
      .delete()
      .eq("player_id", playerId)
      .eq("provider", provider)
      .eq("connection_type", "artist");
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo quitar la plataforma musical." },
      { status: isAuthError(error) ? 401 : 500 },
    );
  }
}
