export type ClouAIContextSummary = {
  identity: Record<string, unknown>;
  logos: string[];
  palette: string[];
  characters: string[];
  products: string[];
  locations: string[];
  visual_language: Record<string, unknown>;
  materials: string[];
  must_preserve: string[];
  avoid: string[];
  relationships: string[];
  notes: string[];
};

export type ClouAIContext = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tags: string[];
  summary: Partial<ClouAIContextSummary>;
  summaryState: "stale" | "ready" | "failed";
  summaryModel: string | null;
  summaryUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assetCount?: number;
};

export type ClouAIContextAsset = {
  id: string;
  contextId: string;
  name: string;
  kind: string;
  storagePath: string;
  publicUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  position: number;
  priority: number;
  isPrimary: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ActiveReference = ClouAIContextAsset & {
  bytes?: Buffer;
};

export type ContextBundle = {
  contexts: ClouAIContext[];
  assets: ClouAIContextAsset[];
  activeReferences: ClouAIContextAsset[];
  contextText: string;
};

export type ClouAIGenerationRequest = {
  type: "image" | "video";
  prompt: string;
  contextIds: string[];
  conversationId?: string | null;
  aspectRatio: string;
  resolution?: string;
  quantity?: number;
  audioEnabled?: boolean;
  durationSeconds?: 4 | 6 | 8;
  videoTier?: "fast" | "cinematic" | "lite";
  negativePrompt?: string | null;
  seed?: number | null;
};
