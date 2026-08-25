import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeLayoutConfig } from "@/lib/server/layout-config";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { startVipProfileGeneration } from "@/lib/server/vip-profile-generation";

export type StudioPlayerChanges = {
  role?: string;
  secondaryRole?: string;
  customTitle?: string;
  description?: string;
  areaLabel?: string;
};

export type StudioIdentityDraftPatch = {
  copyConfigJson?: string;
  layoutConfigJson?: string;
  visualConfigJson?: string;
};

type DomainDependencies = {
  authorizeStudio: typeof requireStudioManager;
  startProfileGeneration: typeof startVipProfileGeneration;
};

const DEFAULT_DEPENDENCIES: DomainDependencies = {
  authorizeStudio: requireStudioManager,
  startProfileGeneration: startVipProfileGeneration,
};

const RELATION_SELECT = [
  "id", "player_id", "studio_id", "role", "secondary_role", "custom_title", "description",
  "area_key", "area_label", "status", "is_primary", "is_visible", "display_order", "source_membership_id",
  "player:players(id,slug,display_name,primary_role,profile_image_url,publication_status,is_published)",
].join(",");

type StudioPlayerRelation = Record<string, unknown> & {
  id: string;
  player_id: string;
  studio_id: string;
  source_membership_id: string | null;
};

function statusError(message: string, status: number): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function normalizedString(value: unknown, maxLength: number, nullable = true): string | null | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  if (normalized) return normalized;
  return nullable ? null : undefined;
}

/** Converts Gemini-facing camelCase fields into the canonical relation
 * columns. The executor never receives arbitrary table/column names. */
export function sanitizeStudioPlayerChanges(input: StudioPlayerChanges): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  const role = normalizedString(input.role, 100, false);
  const secondaryRole = normalizedString(input.secondaryRole, 100);
  const customTitle = normalizedString(input.customTitle, 160);
  const description = normalizedString(input.description, 2_000);
  const areaLabel = normalizedString(input.areaLabel, 80);

  if (role !== undefined) changes.role = role;
  if (secondaryRole !== undefined) changes.secondary_role = secondaryRole;
  if (customTitle !== undefined) changes.custom_title = customTitle;
  if (description !== undefined) changes.description = description;
  if (areaLabel !== undefined) changes.area_label = areaLabel;
  return changes;
}

export interface ClouvaDomainService {
  getStudio(): Promise<unknown>;
  getStudioPlayers(): Promise<unknown>;
  getStudioIdentityVersions(): Promise<unknown>;
  updateStudioIdentityDraft(versionId: string, patch: StudioIdentityDraftPatch): Promise<unknown>;
  updatePlayer(playerId: string, changes: StudioPlayerChanges): Promise<unknown>;
  startPlayerProfileGeneration(playerId: string): Promise<unknown>;
}

const IDENTITY_COPY_FIELDS = [
  "tagline", "short_bio", "seo_title", "seo_description", "share_title", "share_description",
] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function parseJsonObject(value: string | undefined, label: string): Record<string, unknown> | null {
  if (value === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw statusError(`${label} no es JSON válido.`, 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw statusError(`${label} debe ser un objeto JSON.`, 400);
  }
  return parsed as Record<string, unknown>;
}

export function sanitizeStudioIdentityCopyPatch(value: Record<string, unknown>): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  for (const field of IDENTITY_COPY_FIELDS) {
    if (!(field in value)) continue;
    const raw = value[field];
    if (raw === null) patch[field] = null;
    else if (typeof raw === "string") patch[field] = raw.trim() ? raw.trim().slice(0, 500) : null;
  }
  return patch;
}

export function sanitizeStudioIdentityVisualPatch(value: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (Array.isArray(value.palette)) {
    const palette = value.palette.filter((entry): entry is string => typeof entry === "string" && HEX_COLOR.test(entry)).slice(0, 8);
    if (palette.length !== value.palette.length) throw statusError("La paleta contiene colores inválidos.", 400);
    patch.palette = palette;
  }
  for (const field of ["visual_energy", "visual_tone"] as const) {
    if (!(field in value)) continue;
    const raw = value[field];
    patch[field] = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 80) : null;
  }
  return patch;
}

function collectHttpsUrls(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (url.protocol === "https:") output.add(url.toString());
    } catch {
      // Ordinary copy is not an asset URL.
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectHttpsUrls(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectHttpsUrls(item, output);
  }
  return output;
}

function validateExistingDraftAssets(nextLayout: unknown, currentVersion: Record<string, unknown>) {
  const allowed = collectHttpsUrls(currentVersion.asset_references);
  collectHttpsUrls(currentVersion.layout_config, allowed);
  for (const url of collectHttpsUrls(nextLayout)) {
    if (!allowed.has(url)) {
      throw statusError("El draft sólo puede reutilizar assets ya vinculados a esta versión.", 400);
    }
  }
}

/**
 * Studio-scoped domain boundary used by CLOUVA AI. It deliberately exposes
 * business operations, not a generic Supabase client: Studio permission and
 * Studio OS are rechecked on every call, Player relations stay scoped to the
 * active Studio, and AI Profile generation enters through the same canonical
 * service as /api/vip-profile/generate.
 */
export function createClouvaDomainService(args: {
  admin: SupabaseClient;
  userId: string;
  studioId: string;
  dependencies?: Partial<DomainDependencies>;
}): ClouvaDomainService {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...args.dependencies };

  const authorize = () => dependencies.authorizeStudio({
    admin: args.admin,
    userId: args.userId,
    studioId: args.studioId,
  });

  async function readLinkedPlayer(playerId: string) {
    if (!playerId.trim()) throw statusError("Falta el Player.", 400);
    await authorize();
    const { data, error } = await args.admin
      .from("player_studios")
      .select(RELATION_SELECT)
      .eq("studio_id", args.studioId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw statusError("El Player no está vinculado a este Estudio.", 404);
    return data as unknown as StudioPlayerRelation;
  }

  return {
    async getStudio() {
      const permission = await authorize();
      const { data, error } = await args.admin
        .from("studios")
        .select("id,slug,name,tagline,description,logo_url,cover_url,city,country,website_url,publication_status,is_published,studio_os_status")
        .eq("id", args.studioId)
        .single();
      if (error) throw new Error(error.message);
      return { studio: data, permission: { role: permission.role, studioOsActive: permission.studioOsActive } };
    },

    async getStudioPlayers() {
      await authorize();
      const { data, error } = await args.admin
        .from("player_studios")
        .select(RELATION_SELECT)
        .eq("studio_id", args.studioId)
        .order("display_order", { ascending: true });
      if (error) throw new Error(error.message);
      return { studioId: args.studioId, players: data ?? [] };
    },

    async getStudioIdentityVersions() {
      await authorize();
      const { data, error } = await args.admin
        .from("player_profile_versions")
        .select("id,version_number,status,copy_config,visual_config,layout_config,asset_references,created_at,published_at")
        .eq("studio_id", args.studioId)
        .in("status", ["published", "draft"])
        .order("version_number", { ascending: false });
      if (error) throw new Error(error.message);
      return {
        studioId: args.studioId,
        published: (data ?? []).find((item) => item.status === "published") ?? null,
        draft: (data ?? []).find((item) => item.status === "draft") ?? null,
      };
    },

    async updateStudioIdentityDraft(versionId, input) {
      if (!versionId.trim()) throw statusError("Falta la versión draft.", 400);
      await authorize();
      const { data: current, error: currentError } = await args.admin
        .from("player_profile_versions")
        .select("id,studio_id,status,copy_config,visual_config,layout_config,asset_references")
        .eq("id", versionId)
        .eq("studio_id", args.studioId)
        .maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current) throw statusError("El draft no existe en este Estudio.", 404);
      if (current.status !== "draft") throw statusError("La versión publicada es inmutable; sólo se puede modificar el draft.", 409);

      const copyInput = parseJsonObject(input.copyConfigJson, "copyConfigJson");
      const layoutInput = parseJsonObject(input.layoutConfigJson, "layoutConfigJson");
      const visualInput = parseJsonObject(input.visualConfigJson, "visualConfigJson");
      const update: Record<string, unknown> = {};

      if (copyInput) {
        const copyPatch = sanitizeStudioIdentityCopyPatch(copyInput);
        if (!Object.keys(copyPatch).length) throw statusError("No hay campos de texto canónicos para modificar.", 400);
        update.copy_config = { ...(current.copy_config as Record<string, unknown> ?? {}), ...copyPatch };
      }
      if (layoutInput) {
        const layout = sanitizeLayoutConfig(layoutInput);
        if (!layout) throw statusError("El layout propuesto no cumple el contrato canónico.", 400);
        validateExistingDraftAssets(layout, current as Record<string, unknown>);
        update.layout_config = layout;
      }
      if (visualInput) {
        const visualPatch = sanitizeStudioIdentityVisualPatch(visualInput);
        if (!Object.keys(visualPatch).length) throw statusError("No hay campos visuales canónicos para modificar.", 400);
        update.visual_config = { ...(current.visual_config as Record<string, unknown> ?? {}), ...visualPatch };
      }
      if (!Object.keys(update).length) throw statusError("No hay cambios de draft para aplicar.", 400);

      const { data: version, error: updateError } = await args.admin
        .from("player_profile_versions")
        .update(update)
        .eq("id", versionId)
        .eq("studio_id", args.studioId)
        .eq("status", "draft")
        .select("id,version_number,status,copy_config,visual_config,layout_config,asset_references")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!version) throw statusError("El draft cambió antes de aplicar la propuesta; volvé a leerlo.", 409);

      await args.admin.from("admin_audit_log").insert({
        admin_user_id: args.userId,
        action: "studio.identity_draft.update",
        entity_type: "player_profile_version",
        entity_id: versionId,
        previous_data: current,
        new_data: version,
        reason: "Cambio de propuesta confirmado desde CLOUVA AI",
      });
      return { version };
    },

    async updatePlayer(playerId, input) {
      const current = await readLinkedPlayer(playerId);
      const changes = sanitizeStudioPlayerChanges(input);
      if (!Object.keys(changes).length) {
        throw statusError("No hay cambios válidos para aplicar al Player.", 400);
      }

      // Membership-backed links have one canonical source for their public
      // role/area. Updating that source fires the existing projection trigger;
      // direct links continue to update player_studios itself.
      const membershipChanges: Record<string, string | null> = {};
      if (current.source_membership_id) {
        if ("role" in changes) membershipChanges.public_role_label = changes.role;
        if ("area_label" in changes) membershipChanges.area_label = changes.area_label;
      }

      if (Object.keys(membershipChanges).length) {
        const { data: membership, error } = await args.admin
          .from("studio_memberships")
          .update({ ...membershipChanges, updated_at: new Date().toISOString() })
          .eq("id", current.source_membership_id)
          .eq("studio_id", args.studioId)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!membership) throw statusError("La membresía que define el rol del Player ya no existe.", 409);
        delete changes.role;
        delete changes.area_label;
      }

      if (Object.keys(changes).length) {
        const { error } = await args.admin
          .from("player_studios")
          .update({ ...changes, updated_at: new Date().toISOString() })
          .eq("id", current.id)
          .eq("studio_id", args.studioId);
        if (error) throw new Error(error.message);
      }

      const { data: updated, error: updatedError } = await args.admin
        .from("player_studios")
        .select(RELATION_SELECT)
        .eq("id", current.id)
        .eq("studio_id", args.studioId)
        .single();
      if (updatedError) throw new Error(updatedError.message);

      await args.admin.from("admin_audit_log").insert({
        admin_user_id: args.userId,
        action: "studio.player.update",
        entity_type: "player_studio",
        entity_id: current.id,
        previous_data: current,
        new_data: updated,
        reason: "Actualización confirmada desde CLOUVA AI",
      });

      return { player: updated };
    },

    async startPlayerProfileGeneration(playerId) {
      await readLinkedPlayer(playerId);
      return dependencies.startProfileGeneration({
        admin: args.admin,
        userId: args.userId,
        playerId,
      });
    },
  };
}
