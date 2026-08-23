import type { ImageAspectRatio, ImageQuality } from "@/lib/media-generation-config";

export type RetryableImageRequest = {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality;
  referenceUrl?: string | null;
  referenceStoragePath?: string | null;
};

export const MAX_AUTOMATIC_STOP_RETRIES = 1;

export function isStopImageGenerationFailure(error: string | null | undefined) {
  return typeof error === "string" && /(?:finish\s*reason\s*[:=]?\s*)?\bSTOP\b/i.test(error);
}

export function shouldAutoRetryImageGeneration(error: string | null | undefined, retriesUsed: number) {
  return isStopImageGenerationFailure(error) && retriesUsed < MAX_AUTOMATIC_STOP_RETRIES;
}

export function imageGenerationErrorCopy(error: string | null | undefined) {
  if (isStopImageGenerationFailure(error)) {
    return {
      message: "Gemini terminó la solicitud sin devolver una imagen.",
      detail: "finishReason STOP",
    };
  }

  const clean = error?.trim() || "La generación no pudo completarse.";
  return { message: clean, detail: null };
}

export function buildRetryImageRequest(input: RetryableImageRequest): RetryableImageRequest {
  return {
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    quality: input.quality,
    referenceUrl: input.referenceUrl ?? null,
    referenceStoragePath: input.referenceStoragePath ?? null,
  };
}
