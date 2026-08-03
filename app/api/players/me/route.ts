import { NextRequest, NextResponse } from "next/server";
import { normalizePublicSlug } from "@/core/integrations/instagram/mapper";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { completePendingStudioJoins } from "@/lib/server/studio-memberships";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = new Set([
  "display_name", "username", "short_bio", "long_bio", "tagline", "secondary_tagline",
  "origin", "location", "genres", "disciplines", "professional_categories", "profile_image_url",
  "hero_image_url", "cover_url", "logo_url", "spotify_profile_url", "youtube_channel_url", "contact_email",
  "booking_email", "whatsapp_url", "social_links", "theme_key", "accent_color", "font_style",
  "privacy_status", "seo_title", "seo_description", "share_title", "share_description", "og_image_url",
]);

async function findEditablePlayer(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data: owned, error: ownedError } = await admin.from("players").select("*").eq("owner_user_id", userId).maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (owned) return owned;

  const { data: member, error: memberError } = await admin
    .from("player_members")
    .select("player_id,role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) return null;

  const { data, error } = await admin.from("players").select("*").eq("id", member.player_id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function activatePlayerMode(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { error } = await admin.from("profile_modes").upsert(
    { user_id: userId, mode: "player", status: "active", activated_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "user_id,mode" },
  );
  if (error) throw new Error(error.message);
}

async function pendingStudioReturnPath(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data, error } = await admin
    .from("pending_studio_joins")
    .select("return_path")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const path = typeof data?.return_path === "string" ? data.return_path : null;
  return path?.startsWith("/studios/") ? path : null;
}

async function availableSlug(admin: ReturnType<typeof createAdminSupabase>, requested: string, currentId?: string) {
  const base = normalizePublicSlug(requested) || "player";
  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const { data } = await admin.from("players").select("id").eq("slug", slug).maybeSingle();
    if (!data || data.id === currentId) return slug;
  }
  throw new Error("No pudimos generar una URL disponible.");
}

function sanitizeUpdate(input: unknown) {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!EDITABLE_FIELDS.has(key)) continue;
    if (["genres", "disciplines", "professional_categories"].includes(key)) {
      output[key] = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 20)
        : [];
    } else if (key === "social_links") {
      output[key] = Array.isArray(value) ? value.slice(0, 30) : [];
    } else if (typeof value === "string") {
      output[key] = value.trim().slice(0, key.includes("bio") ? 4000 : 500);
    } else if (value === null) {
      output[key] = null;
    }
  }
  return output;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await findEditablePlayer(createAdminSupabase(), user.id);
    return NextResponse.json({ player });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar tu Player.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const existing = await findEditablePlayer(admin, user.id);
    if (existing) {
      await activatePlayerMode(admin, user.id);
      let completedStudioJoins = 0;
      let pendingStudioReturnPathValue: string | null = null;
      if (existing.owner_user_id === user.id && existing.is_published) {
        pendingStudioReturnPathValue = await pendingStudioReturnPath(admin, user.id);
        completedStudioJoins = await completePendingStudioJoins({ admin, userId: user.id, playerId: existing.id as string });
      }
      await admin.from("profiles").update({ onboarding_status: existing.is_published ? "published" : "player_created" }).eq("id", user.id);
      return NextResponse.json({
        player: existing,
        created: false,
        completedStudioJoins,
        pendingStudioReturnPath: pendingStudioReturnPathValue,
      });
    }

    const body = (await request.json().catch(() => ({}))) as {
      professional_categories?: string[];
      display_name?: string;
    };
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name,full_name,username")
      .eq("id", user.id)
      .maybeSingle();
    const displayName = body.display_name?.trim() || profile?.display_name || profile?.full_name || user.email?.split("@")[0] || "Player";
    const slug = await availableSlug(admin, profile?.username || displayName);
    const categories = Array.isArray(body.professional_categories)
      ? body.professional_categories.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 12)
      : [];

    const { data: player, error } = await admin
      .from("players")
      .insert({
        owner_user_id: user.id,
        slug,
        display_name: displayName,
        username: profile?.username || null,
        professional_categories: categories,
        disciplines: categories,
        primary_role: categories[0] || null,
        claim_status: "claimed",
        claimed_at: new Date().toISOString(),
        publication_status: "draft",
        is_published: false,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const { error: memberError } = await admin.from("player_members").insert({
      player_id: player.id,
      user_id: user.id,
      role: "owner",
      status: "active",
      joined_at: new Date().toISOString(),
    });
    if (memberError) {
      await admin.from("players").delete().eq("id", player.id);
      throw new Error(memberError.message);
    }

    const { error: onboardingError } = await admin
      .from("profiles")
      .update({ onboarding_status: "player_created", onboarding_completed_at: null })
      .eq("id", user.id);
    if (onboardingError) {
      await admin.from("player_members").delete().eq("player_id", player.id).eq("user_id", user.id);
      await admin.from("players").delete().eq("id", player.id);
      throw new Error(onboardingError.message);
    }

    await activatePlayerMode(admin, user.id);
    // Studio membership projection waits until the Player is published. This
    // prevents a draft identity from appearing in a public Studio roster.
    return NextResponse.json({ player, created: true, completedStudioJoins: 0, pendingStudioReturnPath: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear tu Player.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await findEditablePlayer(admin, user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const changes = sanitizeUpdate(body);
    if (typeof body.slug === "string" && body.slug.trim()) {
      changes.slug = await availableSlug(admin, body.slug, player.id as string);
    }
    if (body.publication_action === "publish") {
      if (!String(changes.display_name || player.display_name || "").trim()) {
        return NextResponse.json({ error: "El nombre artístico es obligatorio." }, { status: 400 });
      }
      changes.is_published = true;
      changes.publication_status = "published";
    } else if (body.publication_action === "unpublish") {
      changes.is_published = false;
      changes.publication_status = "unpublished";
    } else {
      changes.publication_status = player.publication_status === "published" ? "published" : "draft";
    }

    const { data, error } = await admin.from("players").update(changes).eq("id", player.id).select("*").single();
    if (error) throw new Error(error.message);

    await admin.from("public_slug_aliases").upsert({
      alias: data.slug,
      entity_type: "player",
      entity_id: data.id,
      is_primary: true,
      redirect_to_primary: true,
    }, { onConflict: "normalized_alias" });

    let completedStudioJoins = 0;
    let pendingStudioReturnPathValue: string | null = null;
    if (body.publication_action === "publish") {
      const { error: onboardingError } = await admin
        .from("profiles")
        .update({ onboarding_status: "published", onboarding_completed_at: new Date().toISOString() })
        .eq("id", user.id);
      if (onboardingError) throw new Error(onboardingError.message);
      if (data.owner_user_id === user.id) {
        pendingStudioReturnPathValue = await pendingStudioReturnPath(admin, user.id);
        completedStudioJoins = await completePendingStudioJoins({ admin, userId: user.id, playerId: data.id });
      }
    }

    return NextResponse.json({
      player: data,
      completedStudioJoins,
      pendingStudioReturnPath: pendingStudioReturnPathValue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar tu Player.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
