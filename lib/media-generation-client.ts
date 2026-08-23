import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { MediaJob } from "@/components/media-creator/types";
import type { ImageAspectRatio, ImageQuality } from "@/lib/media-generation-config";

export const ACTIVE_MEDIA_STATUSES = new Set<MediaJob["status"]>(["queued", "generating", "processing", "saving"]);

export type CreateImageJobInput = {
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  quality?: ImageQuality;
  referenceUrl?: string | null;
  referenceStoragePath?: string | null;
};

export async function createImageJob(input: CreateImageJobInput) {
  const response = await authenticatedFetch("/api/media/generate", {
    method: "POST",
    body: JSON.stringify({
      type: "image",
      sourceMode: input.referenceUrl ? "reference" : "text",
      prompt: input.prompt,
      quality: input.quality ?? "high",
      aspectRatio: input.aspectRatio ?? "16:9",
      referenceUrl: input.referenceUrl ?? null,
      referenceStoragePath: input.referenceStoragePath ?? null,
      idempotencyKey: crypto.randomUUID().replaceAll("-", ""),
    }),
  });
  return readApiJson<{ job: MediaJob; reused?: boolean }>(response);
}

export async function getMediaJob(jobId: string) {
  const response = await authenticatedFetch(`/api/media/jobs/${encodeURIComponent(jobId)}`);
  const payload = await readApiJson<{ job: MediaJob }>(response);
  return payload.job;
}

export async function waitForMediaJob(
  initialJob: MediaJob,
  options: { intervalMs?: number; timeoutMs?: number; onUpdate?: (job: MediaJob) => void } = {},
) {
  let current = initialJob;
  const intervalMs = options.intervalMs ?? 2_500;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const startedAt = Date.now();

  options.onUpdate?.(current);
  while (ACTIVE_MEDIA_STATUSES.has(current.status)) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error("La generación sigue en curso. Podés verla desde Crear.");
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    current = await getMediaJob(current.id);
    options.onUpdate?.(current);
  }
  return current;
}
