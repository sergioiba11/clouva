import "server-only";
import { GenerateVideosOperation } from "@google/genai";
import { getGoogleMediaClient } from "@/lib/clouva-ai/media/providers/google/client";
import { requireGoogleMediaConfig, videoModelForTier, type ClouAIVideoTier } from "@/lib/clouva-ai/media/config";
import { generatedMediaBucketName, generatedMediaGsUri, publicGeneratedMediaUrl } from "@/lib/gcs-media";

export type GoogleVideoReference = {
  id: string;
  storagePath: string;
  mimeType: string;
};

function objectPathFromGsUri(uri: string) {
  const prefix = `gs://${generatedMediaBucketName()}/`;
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : null;
}

function operationError(error: Record<string, unknown> | undefined) {
  if (!error) return null;
  const message = typeof error.message === "string" ? error.message : JSON.stringify(error);
  return message || "Vertex AI no pudo generar el video.";
}

export async function startGoogleVideoGeneration(args: {
  prompt: string;
  references: GoogleVideoReference[];
  aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 6 | 8;
  resolution: "720p" | "1080p";
  audioEnabled: boolean;
  quantity: number;
  tier: ClouAIVideoTier;
  userId: string;
  jobId: string;
  negativePrompt?: string | null;
  seed?: number | null;
}) {
  const config = requireGoogleMediaConfig();
  const client = getGoogleMediaClient();
  const active = args.references.slice(0, 3);
  const tier = args.tier === "lite" && active.length ? "fast" : args.tier;
  const model = videoModelForTier(tier);
  const outputPrefix = `clouai/generations/${args.userId}/${args.jobId}/video`;

  const operation = await client.models.generateVideos({
    model,
    prompt: args.prompt,
    config: {
      aspectRatio: args.aspectRatio,
      durationSeconds: args.durationSeconds,
      resolution: args.resolution,
      generateAudio: args.audioEnabled,
      numberOfVideos: Math.min(Math.max(args.quantity, 1), 4),
      outputGcsUri: `gs://${config.outputBucket}/${outputPrefix}`,
      ...(args.negativePrompt ? { negativePrompt: args.negativePrompt } : {}),
      ...(typeof args.seed === "number" ? { seed: args.seed } : {}),
      ...(active.length
        ? {
            referenceImages: active.map((reference) => ({
              image: {
                gcsUri: generatedMediaGsUri(reference.storagePath),
                mimeType: reference.mimeType,
              },
              referenceType: "asset",
            })),
          }
        : {}),
    },
  });

  if (!operation.name) throw new Error("Vertex AI no devolvió el identificador de la operación de video.");
  const failure = operationError(operation.error);
  if (failure) throw new Error(failure);

  return {
    operationName: operation.name,
    done: Boolean(operation.done),
    model,
    tier,
    metadata: operation.metadata ?? null,
    activeReferenceIds: active.map((reference) => reference.id),
  };
}

export async function getGoogleVideoOperation(operationName: string) {
  if (!operationName || operationName.includes("..")) throw new Error("Identificador de operación inválido.");
  const client = getGoogleMediaClient();
  const operation = new GenerateVideosOperation();
  operation.name = operationName;
  const updated = await client.operations.getVideosOperation({ operation });
  const failure = operationError(updated.error);
  if (failure) throw new Error(failure);

  const generated = updated.response?.generatedVideos ?? [];
  const videos = generated.map((item) => {
    const uri = item.video?.uri ?? null;
    if (!uri) return null;
    const storagePath = objectPathFromGsUri(uri);
    return {
      uri,
      storagePath,
      publicUrl: storagePath ? publicGeneratedMediaUrl(storagePath) : uri,
      mimeType: item.video?.mimeType ?? "video/mp4",
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    name: updated.name ?? operationName,
    done: Boolean(updated.done),
    metadata: updated.metadata ?? null,
    videos,
  };
}
