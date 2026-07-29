// Types for the Players/Estudios public ecosystem. Mirrors the hand-maintained
// style of lib/community-data.ts (database.types.ts doesn't cover these tables).

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
  profile_image_url: string | null;
  hero_image_url: string | null;
  cover_url: string | null;
  contact_email: string | null;
  booking_email: string | null;
  whatsapp_url: string | null;
  claim_status: "unclaimed" | "invited" | "pending" | "claimed" | "rejected";
  is_verified: boolean;
  is_published: boolean;
  publication_status: "draft" | "in_review" | "published" | "unpublished" | "suspended";
  seo_title: string | null;
  seo_description: string | null;
};

export type PlayerStudioAffiliation = {
  role: string | null;
  is_primary: boolean;
  studio: { slug: string; name: string; logo_url: string | null } | null;
};

export type StudioRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url: string | null;
  description: string | null;
  city: string | null;
  country: string | null;
};

export type StudioPlayer = {
  role: string | null;
  is_primary: boolean;
  player: Pick<Player, "slug" | "display_name" | "primary_role" | "profile_image_url"> | null;
};

export const playerPublicSelect =
  "id,owner_user_id,slug,display_name,username,primary_role,short_bio,long_bio,tagline,secondary_tagline,origin,location,genres,disciplines,profile_image_url,hero_image_url,cover_url,contact_email,booking_email,whatsapp_url,claim_status,is_verified,is_published,publication_status,seo_title,seo_description";

export const playerStudiosSelect = "role,is_primary,studio:studios(slug,name,logo_url)";

export const studioPlayersSelect = "role,is_primary,player:players(slug,display_name,primary_role,profile_image_url)";
