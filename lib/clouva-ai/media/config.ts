import "server-only";

export type ClouAIMediaMode = "image" | "video";
export type ClouAIVideoTier = "fast" | "cinematic" | "lite";

function numberEnv(name: string) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getClouAIMediaConfig() {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim() || "";
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";
  const outputBucket = (process.env.CLOUAI_OUTPUT_BUCKET || process.env.CLOUVA_GENERATED_MEDIA_BUCKET || "clouva-generated-media").trim();

  return {
    project,
    location,
    outputBucket,
    models: {
      image: process.env.CLOUAI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image",
      multimodal: process.env.CLOUAI_MULTIMODAL_MODEL?.trim() || "gemini-2.5-flash",
      video: {
        fast: process.env.CLOUAI_VIDEO_MODEL_FAST?.trim() || process.env.CLOUAI_VIDEO_MODEL?.trim() || "veo-3.1-fast-generate-001",
        cinematic: process.env.CLOUAI_VIDEO_MODEL_CINEMATIC?.trim() || "veo-3.1-generate-001",
        lite: process.env.CLOUAI_VIDEO_MODEL_LITE?.trim() || "veo-3.1-lite-generate-001",
      },
    },
    pricing: {
      fastVideoPerSecondUsd: numberEnv("CLOUAI_VEO_FAST_USD_PER_SECOND"),
      cinematicVideoPerSecondUsd: numberEnv("CLOUAI_VEO_CINEMATIC_USD_PER_SECOND"),
      liteVideoPerSecondUsd: numberEnv("CLOUAI_VEO_LITE_USD_PER_SECOND"),
    },
  } as const;
}

export function requireGoogleMediaConfig() {
  const config = getClouAIMediaConfig();
  if (!config.project) {
    throw new Error("GOOGLE_CLOUD_PROJECT no está configurado para CLOUVA AI.");
  }
  if (!config.outputBucket) {
    throw new Error("CLOUAI_OUTPUT_BUCKET no está configurado para CLOUVA AI.");
  }
  return config;
}

export function videoModelForTier(tier: ClouAIVideoTier) {
  return requireGoogleMediaConfig().models.video[tier];
}

export function estimateConfiguredVideoCost(tier: ClouAIVideoTier, durationSeconds: number, quantity = 1) {
  const pricing = getClouAIMediaConfig().pricing;
  const rate = tier === "fast"
    ? pricing.fastVideoPerSecondUsd
    : tier === "cinematic"
      ? pricing.cinematicVideoPerSecondUsd
      : pricing.liteVideoPerSecondUsd;
  if (rate == null) return null;
  return Number((rate * durationSeconds * quantity).toFixed(2));
}
