export type MediaType = "image" | "video";
export type MediaStatus = "queued" | "generating" | "processing" | "saving" | "storage_failed" | "completed" | "failed" | "cancelled";

export type MediaJob = {
  id: string;
  type: MediaType;
  sourceMode: "text" | "reference";
  status: MediaStatus;
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: string;
  durationSeconds: number | null;
  referenceUrl: string | null;
  outputUrl: string | null;
  mimeType: string | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type ReferenceAsset = {
  url: string;
  storagePath: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
};

export type ModelAvailability = {
  pricingVersion: string;
  image: Array<{ quality: string; label: string; model: string; imageSize: string; available: boolean }>;
  video: Array<{ quality: string; label: string; model: string; resolution: string; pricePerSecondUsd: number; available: boolean }>;
};
