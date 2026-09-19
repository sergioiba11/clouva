import "server-only";

import { GoogleGenAI } from "@google/genai";
import { resolveGoogleCloudProjectId } from "@/lib/server/google-cloud-genai";
import { generatedMediaUrlToGsUri } from "@/lib/gcs-media";
import type {
  StartVideoProviderArgs,
  VideoGenerationProvider,
  VideoProviderImage,
  VideoProviderOperation,
} from "./types";

let clientPromise: Promise<GoogleGenAI> | null = null;

function videoLocation() {
  return process.env.VERTEX_VIDEO_LOCATION?.trim() || "us-central1";
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => new GoogleGenAI({
      vertexai: true,
      project: await resolveGoogleCloudProjectId(),
      location: videoLocation(),
    }))();
  }
  return clientPromise;
}

function imageMime(image: VideoProviderImage) {
  if (image.mimeType?.startsWith("image/")) return image.mimeType;
  const path = image.url.toLowerCase().split("?")[0];
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function toImage(image?: VideoProviderImage | null) {
  if (!image) return undefined;
  const gcsUri = image.storagePath
    ? generatedMediaUrlToGsUri(image.storagePath)
    : generatedMediaUrlToGsUri(image.url);
  return { gcsUri, mimeType: imageMime(image) };
}

function normalizeError(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record.message === "string"
    ? record.message
    : JSON.stringify(record).slice(0, 800);
}

function operationResult(operation: any, fallbackName?: string): VideoProviderOperation {
  const output = operation?.response?.generatedVideos?.[0]?.video;
  const operationName = String(operation?.name || fallbackName || "");
  if (!operationName) throw new Error("Vertex AI no devolvió el identificador de la operación de video.");
  return {
    operationName,
    done: Boolean(operation?.done),
    outputUri: typeof output?.uri === "string" ? output.uri : null,
    mimeType: typeof output?.mimeType === "string" ? output.mimeType : "video/mp4",
    metadata: operation?.metadata && typeof operation.metadata === "object" ? operation.metadata : null,
    error: normalizeError(operation?.error),
  };
}

export class VertexVeoProvider implements VideoGenerationProvider {
  readonly key = "google_vertex_ai" as const;

  async generate(args: StartVideoProviderArgs) {
    const ai = await getClient();
    const firstFrame = toImage(args.firstFrame);
    const lastFrame = toImage(args.lastFrame);
    const operation = await ai.models.generateVideos({
      model: args.model,
      prompt: args.prompt,
      ...(firstFrame ? { image: firstFrame } : {}),
      config: {
        numberOfVideos: 1,
        aspectRatio: args.aspectRatio,
        durationSeconds: args.durationSeconds,
        resolution: args.resolution,
        outputGcsUri: args.outputGcsUri.endsWith("/") ? args.outputGcsUri : `${args.outputGcsUri}/`,
        generateAudio: Boolean(args.generateAudio),
        ...(args.negativePrompt ? { negativePrompt: args.negativePrompt } : {}),
        ...(lastFrame ? { lastFrame } : {}),
      },
    });
    const result = operationResult(operation);
    if (result.error) throw new Error(result.error);
    return result;
  }

  async getStatus(operationName: string) {
    const ai = await getClient();
    const operation = await ai.operations.getVideosOperation({
      operation: { name: operationName } as any,
    });
    return operationResult(operation, operationName);
  }

  async getResult(operationName: string) {
    const result = await this.getStatus(operationName);
    if (!result.done) throw new Error("La operación de video todavía no terminó.");
    if (result.error) throw new Error(result.error);
    if (!result.outputUri) throw new Error("Vertex AI terminó sin devolver el video.");
    return result;
  }

  async cancel(_operationName: string) {
    return { cancelled: false };
  }
}

let provider: VertexVeoProvider | null = null;
export function getVertexVeoProvider() {
  provider ??= new VertexVeoProvider();
  return provider;
}

export function getVertexVideoLocation() {
  return videoLocation();
}
