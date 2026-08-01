import { NextRequest, NextResponse } from "next/server";
import { normalizePublicSlug } from "@/core/integrations/instagram/mapper";
import type { InstagramMedia } from "@/core/integrations/instagram/types";
import { importInstagramImage } from "@/lib/public-media-storage";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REGISTERED_USERNAME_ERROR = "Este usuario ya está registrado.";

const RESERVED_SLUGS = new Set([
  "login", "registro", "auth", "admin", "api", "matrix", "players", "studios",
  "profile", "onboarding", "creator-studio", "avatar", "catalogo", "biblioteca",
  "tienda", "mundos", "settings", "vip", "checkout", "legal", "support", "webhooks",
]);

function registeredUsernameError() {
  const error = new Error(REGISTERED_USERNAME_ERROR);
  (error as Error & { status?: number }).status = 409;
  return error;
}

async function loadSession(admin: ReturnType<typeof createAdminSupabase>, userId: string, sessionId: string) {
  const { data, error } = await admin
    .from("social_import_sessions")
    .select("id,user_id,connection_id,status,available_profile_data,selected_profile_data,available_media,selected_media,expires_at")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No encontramos esa importación.");
  if (new Date(data.expires_at as string) <= new Date()) throw new Error("La importación venció. Volvé a conectar Instagram.");
  return data;
}

async function availableSlug(admin: ReturnType<typeof createAdminSupabase>, requested: string, currentPlayerId?: string) {
  const base = normalizePublicSlug(requested) || "player";
  const safeBase = RESERVED_SLUGS.has(base) ? `${base}-player` : base;

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? safeBase : `${safeBase}-${suffix + 1}`;
    const [{ data: player }, { data: alias }] = await Promise.all([
      admin.from("players").select("id").eq("slug", candidate).maybeSingle(),
      admin.from("public_slug_aliases").select("id,entity_id").eq("normalized_alias", candidate).maybeSingle(),
    ]);
    const playerConflict = player && player.id !== currentPlayerId;
    const aliasConflict = alias && alias.entity_id !== currentPlayerId;
    if (!playerConflict && !aliasConflict) return candidate;
  }
  throw new Error("No pudimos generar una URL pública disponible.");
}

function allowedProfileData(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const categories = Array.isArray(raw.professional_categories)
    ? raw.professional_categories.filter((item): item is string => typeof item === "string").slice(0, 12)
    : [];
  return {
    display_name: typeof raw.display_name === "string" ? raw.display_name.trim().slice(0, 80) : "",
    username: typeof raw.username === "string" ? raw.username.replace(/^@/, "").trim().slice(0, 50) : null,
    slug: typeof raw.slug === "string" ? raw.slug : "",
    short_bio: typeof raw.short_bio === "string" ? raw.short_bio.trim().slice(0, 500) : null,
    professional_categories: categories,
    profile_image_url: typeof raw.profile_image_url === "string" ? raw.profile_image_url : null,
    social_links: Array.isArray(raw.social_links) ? raw.social_links.slice(0, 20) : [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
    if (!sessionId) return NextResponse.json({ error: "Falta sessionId." }, { status: 400 });
    const session = await loadSession(createAdminSupabase(), user.id, sessionId);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar la importación.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json()) as {
      sessionId?: string;
      profile?: unknown;
      selectedMediaIds?: string[];
      coverMediaId?: string | null;
      publish?: boolean;
    };
    if (!body.sessionId) return NextResponse.json({ error: "Falta sessionId." }, { status: 400 });

    const admin = createAdminSupabase();
    const session = await loadSession(admin, user.id, body.sessionId);
    if (!["ready", "created"].includes(session.status as string)) {
      return NextResponse.json({ error: "La importación ya fue procesada o cancelada." }, { status: 409 });
    }

    const availableProfile = allowedProfileData(session.available_profile_data);
    const requestedProfile = allowedProfileData({ ...availableProfile, ...(body.profile as object) });
    if (!requestedProfile.display_name) {
      return NextResponse.json({ error: "El nombre artístico es obligatorio." }, { status: 400 });
    }

    const availableMedia = Array.isArray(session.available_media)
      ? (session.available_media as InstagramMedia[])
      : [];
    const selectedIds = Array.isArray(body.selectedMediaIds)
      ? [...new Set(body.selectedMediaIds.filter((id) => typeof id === "string"))].slice(0, 12)
      : [];
    const selectedMedia = availableMedia.filter((media) => selectedIds.includes(media.id));
    if (selectedMedia.length > 0 && selectedMedia.length < 3) {
      return NextResponse.json({ error: "Elegí al menos 3 contenidos o continuá sin galería." }, { status: 400 });
    }

    const [{ data: ownedPlayer, error: ownedPlayerError }, { data: membership, error: membershipError }] = await Promise.all([
      admin.from("players").select("*").eq("owner_user_id", user.id).maybeSingle(),
      admin.from("player_members").select("player_id,role").eq("user_id", user.id).eq("status", "active").in("role", ["owner", "manager", "editor"]).limit(1).maybeSingle(),
    ]);
    if (ownedPlayerError) throw new Error(ownedPlayerError.message);
    if (membershipError) throw new Error(membershipError.message);

    let player = ownedPlayer;
    if (!player && membership?.player_id) {
      const { data, error } = await admin.from("players").select("*").eq("id", membership.player_id).maybeSingle();
      if (error) throw new Error(error.message);
      player = data;
    }

    // Instagram is the stable identity source for this flow. If an admin-seeded
    // Player already exists with that username (0800Bless, Clouva, etc.), reuse
    // and claim that exact row instead of trying to INSERT a duplicate.
    if (requestedProfile.username) {
      const { data: usernamePlayer, error: usernamePlayerError } = await admin
        .from("players")
        .select("*")
        .ilike("username", requestedProfile.username)
        .maybeSingle();
      if (usernamePlayerError) throw new Error(usernamePlayerError.message);

      if (usernamePlayer && usernamePlayer.id !== player?.id) {
        const belongsToAnotherUser = Boolean(
          usernamePlayer.owner_user_id && usernamePlayer.owner_user_id !== user.id,
        );
        if (player || belongsToAnotherUser) throw registeredUsernameError();
        player = usernamePlayer;
      }
    }

    const slug = (player?.slug as string | undefined)
      || await availableSlug(
        admin,
        requestedProfile.slug || requestedProfile.username || requestedProfile.display_name,
        player?.id as string | undefined,
      );
    const username = (player?.username as string | null | undefined) || requestedProfile.username;

    let profileImageUrl = player?.profile_image_url as string | null | undefined;
    if (requestedProfile.profile_image_url && requestedProfile.profile_image_url !== profileImageUrl) {
      const imported = await importInstagramImage({
        url: requestedProfile.profile_image_url,
        ownerType: "players",
        ownerId: (player?.id as string | undefined) || user.id,
        purpose: "profile",
      });
      profileImageUrl = imported.publicUrl;
    }

    const coverMedia = availableMedia.find((media) => media.id === body.coverMediaId);
    let coverUrl = player?.cover_url as string | null | undefined;
    if (coverMedia) {
      const source = coverMedia.media_type === "VIDEO" ? coverMedia.thumbnail_url : coverMedia.media_url;
      if (source) {
        const imported = await importInstagramImage({
          url: source,
          ownerType: "players",
          ownerId: (player?.id as string | undefined) || user.id,
          purpose: "cover",
        });
        coverUrl = imported.publicUrl;
      }
    }

    const finalOwnerUserId = player?.owner_user_id || user.id;
    const isSelfClaim = finalOwnerUserId === user.id;

    const playerValues = {
      owner_user_id: finalOwnerUserId,
      slug,
      display_name: requestedProfile.display_name,
      username,
      short_bio: requestedProfile.short_bio,
      professional_categories: requestedProfile.professional_categories,
      disciplines: requestedProfile.professional_categories,
      profile_image_url: profileImageUrl || null,
      cover_url: coverUrl || null,
      social_links: requestedProfile.social_links,
      claim_status: isSelfClaim ? "claimed" : (player?.claim_status || "claimed"),
      claimed_at: isSelfClaim ? (player?.claimed_at || new Date().toISOString()) : (player?.claimed_at || null),
      publication_status: body.publish ? "published" : "draft",
      is_published: Boolean(body.publish),
      instagram_last_import_at: new Date().toISOString(),
    };

    if (player) {
      const { data, error } = await admin.from("players").update(playerValues).eq("id", player.id).select("*").single();
      if (error) throw new Error(error.message);
      player = data;
    } else {
      const { data, error } = await admin.from("players").insert(playerValues).select("*").single();
      if (error) throw new Error(error.message);
      player = data;
    }

    // A reused placeholder also needs the canonical owner membership. Upsert
    // makes retries idempotent and never creates a second Player.
    if (isSelfClaim) {
      const { error: memberError } = await admin.from("player_members").upsert({
        player_id: player.id,
        user_id: user.id,
        role: "owner",
        status: "active",
        joined_at: new Date().toISOString(),
      }, { onConflict: "player_id,user_id" });
      if (memberError) throw new Error(memberError.message);
    }

    const mediaRows = [] as Record<string, unknown>[];
    for (let index = 0; index < selectedMedia.length; index += 1) {
      const media = selectedMedia[index];
      const imageSource = media.media_type === "VIDEO" ? media.thumbnail_url : media.media_url;
      let stored: { publicUrl: string; storagePath: string } | null = null;
      if (imageSource) {
        stored = await importInstagramImage({
          url: imageSource,
          ownerType: "players",
          ownerId: player.id,
          purpose: media.media_type === "VIDEO" ? "thumbnail" : "gallery",
        });
      }
      mediaRows.push({
        player_id: player.id,
        media_type: media.media_type === "VIDEO" ? "video" : "image",
        origin: "instagram",
        external_id: media.id,
        source_url: media.permalink || media.media_url || null,
        storage_path: stored?.storagePath || null,
        public_url: stored?.publicUrl || null,
        thumbnail_url: stored?.publicUrl || media.thumbnail_url || null,
        caption: media.caption || null,
        display_order: index,
        visibility: body.publish ? "public" : "draft",
        imported_at: new Date().toISOString(),
      });
    }

    if (mediaRows.length > 0) {
      const { error: mediaError } = await admin.from("player_media").upsert(mediaRows, {
        onConflict: "origin,external_id,player_id",
      });
      if (mediaError) throw new Error(mediaError.message);
    }

    await admin.from("public_slug_aliases").upsert({
      alias: slug,
      entity_type: "player",
      entity_id: player.id,
      is_primary: true,
      redirect_to_primary: true,
    }, { onConflict: "normalized_alias" });

    const { error: sessionError } = await admin
      .from("social_import_sessions")
      .update({
        status: "confirmed",
        selected_profile_data: requestedProfile,
        selected_media: selectedMedia,
        completed_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .eq("status", session.status);
    if (sessionError) throw new Error(sessionError.message);

    return NextResponse.json({
      playerId: player.id,
      slug: player.slug,
      publicUrl: `/${player.slug}`,
      status: player.publication_status,
    });
  } catch (error) {
    console.error("instagram_import_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    const rawMessage = error instanceof Error ? error.message : "No se pudo crear la presentación.";
    const isUsernameConflict = rawMessage.includes("players_username_key") || rawMessage === REGISTERED_USERNAME_ERROR;
    const message = isUsernameConflict ? REGISTERED_USERNAME_ERROR : rawMessage;
    const explicitStatus = (error as Error & { status?: number })?.status;
    const status = explicitStatus ?? (isAuthError(error) ? 401 : isUsernameConflict ? 409 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
