import "server-only";

import { Storage } from "@google-cloud/storage";
import { GoogleGenAI, Modality, type GenerateContentResponse } from "@google/genai";

export type GoogleCloudReferenceImage = {
  mimeType: string;
  data: string;
};

export type GoogleCloudUsageMetadata = Record<string, unknown> | null;

export class GoogleCloudGenAIError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status = 502, code: string | null = null) {
    super(message);
    this.name = "GoogleCloudGenAIError";
    this.status = status;
    this.code = code;
  }
}

type VertexClient = {
  ai: GoogleGenAI;
  project: string;
  location: string;
};

let vertexClientPromise: Promise<VertexClient> | null = null;
let projectStorage: Storage | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericStatus(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return null;
}

function normalizeProviderError(error: unknown) {
  if (error instanceof GoogleCloudGenAIError) return error;
  const root = record(error);
  const nested = record(root?.error);
  const message = error instanceof Error
    ? error.message
    : text(root?.message) ?? text(nested?.message) ?? "Vertex AI no pudo completar la operación.";
  const providerCode = text(root?.status)
    ?? text(root?.code)
    ?? text(nested?.status)
    ?? text(nested?.code);
  const explicitStatus = numericStatus(root?.status)
    ?? numericStatus(root?.statusCode)
    ?? numericStatus(root?.code)
    ?? numericStatus(nested?.code);

  let status = explicitStatus && explicitStatus >= 400 && explicitStatus <= 599 ? explicitStatus : 502;
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(`${providerCode ?? ""} ${message}`)) status = 429;
  else if (/PERMISSION_DENIED|forbidden|permission/i.test(`${providerCode ?? ""} ${message}`)) status = 403;
  else if (/UNAUTHENTICATED|credential|authentication/i.test(`${providerCode ?? ""} ${message}`)) status = 401;
  else if (/INVALID_ARGUMENT/i.test(`${providerCode ?? ""} ${message}`)) status = 400;
  else if (/DEADLINE_EXCEEDED|timeout|timed out/i.test(`${providerCode ?? ""} ${message}`)) status = 504;

  return new GoogleCloudGenAIError(message, status, providerCode);
}

export async function resolveGoogleCloudProjectId() {
  const configured = process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GCLOUD_PROJECT
    ?? process.env.GCP_PROJECT
    ?? process.env.GOOGLE_PROJECT_ID;
  if (configured?.trim()) return configured.trim();

  // CLOUVA already authenticates GCS with ADC. Reuse the exact same identity
  // instead of introducing a second service-account or API-key path.
  projectStorage ??= new Storage();
  try {
    const detected = await projectStorage.getProjectId();
    if (detected?.trim()) return detected.trim();
  } catch {
    // The actionable error below is intentionally provider-agnostic.
  }
  throw new GoogleCloudGenAIError(
    "Google Cloud no pudo resolver el project ID desde ADC. Configurá GOOGLE_CLOUD_PROJECT en el servicio que ejecuta CLOUVA.",
    500,
    "google_cloud_project_missing",
  );
}

async function getVertexClient(): Promise<VertexClient> {
  if (!vertexClientPromise) {
    vertexClientPromise = (async () => {
      const project = await resolveGoogleCloudProjectId();
      const location = (
        process.env.GOOGLE_CLOUD_LOCATION
        ?? process.env.VERTEX_AI_LOCATION
        ?? "global"
      ).trim() || "global";
      return {
        ai: new GoogleGenAI({ vertexai: true, project, location }),
        project,
        location,
      };
    })();
  }
  return vertexClientPromise;
}

function responseText(response: GenerateContentResponse) {
  const direct = typeof response.text === "string" ? response.text.trim() : "";
  if (direct) return direct;
  return (response.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
}

function usageMetadata(response: GenerateContentResponse): GoogleCloudUsageMetadata {
  const usage = response.usageMetadata;
  return usage && typeof usage === "object"
    ? { ...usage as unknown as Record<string, unknown> }
    : null;
}

export async function generateGoogleCloudJson(args: {
  model: string;
  prompt: string;
  referenceImages?: GoogleCloudReferenceImage[];
  responseJsonSchema: unknown;
  temperature?: number;
  maxOutputTokens?: number;
}) {
  try {
    const { ai, project, location } = await getVertexClient();
    const response = await ai.models.generateContent({
      model: args.model,
      contents: [{
        role: "user",
        parts: [
          { text: args.prompt },
          ...(args.referenceImages ?? []).flatMap((image, index) => [
            { text: `Referencia visual ${index + 1}` },
            { inlineData: { mimeType: image.mimeType, data: image.data } },
          ]),
        ],
      }],
      config: {
        temperature: args.temperature ?? 0.1,
        maxOutputTokens: args.maxOutputTokens ?? 2200,
        responseMimeType: "application/json",
        responseJsonSchema: args.responseJsonSchema,
      },
    });
    const output = responseText(response);
    if (!output) throw new GoogleCloudGenAIError("Vertex AI no devolvió contenido estructurado.", 502, "empty_response");
    return {
      text: output,
      usage: usageMetadata(response),
      provider: "google_vertex_ai" as const,
      model: args.model,
      project,
      location,
      responseId: response.responseId ?? null,
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function generateGoogleCloudImage(args: {
  model: string;
  prompt: string;
  referenceImages?: GoogleCloudReferenceImage[];
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  timeoutMs?: number;
}) {
  try {
    const { ai, project, location } = await getVertexClient();
    const response = await ai.models.generateContent({
      model: args.model,
      contents: [{
        role: "user",
        parts: [
          { text: args.prompt },
          ...(args.referenceImages ?? []).map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.data },
          })),
        ],
      }],
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
        imageConfig: {
          aspectRatio: args.aspectRatio ?? "1:1",
          imageSize: args.imageSize ?? "1K",
          outputMimeType: "image/png",
        },
        ...(args.timeoutMs ? { abortSignal: AbortSignal.timeout(args.timeoutMs) } : {}),
      },
    });

    const parts = (response.candidates ?? []).flatMap((candidate) => candidate.content?.parts ?? []);
    const generated = parts.find((part) => {
      const mimeType = part.inlineData?.mimeType;
      return Boolean(part.inlineData?.data && typeof mimeType === "string" && mimeType.startsWith("image/"));
    });
    if (!generated?.inlineData?.data) {
      throw new GoogleCloudGenAIError("Vertex AI terminó sin devolver una imagen.", 502, "image_missing");
    }

    const bytes = Buffer.from(generated.inlineData.data, "base64");
    if (!bytes.length) throw new GoogleCloudGenAIError("Vertex AI devolvió una imagen vacía.", 502, "image_empty");

    return {
      bytes,
      mimeType: generated.inlineData.mimeType || "image/png",
      text: parts.map((part) => part.text ?? "").join("").trim() || null,
      usage: usageMetadata(response),
      provider: "google_vertex_ai" as const,
      model: args.model,
      project,
      location,
      responseId: response.responseId ?? null,
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}
