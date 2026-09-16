import "server-only";
import { getGoogleMediaClient } from "@/lib/clouva-ai/media/providers/google/client";
import { requireGoogleMediaConfig } from "@/lib/clouva-ai/media/config";
import type { ClouAIContextSummary } from "@/lib/clouva-ai/media/types";
import { generatedMediaGsUri } from "@/lib/gcs-media";

export type ContextImageInput = {
  id: string;
  name: string;
  storagePath: string;
  mimeType: string;
  isPrimary: boolean;
  priority: number;
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    identity: { type: "object", additionalProperties: true },
    logos: { type: "array", items: { type: "string" } },
    palette: { type: "array", items: { type: "string" } },
    characters: { type: "array", items: { type: "string" } },
    products: { type: "array", items: { type: "string" } },
    locations: { type: "array", items: { type: "string" } },
    visual_language: { type: "object", additionalProperties: true },
    materials: { type: "array", items: { type: "string" } },
    must_preserve: { type: "array", items: { type: "string" } },
    avoid: { type: "array", items: { type: "string" } },
    relationships: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["identity", "logos", "palette", "characters", "products", "locations", "visual_language", "materials", "must_preserve", "avoid", "relationships", "notes"],
  additionalProperties: false,
} as const;

const EMPTY_SUMMARY: ClouAIContextSummary = {
  identity: {},
  logos: [],
  palette: [],
  characters: [],
  products: [],
  locations: [],
  visual_language: {},
  materials: [],
  must_preserve: [],
  avoid: [],
  relationships: [],
  notes: [],
};

function parseSummary(text: string | undefined): ClouAIContextSummary {
  if (!text?.trim()) return EMPTY_SUMMARY;
  try {
    const parsed = JSON.parse(text) as Partial<ClouAIContextSummary>;
    return {
      identity: parsed.identity && typeof parsed.identity === "object" ? parsed.identity : {},
      logos: Array.isArray(parsed.logos) ? parsed.logos.map(String) : [],
      palette: Array.isArray(parsed.palette) ? parsed.palette.map(String) : [],
      characters: Array.isArray(parsed.characters) ? parsed.characters.map(String) : [],
      products: Array.isArray(parsed.products) ? parsed.products.map(String) : [],
      locations: Array.isArray(parsed.locations) ? parsed.locations.map(String) : [],
      visual_language: parsed.visual_language && typeof parsed.visual_language === "object" ? parsed.visual_language : {},
      materials: Array.isArray(parsed.materials) ? parsed.materials.map(String) : [],
      must_preserve: Array.isArray(parsed.must_preserve) ? parsed.must_preserve.map(String) : [],
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid.map(String) : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships.map(String) : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    };
  } catch {
    return { ...EMPTY_SUMMARY, notes: [text.slice(0, 4000)] };
  }
}

async function summarizeBatch(images: ContextImageInput[], label: string) {
  const client = getGoogleMediaClient();
  const model = requireGoogleMediaConfig().models.multimodal;
  const imageIndex = images.map((image, index) => `${index + 1}. ${image.name}${image.isPrimary ? " [PRIMARY]" : ""}`).join("\n");
  const parts = [
    {
      text: [
        `Analyze this visual reference batch for the persistent CLOUVA AI context "${label}".`,
        "Describe only what is supported by the references. Preserve exact brand/identity constraints when visible.",
        "PRIMARY references have higher authority. Return structured JSON only.",
        imageIndex,
      ].join("\n\n"),
    },
    ...images.map((image) => ({
      fileData: { fileUri: generatedMediaGsUri(image.storagePath), mimeType: image.mimeType },
    })),
  ];
  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: SUMMARY_SCHEMA,
      temperature: 0.15,
    },
  });
  return parseSummary(response.text);
}

export async function summarizeVisualContext(args: {
  name: string;
  description: string;
  instructions: string;
  images: ContextImageInput[];
}) {
  const sorted = [...args.images].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.priority - a.priority);
  const batches: ContextImageInput[][] = [];
  for (let index = 0; index < sorted.length; index += 16) batches.push(sorted.slice(index, index + 16));

  const batchSummaries: ClouAIContextSummary[] = [];
  for (let index = 0; index < batches.length; index += 1) {
    batchSummaries.push(await summarizeBatch(batches[index], `${args.name} · batch ${index + 1}/${batches.length}`));
  }

  if (!batchSummaries.length) {
    return {
      summary: { ...EMPTY_SUMMARY, notes: args.description ? [args.description] : [] },
      model: requireGoogleMediaConfig().models.multimodal,
    };
  }

  if (batchSummaries.length === 1) {
    const summary = batchSummaries[0];
    if (args.instructions.trim()) summary.must_preserve = [args.instructions.trim(), ...summary.must_preserve];
    return { summary, model: requireGoogleMediaConfig().models.multimodal };
  }

  const client = getGoogleMediaClient();
  const model = requireGoogleMediaConfig().models.multimodal;
  const response = await client.models.generateContent({
    model,
    contents: [{
      role: "user",
      parts: [{
        text: [
          `Merge these batch analyses into ONE persistent visual context for "${args.name}".`,
          `Description: ${args.description || "(none)"}`,
          `AUTHORITATIVE USER INSTRUCTIONS (highest priority): ${args.instructions || "(none)"}`,
          "Do not discard unique facts just because they appear in only one batch. Resolve conflicts in favor of PRIMARY/manual instructions. Return JSON only.",
          JSON.stringify(batchSummaries),
        ].join("\n\n"),
      }],
    }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: SUMMARY_SCHEMA,
      temperature: 0.1,
    },
  });
  const summary = parseSummary(response.text);
  if (args.instructions.trim() && !summary.must_preserve.includes(args.instructions.trim())) {
    summary.must_preserve.unshift(args.instructions.trim());
  }
  return { summary, model };
}
