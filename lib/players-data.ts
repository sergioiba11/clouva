// Types for the Players/Estudios public ecosystem. These remain local because
// database.types.ts is hand-maintained and is not the production source of truth.

export type SocialLink = {
  platform: string;
  label?: string;
  username?: string;
  url: string;
  is_visible?: boolean;
  display_order?: number;
};

export type Player = {
  id: string;
  owner_user_id: string | null;
  slug: string;
  display_name: string;
  username: string | null;
  primary_role: string | null;
  short_bio: string | null;
  long_bio: string | null;
  tagline: string | null;
  secondary_tagline: string | null;
  origin: string | null;
  location: string | null;
  genres: string[];
  disciplines: string[];
  professional_categories: string[];
  social_links: unknown;
  profile_image_url: string | null;
  hero_image_url: string | null;
  cover_url: string | null;
  spotify_profile_url: string | null;
  youtube_channel_url: string | null;
  contact_email: string | null;
  booking_email: string | null;
  whatsapp_url: string | null;
  privacy_status: "public" | "unlisted" | "private";
  claim_status: "unclaimed" | "invited" | "pending" | "claimed" | "rejected";
  is_verified: boolean;
  is_published: boolean;
  publication_status: "draft" | "in_review" | "published" | "unpublished" | "suspended";
  seo_title: string | null;
  seo_description: string | null;
  share_title: string | null;
  share_description: string | null;
  og_image_url: string | null;
};

export type PlayerStudioAffiliation = {
  role: string | null;
  is_primary: boolean;
  studio: { id: string; slug: string; name: string; logo_url: string | null } | null;
};

export type PlayerMedia = {
  id: string;
  media_type: "image" | "video" | "audio" | "embed";
  origin: string;
  source_url: string | null;
  public_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  display_order: number;
};

export type StudioRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string | null;
  tagline: string | null;
  categories: string[];
  city: string | null;
  country: string | null;
  website_url: string | null;
  social_links: unknown;
  contact_email: string | null;
  is_published: boolean;
  publication_status: "draft" | "published" | "unpublished" | "suspended";
};

export type StudioPlayer = {
  role: string | null;
  is_primary: boolean;
  player: Pick<Player, "id" | "slug" | "display_name" | "primary_role" | "profile_image_url"> | null;
};

export function parsePlayerSocialLinks(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      platform: String(item.platform || "link").toLowerCase(),
      label: typeof item.label === "string" ? item.label : undefined,
      username: typeof item.username === "string" ? item.username : undefined,
      url: typeof item.url === "string" ? item.url : "",
      is_visible: item.is_visible !== false,
      display_order: Number(item.display_order || 0),
    }))
    .filter((item) => item.url && item.is_visible)
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
}

export const playerPublicSelect =
  "id,owner_user_id,slug,display_name,username,primary_role,short_bio,long_bio,tagline,secondary_tagline,origin,location,genres,disciplines,professional_categories,social_links,profile_image_url,hero_image_url,cover_url,spotify_profile_url,youtube_channel_url,contact_email,booking_email,whatsapp_url,privacy_status,claim_status,is_verified,is_published,publication_status,seo_title,seo_description,share_title,share_description,og_image_url";

export const playerStudiosSelect = "role,is_primary,studio:studios(id,slug,name,logo_url)";

export const studioPlayersSelect = "role,is_primary,player:players(id,slug,display_name,primary_role,profile_image_url)";
