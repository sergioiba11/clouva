import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import {
  flattenStudioDesignInput,
  sanitizeStudioDesignInput,
  validateStudioDesignInput,
  withStudioDesignInputSnapshot,
} from "@/lib/server/studio-design-input";
import { buildIdentityBrief, buildStudioIdentityBrief } from "@/lib/server/vip-profile-brief";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

const ACTIVE_STATUSES = [
  "queued", "preparing_identity", "analyzing_identity", "generating_copy",
  "classifying_reference", "generating_assets", "generating_variants", "generating_variant_assets",
  "assembling_profile", "rendering_reference_preview", "capturing_reference_render", "comparing_reference",
  "applying_visual_corrections", "regenerating_structure", "validating_visual_fidelity", "awaiting_variant_selection", "needs_user_input",
];

const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/(players|studios)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;
const MAX_REFERENCE_IMAGES = 3;

export function sanitizeReferenceImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((url): url is string => typeof url === "string" && REFERENCE_IMAGE_URL_RE.test(url))
    .slice(0, MAX_REFERENCE_IMAGES);
}

type GenerationDependencies = {
  requireEntitlement: typeof requireActiveVipEntitlement;
  buildPlayerBrief: typeof buildIdentityBrief;
  buildStudioBrief: typeof buildStudioIdentityBrief;
  enqueue: typeof enqueueVipProfileJobStep;
};

const DEFAULT_DEPENDENCIES: GenerationDependencies = {
  requireEntitlement: requireActiveVipEntitlement,
  buildPlayerBrief: buildIdentityBrief,
  buildStudioBrief: buildStudioIdentityBrief,
  enqueue: enqueueVipProfileJobStep,
};

function badRequest(message: string): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = 400;
  return error;
}

export async function startVipProfileGeneration(args: {
  admin: SupabaseClient;
  userId: string;
  playerId?: string;
  studioId?: string;
  referenceImageUrls?: unknown;
  designInput?: unknown;
  dependencies?: Partial<GenerationDependencies>;
}) {
  if (!args.playerId && !args.studioId) throw badRequest("Falta playerId o studioId.");
  if (args.playerId && args.studioId) throw badRequest("Elegí playerId o studioId, no ambos.");

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...args.dependencies };
  const subjectId = (args.playerId || args.studioId) as string;
  const subjectColumn = args.playerId ? "player_id" : "studio_id";
  const studioDesignInput = args.studioId
    ? sanitizeStudioDesignInput(args.designInput, args.referenceImageUrls)
    : null;
  if (studioDesignInput) {
    try {
      validateStudioDesignInput(studioDesignInput);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : "Falta una dirección creativa válida.");
    }
  }
  const referenceImageUrls = studioDesignInput
    ? flattenStudioDesignInput(studioDesignInput)
    : sanitizeReferenceImageUrls(args.referenceImageUrls);

  const { entitlement } = await dependencies.requireEntitlement({
    admin: args.admin,
    userId: args.userId,
    playerId: args.playerId,
    studioId: args.studioId,
  });

  const { data: existingJob, error: existingJobError } = await args.admin
    .from("vip_profile_generation_jobs")
    .select("id,status")
    .eq(subjectColumn, subjectId)
    .in("status", ACTIVE_STATUSES)
    .maybeSingle();
  if (existingJobError) throw new Error(existingJobError.message);
  if (existingJob) return { jobId: existingJob.id as string, status: existingJob.status as string, reused: true };

  const { brief, sourceSnapshot } = args.playerId
    ? await dependencies.buildPlayerBrief(args.admin, args.playerId)
    : await dependencies.buildStudioBrief(args.admin, args.studioId as string);
  const persistedSourceSnapshot = studioDesignInput
    ? withStudioDesignInputSnapshot(sourceSnapshot, studioDesignInput)
    : sourceSnapshot;

  const { data: job, error: jobError } = await args.admin
    .from("vip_profile_generation_jobs")
    .insert({
      user_id: args.userId,
      player_id: args.playerId || null,
      studio_id: args.studioId || null,
      entitlement_id: entitlement?.id ?? null,
      status: "queued",
      identity_brief: brief,
      source_snapshot: persistedSourceSnapshot,
      reference_image_urls: referenceImageUrls,
    })
    .select("id,status")
    .single();
  if (jobError) throw new Error(jobError.message);

  await dependencies.enqueue(job.id as string);
  return { jobId: job.id as string, status: job.status as string, reused: false };
}
