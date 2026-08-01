import type { SupabaseClient } from "@supabase/supabase-js";

// Builds the identity brief Gemini will work from (spec section 9). Every
// field here comes straight from data the user already confirmed by
// publishing their Player -- nothing is inferred at this stage. The later
// analysis/copy steps must only ever add *proposals* on top of this, never
// treat inference as fact.
export type IdentityBrief = {
  player_id: string;
  display_name: string;
  username: string | null;
  professional_categories: string[];
  primary_role: string | null;
  short_bio: string | null;
  long_bio: string | null;
  tagline: string | null;
  origin: string | null;
  location: string | null;
  genres: string[];
  disciplines: string[];
  profile_image: string | null;
  selected_cover: string | null;
  logo_url: string | null;
  selected_gallery: string[];
  social_links: unknown[];
  spotify_url: string | null;
  youtube_url: string | null;
  studios: Array<{ name: string; slug: string; role: string | null; is_primary: boolean }>;
  confirmed_facts: string[];
  missing_information: string[];
};

function pushIfPresent(list: string[], label: string, value: unknown) {
  const present = Array.isArray(value) ? value.length > 0 : Boolean(value);
  list.push(present ? `${label}: confirmado por el usuario` : label);
  return present;
}

export async function buildIdentityBrief(
  admin: SupabaseClient,
  playerId: string,
): Promise<{ brief: IdentityBrief; sourceSnapshot: Record<string, unknown> }> {
  const [{ data: player, error: playerError }, { data: media, error: mediaError }, { data: studioLinks, error: studioError }] = await Promise.all([
    admin.from("players").select("*").eq("id", playerId).single(),
    admin
      .from("player_media")
      .select("public_url,thumbnail_url,media_type,display_order,visibility")
      .eq("player_id", playerId)
      .order("display_order", { ascending: true }),
    admin
      .from("player_studios")
      .select("role,is_primary,is_visible,studios(name,slug)")
      .eq("player_id", playerId)
      .eq("is_visible", true),
  ]);

  if (playerError) throw new Error(playerError.message);
  if (!player) throw new Error("El Player no existe.");
  if (mediaError) throw new Error(mediaError.message);
  if (studioError) throw new Error(studioError.message);

  const gallery = (media ?? [])
    .filter((item) => item.visibility === "public" || item.visibility === "draft")
    .map((item) => item.public_url as string | null)
    .filter((url): url is string => Boolean(url));

  const studios = (studioLinks ?? [])
    .map((link) => {
      const studio = link.studios as unknown as { name: string; slug: string } | null;
      if (!studio) return null;
      return { name: studio.name, slug: studio.slug, role: link.role as string | null, is_primary: Boolean(link.is_primary) };
    })
    .filter((s): s is { name: string; slug: string; role: string | null; is_primary: boolean } => Boolean(s));

  const confirmedFacts: string[] = [];
  const missingInformation: string[] = [];

  const track = (label: string, value: unknown) => {
    if (pushIfPresent(confirmedFacts, label, value)) return;
    confirmedFacts.pop();
    missingInformation.push(label);
  };

  track("nombre artístico", player.display_name);
  track("username", player.username);
  track("categorías profesionales", player.professional_categories);
  track("rol principal", player.primary_role);
  track("biografía corta", player.short_bio);
  track("origen", player.origin);
  track("ubicación", player.location);
  track("géneros", player.genres);
  track("disciplinas", player.disciplines);
  track("foto de perfil", player.profile_image_url);
  track("portada", player.cover_url);
  track("logo", player.logo_url);
  track("galería", gallery.length > 0 ? gallery : null);
  track("links sociales", player.social_links);
  track("Spotify", player.spotify_profile_url);
  track("YouTube", player.youtube_channel_url);
  track("estudios vinculados", studios.length > 0 ? studios : null);

  const brief: IdentityBrief = {
    player_id: player.id as string,
    display_name: player.display_name as string,
    username: (player.username as string | null) ?? null,
    professional_categories: (player.professional_categories as string[] | null) ?? [],
    primary_role: (player.primary_role as string | null) ?? null,
    short_bio: (player.short_bio as string | null) ?? null,
    long_bio: (player.long_bio as string | null) ?? null,
    tagline: (player.tagline as string | null) ?? null,
    origin: (player.origin as string | null) ?? null,
    location: (player.location as string | null) ?? null,
    genres: (player.genres as string[] | null) ?? [],
    disciplines: (player.disciplines as string[] | null) ?? [],
    profile_image: (player.profile_image_url as string | null) ?? null,
    selected_cover: (player.cover_url as string | null) ?? null,
    logo_url: (player.logo_url as string | null) ?? null,
    selected_gallery: gallery,
    social_links: (player.social_links as unknown[] | null) ?? [],
    spotify_url: (player.spotify_profile_url as string | null) ?? null,
    youtube_url: (player.youtube_channel_url as string | null) ?? null,
    studios,
    confirmed_facts: confirmedFacts,
    missing_information: missingInformation,
  };

  return { brief, sourceSnapshot: player as Record<string, unknown> };
}

// Extracted from what buildPrompt used to build inline in vip-profile-gemini.ts
// -- kept here, next to the brief, now that generateProfileCopy takes a
// generic facts bag shared with the Studio path.
export function playerBriefToFacts(brief: IdentityBrief): Record<string, unknown> {
  return {
    display_name: brief.display_name,
    username: brief.username,
    professional_categories: brief.professional_categories,
    primary_role: brief.primary_role,
    existing_short_bio: brief.short_bio,
    origin: brief.origin,
    location: brief.location,
    genres: brief.genres,
    disciplines: brief.disciplines,
    studios: brief.studios.map((s) => ({ name: s.name, role: s.role })),
    has_spotify: Boolean(brief.spotify_url),
    has_youtube: Boolean(brief.youtube_url),
    has_gallery: brief.selected_gallery.length > 0,
  };
}

export type StudioIdentityBrief = {
  studio_id: string;
  name: string;
  description: string | null;
  city: string | null;
  country: string | null;
  website_url: string | null;
  founded_year: number | null;
  logo_url: string | null;
  members: Array<{ name: string; role: string | null }>;
  services: Array<{ name: string; category: string | null }>;
  social_links: unknown[];
  confirmed_facts: string[];
  missing_information: string[];
};

export async function buildStudioIdentityBrief(
  admin: SupabaseClient,
  studioId: string,
): Promise<{ brief: StudioIdentityBrief; sourceSnapshot: Record<string, unknown> }> {
  const [{ data: studio, error: studioError }, { data: memberLinks, error: memberError }, { data: services, error: servicesError }] = await Promise.all([
    admin.from("studios").select("*").eq("id", studioId).single(),
    admin.from("studio_members").select("role,status,profiles(full_name)").eq("studio_id", studioId).eq("status", "active"),
    admin.from("studio_services").select("name,category").eq("studio_id", studioId).eq("is_active", true),
  ]);

  if (studioError) throw new Error(studioError.message);
  if (!studio) throw new Error("El Estudio no existe.");
  if (memberError) throw new Error(memberError.message);
  if (servicesError) throw new Error(servicesError.message);

  const members = (memberLinks ?? [])
    .map((link) => {
      const profile = link.profiles as unknown as { full_name: string | null } | null;
      if (!profile?.full_name) return null;
      return { name: profile.full_name, role: link.role as string | null };
    })
    .filter((m): m is { name: string; role: string | null } => Boolean(m));

  const confirmedFacts: string[] = [];
  const missingInformation: string[] = [];
  const track = (label: string, value: unknown) => {
    if (pushIfPresent(confirmedFacts, label, value)) return;
    confirmedFacts.pop();
    missingInformation.push(label);
  };

  track("nombre del Estudio", studio.name);
  track("descripción", studio.description);
  track("ciudad", studio.city);
  track("país", studio.country);
  track("sitio web", studio.website_url);
  track("logo", studio.logo_url);
  track("integrantes", members.length > 0 ? members : null);
  track("servicios ofrecidos", (services ?? []).length > 0 ? services : null);
  track("links sociales", studio.social_links);

  const brief: StudioIdentityBrief = {
    studio_id: studio.id as string,
    name: studio.name as string,
    description: (studio.description as string | null) ?? null,
    city: (studio.city as string | null) ?? null,
    country: (studio.country as string | null) ?? null,
    website_url: (studio.website_url as string | null) ?? null,
    founded_year: (studio.founded_year as number | null) ?? null,
    logo_url: (studio.logo_url as string | null) ?? null,
    members,
    services: (services ?? []) as Array<{ name: string; category: string | null }>,
    social_links: (studio.social_links as unknown[] | null) ?? [],
    confirmed_facts: confirmedFacts,
    missing_information: missingInformation,
  };

  return { brief, sourceSnapshot: studio as Record<string, unknown> };
}

export function studioBriefToFacts(brief: StudioIdentityBrief): Record<string, unknown> {
  return {
    name: brief.name,
    existing_description: brief.description,
    city: brief.city,
    country: brief.country,
    founded_year: brief.founded_year,
    members: brief.members,
    services: brief.services,
    has_website: Boolean(brief.website_url),
  };
}
