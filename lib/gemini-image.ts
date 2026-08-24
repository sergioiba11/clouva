const INTERACTIONS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_REMOTE_IMAGE_BYTES = 30 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 55_000;
const RECOVERY_ATTEMPTS = 5;

export type GeminiImageModel = "gemini-3.1-flash-lite-image" | "gemini-3.1-flash-image" | "gemini-3-pro-image";
export type GeminiAspectRatio =
  | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "4:5" | "5:4" | "3:2" | "2:3" | "21:9";
export type GeminiImageSize = "512" | "1K" | "2K" | "4K";

export type GeminiReferenceImage = { mimeType: string; data: string };

export type GenerateImageArgs = {
  apiKey: string;
  prompt: string;
  referenceImages?: GeminiReferenceImage[];
  model?: GeminiImageModel;
  aspectRatio?: GeminiAspectRatio;
  imageSize?: GeminiImageSize;
  timeoutMs?: number;
};

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export type GeneratedImage = {
  bytes: Buffer;
  mimeType: string;
  text: string | null;
  usageMetadata: GeminiUsageMetadata | null;
  providerOperationId: string | null;
};

export class GeminiImageError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "GeminiImageError";
    this.status = status;
  }
}

type InteractionContent = {
  type?: string;
  text?: string;
  data?: string;
  uri?: string;
  url?: string;
  file_uri?: string;
  fileUri?: string;
  mime_type?: string;
  mimeType?: string;
  inline_data?: { data?: string; mime_type?: string; mimeType?: string };
  inlineData?: { data?: string; mime_type?: string; mimeType?: string };
  file_data?: { uri?: string; file_uri?: string; mime_type?: string; mimeType?: string };
  fileData?: { uri?: string; fileUri?: string; mime_type?: string; mimeType?: string };
  image?: InteractionContent;
};

type InteractionStep = {
  type?: string;
  status?: string;
  content?: InteractionContent[];
  result?: unknown;
};

type InteractionResponse = {
  id?: string;
  model?: string;
  status?: string;
  output_image?: InteractionContent;
  output_text?: string;
  steps?: InteractionStep[];
  outputs?: InteractionContent[];
  result?: unknown;
  response?: unknown;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
  };
  error?: { message?: string; code?: number; status?: string };
  errors?: Array<{ message?: string; code?: string }>;
};

type ImageCandidate = {
  data?: string;
  uri?: string;
  mimeType?: string;
  source: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mimeFromRecord(record: Record<string, unknown>) {
  return stringValue(record.mime_type) ?? stringValue(record.mimeType);
}

function imageCandidateFromRecord(record: Record<string, unknown>, source: string): ImageCandidate | null {
  const mimeType = mimeFromRecord(record);
  const directData = stringValue(record.data);
  const directUri = stringValue(record.uri)
    ?? stringValue(record.url)
    ?? stringValue(record.file_uri)
    ?? stringValue(record.fileUri);
  const semanticImage = record.type === "image" || Boolean(mimeType?.startsWith("image/"));

  if ((directData || directUri) && semanticImage) {
    return { data: directData, uri: directUri, mimeType, source };
  }

  for (const key of ["inline_data", "inlineData", "file_data", "fileData", "image"] as const) {
    const nested = asRecord(record[key]);
    if (!nested) continue;

    const nestedMime = mimeFromRecord(nested) ?? mimeType;
    const nestedData = stringValue(nested.data);
    const nestedUri = stringValue(nested.uri)
      ?? stringValue(nested.url)
      ?? stringValue(nested.file_uri)
      ?? stringValue(nested.fileUri);

    if ((nestedData || nestedUri) && (semanticImage || nestedMime?.startsWith("image/") || key === "image")) {
      return {
        data: nestedData,
        uri: nestedUri,
        mimeType: nestedMime,
        source: `${source}.${key}`,
      };
    }
  }

  return null;
}

function collectImageCandidates(payload: InteractionResponse) {
  const candidates: ImageCandidate[] = [];
  const seen = new Set<unknown>();

  function visit(value: unknown, path: string, depth: number) {
    if (depth > 8 || value == null || seen.has(value) || typeof value !== "object") return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    const record = value as Record<string, unknown>;
    const candidate = imageCandidateFromRecord(record, path);
    if (candidate) candidates.push(candidate);

    for (const [key, nested] of Object.entries(record)) {
      if (["data", "text", "output_text"].includes(key)) continue;
      visit(nested, `${path}.${key}`, depth + 1);
    }
  }

  visit(payload, "interaction", 0);
  return candidates;
}

function detectImageMimeType(bytes: Buffer): string | null {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "BM") return "image/bmp";
  return null;
}

function decodeBase64Image(data: string, declaredMimeType?: string) {
  const raw = data.startsWith("data:") && data.includes(",")
    ? data.slice(data.indexOf(",") + 1)
    : data;
  const normalized = raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized) || normalized.length < 16) return null;

  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) return null;

  const detectedMimeType = detectImageMimeType(bytes);
  if (!detectedMimeType) return null;

  if (declaredMimeType?.startsWith("image/") && declaredMimeType !== detectedMimeType) {
    console.warn("GEMINI_IMAGE_MIME_MISMATCH", { declaredMimeType, detectedMimeType });
  }

  return { bytes, mimeType: detectedMimeType };
}

function isAllowedGeminiMediaUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "generativelanguage.googleapis.com"
      || host === "storage.googleapis.com"
      || host.endsWith(".googleapis.com")
      || host.endsWith(".googleusercontent.com");
  } catch {
    return false;
  }
}

async function downloadGeminiImageUri(uri: string, apiKey: string, timeoutMs: number) {
  if (!isAllowedGeminiMediaUrl(uri)) {
    throw new GeminiImageError("Gemini devolvió una URI de imagen no autorizada.", 502);
  }

  const url = new URL(uri);
  const headers: Record<string, string> = {};
  if (url.hostname === "generativelanguage.googleapis.com") headers["x-goog-api-key"] = apiKey;

  const response = await fetch(uri, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new GeminiImageError(`No se pudo descargar la imagen de Gemini (HTTP ${response.status}).`, 502);
  }

  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new GeminiImageError("La imagen de Gemini supera el tamaño permitido.", 502);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new GeminiImageError("La imagen descargada de Gemini no es válida.", 502);
  }

  const detectedMimeType = detectImageMimeType(bytes);
  const responseMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const mimeType = detectedMimeType ?? (responseMimeType?.startsWith("image/") ? responseMimeType : null);
  if (!mimeType) throw new GeminiImageError("Gemini devolvió un recurso que no es una imagen válida.", 502);

  return { bytes, mimeType };
}

function interactionText(data: InteractionResponse) {
  if (data.output_text?.trim()) return data.output_text.trim();
  for (const step of data.steps ?? []) {
    for (const content of step.content ?? []) {
      if (content.type === "text" && content.text?.trim()) return content.text.trim();
    }
  }
  return null;
}

function providerDiagnostic(data: InteractionResponse) {
  const direct = data.error?.message?.trim();
  if (direct) return direct;
  const recorded = data.errors?.map((item) => item.message?.trim()).filter(Boolean).join(" · ");
  if (recorded) return recorded;
  return null;
}

function usageMetadata(data: InteractionResponse): GeminiUsageMetadata | null {
  if (!data.usage) return null;
  return {
    promptTokenCount: data.usage.prompt_tokens ?? data.usage.total_input_tokens,
    candidatesTokenCount: data.usage.completion_tokens ?? data.usage.total_output_tokens,
    thoughtsTokenCount: data.usage.total_thought_tokens,
    totalTokenCount: data.usage.total_tokens,
  };
}

export function describeGeminiInteractionPayload(data: InteractionResponse) {
  return {
    id: data.id ?? null,
    model: data.model ?? null,
    status: data.status ?? null,
    rootKeys: Object.keys(data as Record<string, unknown>).sort(),
    errorCount: data.errors?.length ?? (data.error ? 1 : 0),
    steps: (data.steps ?? []).map((step) => ({
      type: step.type ?? null,
      status: step.status ?? null,
      keys: Object.keys(step).sort(),
      content: (step.content ?? []).map((content) => ({
        type: content.type ?? null,
        keys: Object.keys(content).sort(),
        mimeType: content.mime_type ?? content.mimeType ?? null,
        hasData: Boolean(content.data || content.inline_data?.data || content.inlineData?.data),
        dataLength: content.data?.length ?? content.inline_data?.data?.length ?? content.inlineData?.data?.length ?? 0,
        hasUri: Boolean(
          content.uri
          || content.url
          || content.file_uri
          || content.fileUri
          || content.file_data?.uri
          || content.fileData?.uri
        ),
      })),
    })),
    outputCount: data.outputs?.length ?? 0,
    hasResult: data.result != null,
    hasResponse: data.response != null,
    imageCandidates: collectImageCandidates(data).map((candidate) => ({
      source: candidate.source,
      mimeType: candidate.mimeType ?? null,
      hasData: Boolean(candidate.data),
      dataLength: candidate.data?.length ?? 0,
      hasUri: Boolean(candidate.uri),
    })),
  };
}

export async function extractGeminiImageResult(
  data: InteractionResponse,
  options: { apiKey: string; timeoutMs?: number },
): Promise<GeneratedImage | null> {
  for (const candidate of collectImageCandidates(data)) {
    if (candidate.data) {
      const decoded = decodeBase64Image(candidate.data, candidate.mimeType);
      if (decoded) {
        return {
          bytes: decoded.bytes,
          mimeType: decoded.mimeType,
          text: interactionText(data),
          usageMetadata: usageMetadata(data),
          providerOperationId: data.id ?? null,
        };
      }
    }

    if (candidate.uri) {
      const downloaded = await downloadGeminiImageUri(
        candidate.uri,
        options.apiKey,
        options.timeoutMs ?? 30_000,
      );
      return {
        bytes: downloaded.bytes,
        mimeType: downloaded.mimeType,
        text: interactionText(data),
        usageMetadata: usageMetadata(data),
        providerOperationId: data.id ?? null,
      };
    }
  }

  return null;
}

async function fetchInteraction(args: { apiKey: string; interactionId: string; timeoutMs?: number }) {
  if (!/^[a-zA-Z0-9._:-]{3,256}$/.test(args.interactionId)) {
    throw new GeminiImageError("Identificador de interacción inválido.", 400);
  }

  const response = await fetch(`${INTERACTIONS_ENDPOINT}/${encodeURIComponent(args.interactionId)}`, {
    headers: { "x-goog-api-key": args.apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
  });

  const data = await response.json().catch(() => ({})) as InteractionResponse;
  if (!response.ok) {
    throw new GeminiImageError(providerDiagnostic(data) ?? "No se pudo recuperar la imagen generada.", response.status);
  }
  return data;
}

function isTerminalFailureStatus(status?: string) {
  return status === "failed" || status === "cancelled" || status === "incomplete";
}

async function recoverInteractionImage(args: {
  apiKey: string;
  interactionId: string;
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  let latest: InteractionResponse | null = null;

  for (let attempt = 0; attempt < RECOVERY_ATTEMPTS && Date.now() - startedAt < args.timeoutMs; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(650 * 2 ** (attempt - 1), 2_500)));
    }

    latest = await fetchInteraction({
      apiKey: args.apiKey,
      interactionId: args.interactionId,
      timeoutMs: Math.min(15_000, args.timeoutMs),
    });
    console.info("GEMINI_IMAGE_RECOVERY_RESPONSE_SHAPE", describeGeminiInteractionPayload(latest));

    const generated = await extractGeminiImageResult(latest, {
      apiKey: args.apiKey,
      timeoutMs: Math.min(15_000, args.timeoutMs),
    });
    if (generated) return { generated, latest };
    if (providerDiagnostic(latest) || isTerminalFailureStatus(latest.status)) break;
  }

  return { generated: null, latest };
}

function missingImageError(data: InteractionResponse | null | undefined) {
  const diagnostic = data ? providerDiagnostic(data) : null;
  if (diagnostic) return diagnostic;
  const text = data ? interactionText(data) : null;
  const suffix = data?.status ? ` (status ${data.status})` : "";
  return text
    ? `Gemini terminó sin devolver una imagen utilizable${suffix}. Respuesta del modelo: ${text.slice(0, 220)}`
    : `Gemini terminó sin devolver una imagen utilizable${suffix}.`;
}

export async function getStoredGeneratedImage(args: {
  apiKey: string;
  interactionId: string;
  timeoutMs?: number;
}) {
  const data = await fetchInteraction(args);
  console.info("GEMINI_IMAGE_RECOVERY_RESPONSE_SHAPE", describeGeminiInteractionPayload(data));

  const generated = await extractGeminiImageResult(data, {
    apiKey: args.apiKey,
    timeoutMs: args.timeoutMs,
  });
  if (generated) return generated;

  throw new GeminiImageError(missingImageError(data), 502);
}

export async function generateImage(args: GenerateImageArgs): Promise<GeneratedImage> {
  const model = args.model ?? "gemini-3.1-flash-image";
  const referenceImages = args.referenceImages ?? [];
  const input: InteractionContent[] = [
    { type: "text", text: args.prompt },
    ...referenceImages.map((ref) => ({
      type: "image",
      mime_type: ref.mimeType,
      data: ref.data,
    })),
  ];

  let response: Response;
  try {
    response = await fetch(INTERACTIONS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey,
      },
      body: JSON.stringify({
        model,
        input,
        store: true,
        // Ask Gemini to include the generated media directly in the stored interaction.
        response_format: {
          type: "image",
          delivery: "inline",
          mime_type: "image/jpeg",
          aspect_ratio: args.aspectRatio ?? "1:1",
          ...(args.imageSize ? { image_size: args.imageSize } : {}),
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new GeminiImageError(`No se pudo conectar con Gemini${detail}`, 502);
  }

  const raw = await response.text();
  let data: InteractionResponse = {};
  try {
    data = raw ? JSON.parse(raw) as InteractionResponse : {};
  } catch {
    throw new GeminiImageError(
      `Gemini devolvió una respuesta inválida (HTTP ${response.status}).`,
      response.ok ? 502 : response.status,
    );
  }

  console.info("GEMINI_IMAGE_RESPONSE_SHAPE", describeGeminiInteractionPayload(data));

  if (!response.ok) {
    const suffix = data.error?.status ? ` [${data.error.status}]` : "";
    throw new GeminiImageError(
      providerDiagnostic(data) ? `${providerDiagnostic(data)}${suffix}` : `Gemini respondió HTTP ${response.status}`,
      response.status,
    );
  }

  const diagnostic = providerDiagnostic(data);
  if (diagnostic) throw new GeminiImageError(diagnostic, data.error?.code ?? 502);

  const generated = await extractGeminiImageResult(data, {
    apiKey: args.apiKey,
    timeoutMs: Math.min(args.timeoutMs ?? 30_000, 30_000),
  });
  if (generated) return generated;

  if (data.id) {
    const recovered = await recoverInteractionImage({
      apiKey: args.apiKey,
      interactionId: data.id,
      timeoutMs: Math.min(args.timeoutMs ?? 30_000, 30_000),
    });
    if (recovered.generated) return recovered.generated;
    throw new GeminiImageError(missingImageError(recovered.latest ?? data), 502);
  }

  throw new GeminiImageError(missingImageError(data), 502);
}
