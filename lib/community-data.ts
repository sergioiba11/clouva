// database.types.ts is a small hand-maintained stub that doesn't cover most
// tables (profiles, follows, studios, etc. aren't in it) -- these types are
// defined directly here, matching how app/u/[username]/page.tsx already
// types its own Supabase rows rather than sourcing them from Database.

export type SocialLink = {
  platform: "instagram" | "tiktok" | "youtube" | "discord" | "x" | "website";
  url: string;
};

export type Studio = {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string | null;
  city: string | null;
  country: string | null;
  founded_year: number | null;
  website_url: string | null;
  social_links: SocialLink[];
  created_at: string;
  updated_at: string;
};

export type StudioMemberProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  city: string | null;
};

export type StudioMember = {
  id: string;
  studio_id: string;
  profile_id: string;
  role: string;
  status: "active" | "invited" | "removed";
  joined_at: string;
  profiles?: StudioMemberProfile | null;
};

export type CommunityEvent = {
  id: string;
  studio_id: string | null;
  owner_profile_id: string | null;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  city: string | null;
  cover_url: string | null;
  ticket_url: string | null;
  created_at: string;
};

export type CommunityGalleryItem = {
  id: string;
  owner_profile_id: string;
  media_type: "image" | "video";
  media_url: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
};

export type CommunityProject = {
  id: string;
  owner_profile_id: string | null;
  studio_id: string | null;
  title: string;
  cover_url: string | null;
  release_type: "single" | "ep" | "album" | "video" | "other" | null;
  release_date: string | null;
  spotify_url: string | null;
  youtube_url: string | null;
  apple_music_url: string | null;
  soundcloud_url: string | null;
  bandcamp_url: string | null;
  description: string | null;
  created_at: string;
};

export const studioMemberSelect = "*, profiles(id, username, full_name, display_name, avatar_url, city)";

/** Parses profiles.social_links / studios.social_links (jsonb, default '[]',
 * never validated at write time) into a safe SocialLink[] -- tolerant of
 * malformed/legacy shapes rather than throwing. */
export function parseSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  const validPlatforms = new Set(["instagram", "tiktok", "youtube", "discord", "x", "website"]);
  return value.filter((entry): entry is SocialLink =>
    !!entry
    && typeof entry === "object"
    && typeof (entry as SocialLink).url === "string"
    && validPlatforms.has((entry as SocialLink).platform),
  );
}

/** UI-only convenience for showing/hiding studio edit controls. The real
 * enforcement is always the RLS policies on studios/studio_members --
 * never rely on this for anything security-sensitive. */
export async function getStudioPermission(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  studio: Pick<Studio, "id" | "owner_id">,
  userId: string | null,
): Promise<"owner" | "admin" | "none"> {
  if (!userId) return "none";
  if (studio.owner_id === userId) return "owner";
  const { data } = await supabase
    .from("studio_members")
    .select("role,status")
    .eq("studio_id", studio.id)
    .eq("profile_id", userId)
    .eq("status", "active")
    .maybeSingle();
  return data?.role === "admin" ? "admin" : "none";
}
