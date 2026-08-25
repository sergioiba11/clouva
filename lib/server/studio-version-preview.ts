import "server-only";

import { sanitizeLayoutConfig } from "./layout-config";
import type { StudioIdentityData } from "./public-identity-data";

export type StudioVersionSnapshot = {
  id: string;
  version_number: number;
  status: "draft" | "review" | "published" | "archived";
  copy_config: Record<string, unknown> | null;
  visual_config: Record<string, unknown> | null;
  layout_config: unknown;
  asset_references: unknown;
  created_at: string;
  published_at: string | null;
};

const COPY_FIELDS = [
  "tagline",
  "short_bio",
  "seo_title",
  "seo_description",
  "share_title",
  "share_description",
] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function textOrCurrent(value: unknown, current: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : current;
}

function assetUrl(value: unknown, kind: "cover" | "logo"): string | null {
  if (!Array.isArray(value)) return null;
  const item = value.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).kind === kind);
  const raw = item && typeof item === "object" ? (item as Record<string, unknown>).url : null;
  if (typeof raw !== "string") return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

function palette(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>).palette;
  if (!Array.isArray(raw)) return null;
  const colors = raw.filter((entry): entry is string => typeof entry === "string" && HEX_COLOR.test(entry)).slice(0, 8);
  return colors.length ? colors : null;
}

/** Applies a draft snapshot in memory only. This deliberately mirrors the
 * canonical publish projection without issuing any update: ACTUAL remains the
 * real Studio row and PROPUESTA receives cloned data plus the draft config. */
export function buildStudioProposal(
  current: StudioIdentityData,
  draft: StudioVersionSnapshot,
): StudioIdentityData {
  const copy = draft.copy_config ?? {};
  const nextStudio = { ...current.studio };
  for (const field of COPY_FIELDS) {
    nextStudio[field] = textOrCurrent(copy[field], current.studio[field]);
  }

  const cover = assetUrl(draft.asset_references, "cover");
  const logo = assetUrl(draft.asset_references, "logo");
  const nextPalette = palette(draft.visual_config);
  if (cover) {
    nextStudio.cover_url = cover;
    nextStudio.og_image_url = cover;
  }
  // The proposal may display its candidate logo, but publishing that logo
  // still requires the separate explicit flag in the canonical publish RPC.
  if (logo) nextStudio.logo_url = logo;
  if (nextPalette) {
    nextStudio.palette = nextPalette;
    nextStudio.accent_color = nextPalette[0] ?? nextStudio.accent_color;
  }

  return {
    ...current,
    studio: nextStudio,
    layoutConfig: sanitizeLayoutConfig(draft.layout_config) ?? current.layoutConfig,
  };
}
