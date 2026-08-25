export type MediaType = "image" | "video";
export type MediaSourceMode = "text" | "reference";
export type ImageQuality = "quick" | "high" | "maximum";
export type VideoQuality = "economy" | "fast" | "cinematic";
export type ImageSize = "1K" | "2K" | "4K";
export type ImageAspectRatio = "1:1" | "4:5" | "5:4" | "16:9" | "9:16";
export type VideoAspectRatio = "16:9" | "9:16";
export type VideoDuration = 4 | 6 | 8;

export const MEDIA_PRICING_VERSION = "2026-08-13";

export const IMAGE_QUALITY_CONFIG = {
  quick: {
    label: "Rápida",
    model: "gemini-3.1-flash-image",
    imageSize: "1K",
  },
  high: {
    label: "Alta",
    model: "gemini-3.1-flash-image",
    imageSize: "2K",
  },
  maximum: {
    label: "Máxima",
    model: "gemini-3-pro-image",
    imageSize: "4K",
  },
} as const satisfies Record<ImageQuality, { label: string; model: string; imageSize: ImageSize }>;

export const VIDEO_QUALITY_CONFIG = {
  economy: {
    label: "Económica",
    model: "veo-3.1-lite-generate-preview",
    resolution: "720p",
    pricePerSecondUsd: 0.05,
  },
  fast: {
    label: "Rápida",
    model: "veo-3.1-fast-generate-preview",
    resolution: "720p",
    pricePerSecondUsd: 0.1,
  },
  cinematic: {
    label: "Cinemática",
    model: "veo-3.1-generate-preview",
    resolution: "720p",
    pricePerSecondUsd: 0.4,
  },
} as const satisfies Record<VideoQuality, { label: string; model: string; resolution: "720p"; pricePerSecondUsd: number }>;

export const IMAGE_ASPECT_RATIOS: readonly ImageAspectRatio[] = ["1:1", "4:5", "5:4", "16:9", "9:16"];
export const VIDEO_ASPECT_RATIOS: readonly VideoAspectRatio[] = ["16:9", "9:16"];
export const VIDEO_DURATIONS: readonly VideoDuration[] = [4, 6, 8];

export function isImageQuality(value: unknown): value is ImageQuality {
  return typeof value === "string" && value in IMAGE_QUALITY_CONFIG;
}

export function isVideoQuality(value: unknown): value is VideoQuality {
  return typeof value === "string" && value in VIDEO_QUALITY_CONFIG;
}

export function isImageAspectRatio(value: unknown): value is ImageAspectRatio {
  return IMAGE_ASPECT_RATIOS.includes(value as ImageAspectRatio);
}

export function isVideoAspectRatio(value: unknown): value is VideoAspectRatio {
  return VIDEO_ASPECT_RATIOS.includes(value as VideoAspectRatio);
}

export function isVideoDuration(value: unknown): value is VideoDuration {
  return VIDEO_DURATIONS.includes(Number(value) as VideoDuration);
}

export function estimateVideoCostUsd(quality: VideoQuality, durationSeconds: VideoDuration) {
  return Number((VIDEO_QUALITY_CONFIG[quality].pricePerSecondUsd * durationSeconds).toFixed(2));
}

export function formatAspectRatio(value: ImageAspectRatio | VideoAspectRatio) {
  const labels: Record<string, string> = {
    "1:1": "1:1 (Cuadrado)",
    "4:5": "4:5 (Retrato)",
    "5:4": "5:4 (Horizontal)",
    "16:9": "16:9 (Paisaje)",
    "9:16": "9:16 (Vertical)",
  };
  return labels[value] ?? value;
}
