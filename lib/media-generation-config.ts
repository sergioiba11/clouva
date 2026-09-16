export type MediaType = "image" | "video";
export type MediaSourceMode = "text" | "reference";
export type ImageQuality = "quick" | "high" | "maximum";
export type VideoQuality = "economy" | "fast" | "cinematic";
export type ImageSize = "1K" | "2K" | "4K";
export type ImageAspectRatio = "1:1" | "4:5" | "5:4" | "16:9" | "9:16";
export type VideoAspectRatio = "16:9" | "9:16";
export type VideoDuration = 4 | 6 | 8;

export const MEDIA_PRICING_VERSION = "2026-09-16-runway";
export const RUNWAY_CREDIT_USD = 0.01;

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
    model: "seedance2_mini",
    resolution: "720p",
    creditsPerSecond: 16,
    pricePerSecondUsd: 0.16,
  },
  fast: {
    label: "Rápida",
    model: "seedance2_fast",
    resolution: "720p",
    creditsPerSecond: 29,
    pricePerSecondUsd: 0.29,
  },
  cinematic: {
    label: "Cinemática",
    model: "seedance2_5",
    resolution: "720p",
    creditsPerSecond: 30,
    pricePerSecondUsd: 0.3,
  },
} as const satisfies Record<VideoQuality, {
  label: string;
  model: "seedance2_mini" | "seedance2_fast" | "seedance2_5";
  resolution: "720p";
  creditsPerSecond: number;
  pricePerSecondUsd: number;
}>;

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

export function estimateVideoCredits(quality: VideoQuality, durationSeconds: VideoDuration) {
  return VIDEO_QUALITY_CONFIG[quality].creditsPerSecond * durationSeconds;
}

export function estimateVideoCostUsd(quality: VideoQuality, durationSeconds: VideoDuration) {
  return Number((estimateVideoCredits(quality, durationSeconds) * RUNWAY_CREDIT_USD).toFixed(2));
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
