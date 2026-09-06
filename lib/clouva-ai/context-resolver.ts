// Context Resolver — builds the *compact* context a Studio-scoped CLOUVA AI
// conversation gets, instead of the Orchestrator dumping full tables into
// the prompt. Two-step plain queries (not PostgREST embeds) so the FK/join
// shape doesn't have to be guessed — the tables involved (studios,
// studio_members, players, player_studios, player_profile_versions) are
// real domain tables, never reshaped or duplicated here.
//
// Deliberately NOT resolved here (left as an explicit boundary, not guessed
// at): a linked Workspace project (local code on the user's PC) — that
//   mapping lives in Workspace's own local project registry
//   (ProjectDescriptor.studioId, per the approved architecture), not in
//   Supabase, and resolving it needs the WorkspaceExecutor (Task 10) to
//   actually ask Desktop. A domain tool surfaces it on demand instead of
//   this resolver guessing.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUTTON_STYLES,
  DECORATION_TYPES,
  IMAGE_FITS,
  IMAGE_POSITIONS,
  LAYOUT_ICONS,
  LAYOUT_KINDS,
  LAYOUT_MODES,
  LAYOUT_SECTION_TYPES,
  NAV_STYLES,
  POSITIONED_ELEMENT_TYPES,
  PRECISE_DYNAMIC_SECTION_TYPES,
  RADIUS_VALUES,
  SECTION_VARIANTS,
  type LayoutConfig,
} from "@/lib/server/layout-config";

type StudioIdentityVersionContext = {
  id: string;
  versionNumber: number;
  status: string;
  copyConfig: Record<string, unknown> | null;
  visualConfig: Record<string, unknown> | null;
  layoutConfig: LayoutConfig | null;
  assetReferences: unknown[];
  createdAt: string | null;
  publishedAt: string | null;
};

export type StudioDesignerContext = {
  identity: {
    id: string;
    name: string;
    slug: string;
    tagline: string | null;
    description: string | null;
    city: string | null;
    country: string | null;
    websiteUrl: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    accentColor: string | null;
    palette: unknown;
    socialLinks: unknown;
    publicationStatus: string | null;
    isPublished: boolean;
    studioOsStatus: string | null;
  };
  versions: {
    published: StudioIdentityVersionContext | null;
    draft: StudioIdentityVersionContext | null;
  };
  assets: {
    logoUrl: string | null;
    coverUrl: string | null;
    media: Array<{
      id: string;
      mediaType: string | null;
      publicUrl: string | null;
      thumbnailUrl: string | null;
      caption: string | null;
      displayOrder: number | null;
    }>;
  };
  rendererCapabilities: {
    layoutModes: readonly string[];
    layoutKinds: readonly string[];
    sections: readonly string[];
    sectionVariants: typeof SECTION_VARIANTS;
    positionedElementTypes: readonly string[];
    preciseDynamicSectionTypes: readonly string[];
    decorations: readonly string[];
    icons: readonly string[];
    buttonStyles: readonly string[];
    imageFits: readonly string[];
    imagePositions: readonly string[];
    radiusValues: readonly string[];
    navStyles: readonly string[];
    structuredOnly: true;
    arbitraryHtml: false;
    arbitraryCss: false;
    responsiveViewportContext: true;
  };
};

export interface StudioContext {
  studio: { id: string; name: string; slug: string; tagline: string | null; description: string | null } | null;
  designer: StudioDesignerContext | null;
  summary: string;
}

interface MemberRow {
  role: string;
  displayName: string;
}

interface PlayerRow {
  id: string;
  displayName: string;
  role: string | null;
  secondaryRole: string | null;
  customTitle: string | null;
  latestProfileVersion: { versionNumber: number; status: string; profileLevel: string } | null;
}

const MAX_MEMBERS = 20;
const MAX_PLAYERS = 30;
const MAX_MEDIA = 30;

const RENDERER_CAPABILITIES: StudioDesignerContext["rendererCapabilities"] = {
  layoutModes: LAYOUT_MODES,
  layoutKinds: LAYOUT_KINDS,
  sections: LAYOUT_SECTION_TYPES,
  sectionVariants: SECTION_VARIANTS,
  positionedElementTypes: POSITIONED_ELEMENT_TYPES,
  preciseDynamicSectionTypes: PRECISE_DYNAMIC_SECTION_TYPES,
  decorations: DECORATION_TYPES,
  icons: LAYOUT_ICONS,
  buttonStyles: BUTTON_STYLES,
  imageFits: IMAGE_FITS,
  imagePositions: IMAGE_POSITIONS,
  radiusValues: RADIUS_VALUES,
  navStyles: NAV_STYLES,
  structuredOnly: true,
  arbitraryHtml: false,
  arbitraryCss: false,
  responsiveViewportContext: true,
};

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function versionContext(row: Record<string, unknown> | undefined): StudioIdentityVersionContext | null {
  if (!row) return null;
  return {
    id: String(row.id),
    versionNumber: Number(row.version_number) || 0,
    status: String(row.status || ""),
    copyConfig: recordOrNull(row.copy_config),
    visualConfig: recordOrNull(row.visual_config),
    layoutConfig: recordOrNull(row.layout_config) as LayoutConfig | null,
    assetReferences: Array.isArray(row.asset_references) ? row.asset_references.slice(0, 30) : [],
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
  };
}

export async function resolveStudioContext(supabase: SupabaseClient, studioId: string): Promise<StudioContext> {
  const { data: studio } = await supabase
    .from("studios")
    .select("id,name,slug,tagline,description,logo_url,cover_url,accent_color,palette,social_links,city,country,website_url,is_published,publication_status,studio_os_status")
    .eq("id", studioId)
    .maybeSingle();

  if (!studio) {
    return { studio: null, designer: null, summary: "El Estudio referenciado ya no existe o no es accesible." };
  }

  const [{ data: memberRows }, { data: playerLinkRows }, { data: identityVersionRows }, { data: mediaRows }] = await Promise.all([
    supabase.from("studio_members").select("profile_id,role").eq("studio_id", studioId).eq("status", "active").limit(MAX_MEMBERS),
    supabase
      .from("player_studios")
      .select("player_id,role,secondary_role,custom_title")
      .eq("studio_id", studioId)
      .eq("status", "active")
      .limit(MAX_PLAYERS),
    supabase
      .from("player_profile_versions")
      .select("id,version_number,status,copy_config,visual_config,layout_config,asset_references,created_at,published_at")
      .eq("studio_id", studioId)
      .in("status", ["published", "draft"])
      .order("version_number", { ascending: false }),
    supabase
      .from("player_media")
      .select("id,media_type,public_url,thumbnail_url,caption,display_order")
      .eq("studio_id", studioId)
      .eq("visibility", "public")
      .order("display_order", { ascending: true })
      .limit(MAX_MEDIA),
  ]);

  const profileIds = (memberRows ?? []).map((m) => m.profile_id);
  const playerIds = (playerLinkRows ?? []).map((p) => p.player_id);

  const [{ data: profileRows }, { data: playerRows }, { data: profileVersionRows }] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("id,display_name,username").in("id", profileIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; username: string | null }> }),
    playerIds.length
      ? supabase.from("players").select("id,display_name").in("id", playerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
    playerIds.length
      ? supabase
          .from("player_profile_versions")
          .select("player_id,version_number,status,profile_level,created_at")
          .in("player_id", playerIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Array<{ player_id: string; version_number: number; status: string; profile_level: string }> }),
  ]);

  const profileNameById = new Map((profileRows ?? []).map((p) => [p.id, p.display_name || p.username || "sin nombre"]));
  const playerNameById = new Map((playerRows ?? []).map((p) => [p.id, p.display_name]));

  // Rows came back newest-first — the first one seen per player_id is its
  // most recent profile version. Keep only that one, not the whole history.
  const latestVersionByPlayer = new Map<string, { versionNumber: number; status: string; profileLevel: string }>();
  for (const row of profileVersionRows ?? []) {
    if (latestVersionByPlayer.has(row.player_id)) continue;
    latestVersionByPlayer.set(row.player_id, { versionNumber: row.version_number, status: row.status, profileLevel: row.profile_level });
  }

  const members: MemberRow[] = (memberRows ?? []).map((m) => ({
    role: m.role,
    displayName: profileNameById.get(m.profile_id) ?? "sin nombre",
  }));

  const players: PlayerRow[] = (playerLinkRows ?? []).map((link) => ({
    id: link.player_id,
    displayName: playerNameById.get(link.player_id) ?? "sin nombre",
    role: link.role,
    secondaryRole: link.secondary_role,
    customTitle: link.custom_title,
    latestProfileVersion: latestVersionByPlayer.get(link.player_id) ?? null,
  }));

  const versionRows = (identityVersionRows ?? []) as Array<Record<string, unknown>>;
  const published = versionContext(versionRows.find((row) => row.status === "published"));
  const draft = versionContext(versionRows.find((row) => row.status === "draft"));
  const designer: StudioDesignerContext = {
    identity: {
      id: studio.id,
      name: studio.name,
      slug: studio.slug,
      tagline: studio.tagline,
      description: studio.description,
      city: studio.city,
      country: studio.country,
      websiteUrl: studio.website_url,
      logoUrl: studio.logo_url,
      coverUrl: studio.cover_url,
      accentColor: studio.accent_color,
      palette: studio.palette,
      socialLinks: studio.social_links,
      publicationStatus: studio.publication_status,
      isPublished: studio.is_published === true,
      studioOsStatus: studio.studio_os_status,
    },
    versions: { published, draft },
    assets: {
      logoUrl: studio.logo_url,
      coverUrl: studio.cover_url,
      media: (mediaRows ?? []).map((row) => ({
        id: String(row.id),
        mediaType: typeof row.media_type === "string" ? row.media_type : null,
        publicUrl: typeof row.public_url === "string" ? row.public_url : null,
        thumbnailUrl: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
        caption: typeof row.caption === "string" ? row.caption : null,
        displayOrder: typeof row.display_order === "number" ? row.display_order : null,
      })),
    },
    rendererCapabilities: RENDERER_CAPABILITIES,
  };

  const summary = summarize(studio, members, players, draft, published);
  return { studio, designer, summary };
}

function summarize(
  studio: { name: string; slug: string; tagline: string | null; description: string | null },
  members: MemberRow[],
  players: PlayerRow[],
  draft: StudioIdentityVersionContext | null,
  published: StudioIdentityVersionContext | null,
): string {
  const parts: string[] = [];
  parts.push(`Estudio activo: "${studio.name}" (slug: ${studio.slug}).`);
  if (studio.tagline) parts.push(`Tagline: ${studio.tagline}`);
  if (studio.description) parts.push(`Descripción: ${studio.description}`);

  parts.push(
    members.length
      ? `Miembros internos activos (${members.length}): ${members.map((m) => `${m.displayName} (${m.role})`).join(", ")}.`
      : "Sin miembros internos activos registrados.",
  );

  if (players.length) {
    const lines = players.map((p) => {
      const roles = [p.role, p.secondaryRole].filter(Boolean).join(" / ");
      const title = p.customTitle ? ` "${p.customTitle}"` : "";
      const version = p.latestProfileVersion
        ? ` — perfil visual: v${p.latestProfileVersion.versionNumber} (${p.latestProfileVersion.status}, ${p.latestProfileVersion.profileLevel})`
        : " — todavía sin perfil visual generado";
      return `${p.displayName}${title}${roles ? ` [${roles}]` : ""}${version}`;
    });
    parts.push(`Players vinculados (${players.length}): ${lines.join("; ")}.`);
  } else {
    parts.push("Todavía no hay Players vinculados a este Estudio.");
  }

  parts.push(
    `Identidad visual del Studio: ${published ? `publicada v${published.versionNumber}` : "sin versión publicada"}; ${draft ? `draft activo v${draft.versionNumber}` : "sin draft activo"}.`,
  );
  parts.push(
    "Código local vinculado: si el usuario pide revisar/ejecutar algo en su PC, usá las herramientas de Workspace — no está precargado acá.",
  );

  return parts.join("\n");
}
