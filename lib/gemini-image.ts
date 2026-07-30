const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiImageModel = "gemini-3.1-flash-lite-image" | "gemini-3.1-flash-image" | "gemini-3-pro-image";
// The generateContent REST endpoint's ImageConfig only supports aspect_ratio --
// output resolution (1K/2K/4K) is not a field this API surface exposes today
// (that only exists on the separate, not-yet-adopted-here Interactions API).
export type GeminiAspectRatio =
  | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";

export type GeminiReferenceImage = { mimeType: string; data: string };

export type GenerateImageArgs = {
  apiKey: string;
  prompt: string;
  referenceImages?: GeminiReferenceImage[];
  model?: GeminiImageModel;
  aspectRatio?: GeminiAspectRatio;
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
};

export class GeminiImageError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export async function generateImage(args: GenerateImageArgs): Promise<GeneratedImage> {
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
  };
}
