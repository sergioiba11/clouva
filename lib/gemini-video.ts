const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiVideoModel =
  | "veo-3.1-lite-generate-preview"
  | "veo-3.1-fast-generate-preview"
  | "veo-3.1-generate-preview";
export type GeminiVideoAspectRatio = "16:9" | "9:16";
export type GeminiVideoDuration = 4 | 6 | 8;
export type GeminiVideoResolution = "720p" | "1080p" | "4k";

export type GeminiVideoReference = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export type StartVideoGenerationArgs = {
  apiKey: string;
  prompt: string;
  model: GeminiVideoModel;
  aspectRatio: GeminiVideoAspectRatio;
  durationSeconds: GeminiVideoDuration;
  resolution?: GeminiVideoResolution;
  referenceImage?: GeminiVideoReference;
  timeoutMs?: number;
};

export type GeminiVideoOperation = {
  name: string;
  done: boolean;
  videoUri: string | null;
  mimeType: string;
  metadata: Record<string, unknown> | null;
};

export class GeminiVideoError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "gemini_video_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type OperationPayload = {
  name?: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
  error?: { code?: number; message?: string; status?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string; mimeType?: string } }>;
    };
    generatedVideos?: Array<{ video?: { uri?: string; mimeType?: string } }>;
  };
};

function operationFromPayload(data: OperationPayload, fallbackName?: string): GeminiVideoOperation {
  if (data.error) {
    throw new GeminiVideoError(
      data.error.message ?? "Gemini no pudo generar el video.",
      Number(data.error.code) || 502,
      data.error.status ?? "provider_failed",
    );
  }
  const video = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video
    ?? data.response?.generatedVideos?.[0]?.video;
  const name = data.name ?? fallbackName;
  if (!name) throw new GeminiVideoError("Gemini no devolvió el identificador de la operación.", 502);
  if (data.done && !video?.uri) throw new GeminiVideoError("Gemini terminó sin devolver un video.", 502);
  return {
    name,
    done: Boolean(data.done),
    videoUri: video?.uri ?? null,
    mimeType: video?.mimeType ?? "video/mp4",
    metadata: data.metadata ?? null,
  };
}

function validateOperationName(value: string) {
  if (!/^(?:models\/[^/]+\/)?operations\/[a-zA-Z0-9._~/-]+$/.test(value) || value.includes("..")) {
    throw new GeminiVideoError("Identificador de operación inválido.", 400, "invalid_operation_id");
  }
}

export async function startVideoGeneration(args: StartVideoGenerationArgs): Promise<GeminiVideoOperation> {
  const instance: Record<string, unknown> = { prompt: args.prompt };
  if (args.referenceImage) {
    instance.image = {
      inlineData: {
        mimeType: args.referenceImage.mimeType,
        data: args.referenceImage.bytes.toString("base64"),
      },
    };
  }

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${encodeURIComponent(args.model)}:predictLongRunning`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio: args.aspectRatio,
          durationSeconds: args.durationSeconds,
          resolution: args.resolution ?? "720p",
          numberOfVideos: 1,
          personGeneration: args.referenceImage ? "allow_adult" : "allow_all",
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    },
  );

  const data = await response.json().catch(() => ({})) as OperationPayload;
  if (!response.ok) {
    throw new GeminiVideoError(data.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status, data.error?.status);
  }
  return operationFromPayload(data);
}

export async function getVideoOperation(args: { apiKey: string; operationName: string; timeoutMs?: number }) {
  validateOperationName(args.operationName);
  const response = await fetch(`${GEMINI_BASE_URL}/${args.operationName}`, {
    headers: { "x-goog-api-key": args.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 20_000),
  });
  const data = await response.json().catch(() => ({})) as OperationPayload;
  if (!response.ok) {
    throw new GeminiVideoError(data.error?.message ?? "No se pudo consultar la generación.", response.status, data.error?.status);
  }
  return operationFromPayload(data, args.operationName);
}

export async function downloadGeneratedVideo(args: { apiKey: string; videoUri: string; timeoutMs?: number; maxBytes?: number }) {
  const parsed = new URL(args.videoUri);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("googleapis.com")) {
    throw new GeminiVideoError("Gemini devolvió una ubicación de video inválida.", 502);
  }
  const response = await fetch(parsed, {
    headers: { "x-goog-api-key": args.apiKey },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
  });
  if (!response.ok) throw new GeminiVideoError(`No se pudo descargar el video generado (HTTP ${response.status}).`, 502);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  const maxBytes = args.maxBytes ?? 250 * 1024 * 1024;
  if (declaredSize > maxBytes) throw new GeminiVideoError("El video generado supera el tamaño permitido.", 413);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new GeminiVideoError("El video generado supera el tamaño permitido.", 413);
  return { bytes, mimeType: response.headers.get("content-type")?.split(";")[0] ?? "video/mp4" };
}
