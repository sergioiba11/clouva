const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

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
    this.status = status;
  }
}

type InteractionContent = {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
  mimeType?: string;
};

type InteractionResponse = {
  id?: string;
  status?: string;
  steps?: Array<{ type?: string; content?: InteractionContent[] }>;
  outputs?: InteractionContent[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: number };
};

function interactionToImage(data: InteractionResponse): GeneratedImage {
  const content = [
    ...(data.steps ?? []).flatMap((step) => step.type === "model_output" ? (step.content ?? []) : []),
    ...(data.outputs ?? []),
  ];
  const image = content.find((item) => item.type === "image" && item.data);
  const text = content.find((item) => item.type === "text" && item.text?.trim());
  if (!image?.data) throw new GeminiImageError("Gemini terminó sin devolver una imagen.", 502);

  return {
    bytes: Buffer.from(image.data, "base64"),
    mimeType: image.mime_type ?? image.mimeType ?? "image/png",
    text: text?.text?.trim() ?? null,
    usageMetadata: data.usage ? {
      promptTokenCount: data.usage.prompt_tokens,
      candidatesTokenCount: data.usage.completion_tokens,
      totalTokenCount: data.usage.total_tokens,
    } : null,
    providerOperationId: data.id ?? null,
  };
}

async function requestInteraction(args: GenerateImageArgs) {
  const input: string | Array<Record<string, string>> = args.referenceImages?.length
    ? [
      { type: "text", text: args.prompt },
      ...args.referenceImages.map((reference) => ({
        type: "image",
        mime_type: reference.mimeType,
        data: reference.data,
      })),
    ]
    : args.prompt;

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": args.apiKey,
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify({
      model: args.model ?? "gemini-3.1-flash-image",
      input,
      store: true,
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: args.aspectRatio ?? "1:1",
        image_size: args.imageSize,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 55_000),
  });

  const raw = await response.text();
  let data: InteractionResponse = {};
  try {
    data = raw ? JSON.parse(raw) as InteractionResponse : {};
  } catch {
    throw new GeminiImageError("Gemini devolvió una respuesta inválida.", 502);
  }
  if (!response.ok) {
    throw new GeminiImageError(data.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status);
  }
  return interactionToImage(data);
}

export async function getStoredGeneratedImage(args: { apiKey: string; interactionId: string; timeoutMs?: number }) {
  if (!/^int_[a-zA-Z0-9_-]+$/.test(args.interactionId)) {
    throw new GeminiImageError("Identificador de interacción inválido.", 400);
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(args.interactionId)}`,
    {
      headers: { "x-goog-api-key": args.apiKey, "Api-Revision": "2026-05-20" },
      cache: "no-store",
      signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
    },
  );
  const data = await response.json().catch(() => ({})) as InteractionResponse;
  if (!response.ok) throw new GeminiImageError(data.error?.message ?? "No se pudo recuperar la imagen generada.", response.status);
  return interactionToImage(data);
}

export async function generateImage(args: GenerateImageArgs): Promise<GeneratedImage> {
  // Las llamadas que piden una resolución explícita usan Interactions, la
  // superficie oficial que admite 1K/2K/4K. Los consumidores existentes que
  // no pasan imageSize conservan exactamente el flujo generateContent previo.
  if (args.imageSize) return requestInteraction(args);

  const model = args.model ?? "gemini-3.1-flash-image";

  const parts: Array<Record<string, unknown>> = [{ text: args.prompt }];
  for (const ref of args.referenceImages ?? []) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }

  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": args.apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: args.aspectRatio ?? "1:1",
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 55_000),
  });

  const raw = await response.text();
  let data: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
    error?: { message?: string };
  } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new GeminiImageError("Gemini devolvió una respuesta inválida.", 502);
  }

  if (!response.ok) {
    throw new GeminiImageError(data.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status);
  }

  const responseParts = data.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((part) => part.inlineData?.data);
  const textPart = responseParts.find((part) => typeof part.text === "string" && part.text.trim());

  if (!imagePart?.inlineData?.data) {
    const finishReason = data.candidates?.[0]?.finishReason;
    throw new GeminiImageError(
      finishReason ? `Gemini terminó sin imagen (${finishReason}).` : "Gemini no devolvió ninguna imagen.",
      502,
    );
  }

  return {
    bytes: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType ?? "image/png",
    text: textPart?.text?.trim() ?? null,
    usageMetadata: data.usageMetadata ?? null,
    providerOperationId: null,
  };
}
