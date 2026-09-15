export const VIP_PROFILE_FIDELITY_STATUSES = [
  "rendering_reference_preview",
  "capturing_reference_render",
  "comparing_reference",
  "applying_visual_corrections",
  "regenerating_structure",
  "validating_visual_fidelity",
] as const;

export const VIP_PROFILE_POLLING_STATUSES = [
  "queued",
  "preparing_identity",
  "analyzing_identity",
  "generating_copy",
  "classifying_reference",
  "generating_assets",
  "generating_variants",
  "generating_variant_assets",
  "assembling_profile",
  ...VIP_PROFILE_FIDELITY_STATUSES,
] as const;

export const VIP_PROFILE_INTERACTIVE_ACTIVE_STATUSES = [
  "awaiting_variant_selection",
  "needs_user_input",
] as const;

export const VIP_PROFILE_ACTIVE_STATUSES = [
  ...VIP_PROFILE_POLLING_STATUSES,
  ...VIP_PROFILE_INTERACTIVE_ACTIVE_STATUSES,
] as const;

const ACTIVE_STATUS_SET = new Set<string>(VIP_PROFILE_ACTIVE_STATUSES);
const POLLING_STATUS_SET = new Set<string>(VIP_PROFILE_POLLING_STATUSES);
const FIDELITY_STATUS_SET = new Set<string>(VIP_PROFILE_FIDELITY_STATUSES);

export function isVipProfileJobActive(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_STATUS_SET.has(status));
}

export function isVipProfileJobPolling(status: string | null | undefined): boolean {
  return Boolean(status && POLLING_STATUS_SET.has(status));
}

export function isVipProfileFidelityStatus(status: string | null | undefined): boolean {
  return Boolean(status && FIDELITY_STATUS_SET.has(status));
}

type JobStateRow = { id: string; status: string };

export function selectVipProfileJobState<T extends JobStateRow>(jobsNewestFirst: readonly T[]) {
  const latestJob = jobsNewestFirst[0] ?? null;
  const activeJob = jobsNewestFirst.find((job) => isVipProfileJobActive(job.status)) ?? null;
  const lastFailedJob = jobsNewestFirst.find((job) => job.status === "failed") ?? null;
  return { activeJob, latestJob, lastFailedJob };
}
