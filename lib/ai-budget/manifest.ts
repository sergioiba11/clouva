import type { GeminiAspectRatio, GeminiImageModel } from "@/lib/gemini-image";

// Fase 1 -- mapa visual. Real routes only (confirmed via Glob against app/**,
// not assumed): Home = app/page.tsx (3D avatar scene, AvatarScene.tsx), no
// separate "Clover AI" page exists (/clouva-ai is the real chat route), no
// single avatar-creation page exists (/mi-flow/avatar-ia, /mi-flow/avatar,
// /mi-flow/avatar-customizer are three distinct routes).
export type AssetClassification = "A_css_svg" | "B_reuse_existing" | "C_generate_gemini" | "D_real_user_content";

export type ManifestEntry = {
  assetKey: string;
  page: string;
  route: string;
  section: string;
  purpose: string;
  aspectRatio: GeminiAspectRatio;
  resolution: "1K" | "2K" | "4K";
  transparent: boolean;
  model: GeminiImageModel;
  prompt: string;
  references: string[];
  maxAttempts: number;
  maxCostUsd: number;
  classification: AssetClassification;
  outputPathPrefix: string;
  consumingComponent: string;
  priority: number;
};

const BASE_IDENTITY =
  "Premium dark digital-universe aesthetic for CLOUVA, a music/creator identity platform. Deep black background (#050505), " +
  "violet and purple light (#7c3aed, #8b5cf6), blue-night undertones, soft volumetric glow, cinematic depth of field, " +
  "editorial rendered-art quality (not a flat gradient, not corporate SaaS, not a stock photo). No text, no logos, no UI chrome baked in.";

export const assetManifest: ManifestEntry[] = [
  {
    assetKey: "home-avatar-atmosphere-01",
    page: "Home",
    route: "/",
    section: "Atmósfera detrás de la escena 3D del avatar",
    purpose:
      "Fondo ambiental para envolver la escena 3D existente (AvatarScene) en el universo visual violeta/negro -- capa detrás del avatar, no reemplaza el 3D.",
    aspectRatio: "9:16",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} A vertical cinematic void for a single character to stand in: a dark stage-like void with distant ` +
      "violet nebula clouds low and soft, a faint circular glow on the ground beneath where a figure would stand, negative " +
      "space in the center-vertical axis reserved for a 3D character, sense of an intimate personal universe, portrait orientation.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/home",
    consumingComponent: "components/clouva/AvatarScene.tsx",
    priority: 1,
  },
  {
    assetKey: "matrix-network-master-01",
    page: "Matrix",
    route: "/matrix",
    section: "Composición maestra de la Matrix (Players + Estudios conectados)",
    purpose:
      "Recurso propio para Matrix -- no comparte fondo con Home. Debe transmitir una red viva de identidades (Players/Estudios) conectadas dentro de un espacio de datos.",
    aspectRatio: "16:9",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} A vast dark network-space: countless small glowing violet nodes connected by thin luminous threads, ` +
      "suggesting a living map of connected creative identities (not a literal circuit board, not a corporate network diagram) -- " +
      "organic, constellation-like, some nodes brighter and larger implying prominent studios/players, deep sense of scale and structure, wide 16:9 shot.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/matrix",
    consumingComponent: "app/matrix/page.tsx",
    priority: 2,
  },
  {
    assetKey: "players-directory-hero-01",
    page: "Players",
    route: "/players",
    section: "Hero del directorio de Players",
    purpose: "Fondo ambiental para el header/hero de la grilla de Players -- distinto del de Matrix, más orientado a personas/artistas.",
    aspectRatio: "16:9",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} A dark stage-like backdrop suggesting many artists' silhouettes and spotlights in the far distance, ` +
      "violet stage lighting beams cutting through haze, sense of a live creative scene / concert atmosphere without showing " +
      "any specific recognizable face up close, wide cinematic 16:9 shot, foreground kept dark and empty for card content overlay.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/players",
    consumingComponent: "app/players/page.tsx",
    priority: 3,
  },
  {
    assetKey: "player-public-profile-cover-01",
    page: "Perfil público de Player",
    route: "/players/[slug] , /[publicAlias]",
    section: "Portada hero del perfil público",
    purpose: "Cover artístico genérico para perfiles de Player que todavía no subieron su propia portada -- placeholder de marca, no reemplaza contenido real.",
    aspectRatio: "21:9",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} An ultra-wide cinematic cover-photo backdrop for an individual artist's public profile page: soft ` +
      "violet spotlight from above-center onto an empty dark stage floor, floating light particles, sense of anticipation " +
      "and presence without showing any specific person, ultra-wide 21:9 banner composition, safe empty space where a profile avatar circle would overlap the bottom-left.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/player-profile",
    consumingComponent: "app/players/[slug]/page.tsx, app/[publicAlias]/page.tsx",
    priority: 4,
  },
  {
    assetKey: "studio-directory-hero-01",
    page: "Estudios",
    route: "/studios",
    section: "Hero del directorio de Estudios",
    purpose: "Fondo ambiental para el header de la grilla de Estudios -- distinto de Players: orientado a espacios/estudios físicos, no a personas.",
    aspectRatio: "16:9",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} A dark cinematic interior of a creative studio space seen from a wide angle: silhouettes of ` +
      "recording equipment, mixing consoles and acoustic panels barely visible in violet ambient light, a sense of a real " +
      "working creative headquarters (not a stage, not a concert), empty and quiet, foreground kept dark for card content overlay, wide 16:9 shot.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/studios",
    consumingComponent: "app/studios/page.tsx",
    priority: 5,
  },
  {
    assetKey: "studio-public-profile-cover-01",
    page: "Perfil público de Estudio",
    route: "/studios/[slug]",
    section: "Portada hero del perfil público de Estudio",
    purpose: "Cover artístico genérico para Estudios que todavía no subieron su propia portada -- placeholder de marca, distinto del cover de Player, no reemplaza contenido real.",
    aspectRatio: "21:9",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} An ultra-wide cinematic banner of a creative studio's interior headquarters: a dark room with ` +
      "faint violet light catching the edges of equipment and architecture, a sense of a real physical creative home base " +
      "(not a stage, not a concert crowd), calm and premium, ultra-wide 21:9 banner composition, safe empty space bottom-left for a logo circle overlap.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/studio-profile",
    consumingComponent: "app/studios/[slug]/page.tsx",
    priority: 6,
  },
  {
    assetKey: "public-landing-hero-01",
    page: "Landing pública (visitantes sin sesión)",
    route: "/",
    section: "Hero de la landing pública -- distinta del HomeDashboard logueado",
    purpose:
      "Fondo del hero para quien entra a clouva.com.ar sin sesión. Debe transmitir identidad/comunidad (no Avatar, que está en Próximamente), invitando a crear cuenta y explorar La Matrix.",
    aspectRatio: "16:9",
    resolution: "1K",
    transparent: false,
    model: "gemini-3.1-flash-lite-image",
    prompt:
      `${BASE_IDENTITY} A wide cinematic composition suggesting many distinct creative identities (musicians, producers, ` +
      "designers) as soft glowing silhouettes gathered in a shared dark violet space, connected by faint luminous threads " +
      "like a living community forming, sense of belonging and momentum rather than a single hero character, foreground kept " +
      "dark and empty for headline text overlay, wide 16:9 shot.",
    references: [],
    maxAttempts: 2,
    maxCostUsd: 0.05,
    classification: "C_generate_gemini",
    outputPathPrefix: "visual-system/backgrounds/landing",
    consumingComponent: "components/clouva/PublicLanding.tsx",
    priority: 7,
  },
];

export function manifestEntry(assetKey: string) {
  const entry = assetManifest.find((item) => item.assetKey === assetKey);
  if (!entry) throw new Error(`No existe una entrada de manifiesto aprobada para "${assetKey}".`);
  return entry;
}
