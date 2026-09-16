import "server-only";
import { getGoogleMediaClient } from "@/lib/clouva-ai/media/providers/google/client";
import { requireGoogleMediaConfig } from "@/lib/clouva-ai/media/config";
import { generatedMediaGsUri } from "@/lib/gcs-media";

export type GoogleImageReference = {
  id: string;
  storagePath: string;
  mimeType: string;
};

export async function generateGoogleImage(args: {
  prompt: string;
  references: GoogleImageReference[];
  aspectRatio: string;
  imageSize: "1K" | "2K" | "4K";
  seed?: number | null;
}) {
  const config = requireGoogleMediaConfig();
  const client = getGoogleMediaClient();
  const parts = [
    { text: args.prompt },
    ...args.references.slice(0, 14).map((reference) => ({
      fileData: {
        fileUri: generatedMediaGsUri(reference.storagePath),
        mimeType: reference.mimeType,
      },
    })),
  ];

  const response = await client.models.generateContent({
    model: config.models.image,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
      imageConfig: {
        aspectRatio: args.aspectRatio,
        imageSize: args.imageSize,
      },
      ...(typeof args.seed === "number" ? { seed: args.seed } : {}),
    },
  });

  const responseParts = response.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];
  const imagePart = responseParts.find((part) => part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/"));
  if (!imagePart?.inlineData?.data) {
    throw new Error(response.text?.trim() || "Vertex AI terminó sin devolver una imagen.");
  }

  return {
    bytes: Buffer.from(imagePart.inlineData.data, "base64"),
    mimeType: imagePart.inlineData.mimeType || "image/png",
    model: config.models.image,
    text: response.text?.trim() || null,
    usageMetadata: response.usageMetadata ?? null,
    activeReferenceIds: args.references.slice(0, 14).map((reference) => reference.id),
  };
}
