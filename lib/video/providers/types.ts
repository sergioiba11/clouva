export type VideoProviderKey = "google_vertex_ai";

export type VideoProviderImage = {
  url: string;
  storagePath?: string | null;
  mimeType?: string | null;
};

export type StartVideoProviderArgs = {
  prompt: string;
  negativePrompt?: string | null;
  model: string;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 6 | 8;
  resolution: "720p" | "1080p" | "4k";
  firstFrame?: VideoProviderImage | null;
  lastFrame?: VideoProviderImage | null;
  outputGcsUri: string;
  generateAudio?: boolean;
};

export type VideoProviderOperation = {
  operationName: string;
  done: boolean;
  outputUri: string | null;
  mimeType: string;
  metadata: Record<string, unknown> | null;
  error: string | null;
};

export interface VideoGenerationProvider {
  key: VideoProviderKey;
  generate(args: StartVideoProviderArgs): Promise<VideoProviderOperation>;
  getStatus(operationName: string): Promise<VideoProviderOperation>;
  getResult(operationName: string): Promise<VideoProviderOperation>;
  cancel(operationName: string): Promise<{ cancelled: boolean }>;
}
