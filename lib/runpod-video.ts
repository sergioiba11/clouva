import "server-only";

import { Storage } from "@google-cloud/storage";
import { generatedMediaBucketName } from "@/lib/gcs-media";
import type { VideoEnhanceRow } from "@/lib/server/video-enhance";

const RUNPOD_BASE_URL = "https://api.runpod.ai/v2";
const storage = new Storage();

type RunpodStartResponse = {
  id?: string;
  status?: string;
};

export type RunpodStatusResponse = {
  id?: string;
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  output?: {
    output_storage_path?: string;
    thumbnail_storage_path?: string;
    output_url?: string;
    thumbnail_url?: string;
    gpu_seconds?: number;
    error?: string;
  } | null;
  error?: string | null;
  executionTime?: number | null;
};

function config() {
  const apiKey = process.env.RUNPOD_API_KEY?.trim() || "";
  const endpointId = process.env.RUNPOD_VIDEO_ENDPOINT_ID?.trim() || "";
  return { apiKey, endpointId };
}

function publicObjectUrl(bucket: string, objectPath: string) {
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `https://storage.googleapis.com/${bucket}/${encoded}`;
}

async function createUploadSession(objectPath: string, contentType: string) {
  const bucket = storage.bucket(generatedMediaBucketName());
  const [uploadUrl] = await bucket.file(objectPath).createResumableUpload({
    metadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  return uploadUrl;
}

export async function startRunpodVideoEnhance(job: VideoEnhanceRow): Promise<string> {
  const { apiKey, endpointId } = config();
  if (!apiKey || !endpointId) throw new Error("Runpod Video AI no está configurado.");
  if (!job.source_storage_path) throw new Error("El trabajo no tiene video de entrada.");

  const bucket = generatedMediaBucketName();
  const outputPrefix = `video-enhance/${job.user_id}/${job.id}/output`;
  const outputStoragePath = `${outputPrefix}/final.mp4`;
  const thumbnailStoragePath = `${outputPrefix}/thumbnail.jpg`;
  const [outputUploadUrl, thumbnailUploadUrl] = await Promise.all([
    createUploadSession(outputStoragePath, "video/mp4"),
    createUploadSession(thumbnailStoragePath, "image/jpeg"),
  ]);

  const sourceUrl = job.source_url || publicObjectUrl(bucket, job.source_storage_path);
  const response = await fetch(`${RUNPOD_BASE_URL}/${endpointId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        job_id: job.id,
        source_url: sourceUrl,
        output_upload_url: outputUploadUrl,
        thumbnail_upload_url: thumbnailUploadUrl,
        output_storage_path: outputStoragePath,
        thumbnail_storage_path: thumbnailStoragePath,
        output_url: publicObjectUrl(bucket, outputStoragePath),
        thumbnail_url: publicObjectUrl(bucket, thumbnailStoragePath),
        prompt: job.prompt,
        negative_prompt: job.negative_prompt,
        model: "ltxv-2b-0.9.8-distilled",
        mode: job.mode,
        transform_strength: Number(job.transform_strength),
        preserve_motion: job.preserve_motion,
        preserve_camera: job.preserve_camera,
        preserve_subject: job.preserve_subject,
        preserve_audio: job.preserve_audio,
        output_resolution: job.output_resolution,
        output_fps: job.output_fps,
        seed: Number(job.seed),
        trim_start_seconds: Number(job.trim_start_seconds),
        trim_duration_seconds: job.trim_duration_seconds == null ? null : Number(job.trim_duration_seconds),
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Runpod rechazó el trabajo (${response.status})${raw ? `: ${raw.slice(0, 500)}` : ""}`);
  }

  let payload: RunpodStartResponse;
  try {
    payload = JSON.parse(raw) as RunpodStartResponse;
  } catch {
    throw new Error("Runpod devolvió una respuesta inválida al iniciar el trabajo.");
  }
  if (!payload.id) throw new Error("Runpod no devolvió el id del trabajo.");
  return `runpod:${payload.id}`;
}

export async function getRunpodVideoStatus(executionName: string): Promise<RunpodStatusResponse | null> {
  const { apiKey, endpointId } = config();
  if (!apiKey || !endpointId || !executionName.startsWith("runpod:")) return null;
  const runpodJobId = executionName.slice("runpod:".length);
  if (!runpodJobId) return null;

  const response = await fetch(`${RUNPOD_BASE_URL}/${endpointId}/status/${encodeURIComponent(runpodJobId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`No se pudo consultar Runpod (${response.status})${raw ? `: ${raw.slice(0, 300)}` : ""}`);
  }
  return JSON.parse(raw) as RunpodStatusResponse;
}

export async function getRunpodVideoRuntimeStatus() {
  const { apiKey, endpointId } = config();
  if (!apiKey || !endpointId) {
    return {
      ready: false,
      reason: "runpod_not_configured",
      location: "Runpod Serverless",
      provider: "runpod",
    };
  }
  return {
    ready: true,
    reason: null,
    location: "Runpod Serverless · 24 GB GPU",
    provider: "runpod",
  };
}
