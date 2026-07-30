// Single source of truth for Gemini image-generation pricing. Nothing else
// in the codebase should hardcode a per-image or per-token price -- update
// this file and every caller of estimateImageCostUsd()/estimateFinalCostUsd()
// picks it up automatically.
//
// Prices are official per Google's published Gemini API pricing as of the
// effectiveFrom date below. Image-output models bill per output image at a
// fixed price bucket by resolution (not per-pixel), plus ordinary per-token
// pricing for any text input/output alongside the image.
export type GeminiImageModel = "gemini-3.1-flash-lite-image" | "gemini-3.1-flash-image" | "gemini-3-pro-image";

export type GeminiPricingEntry = {
  model: GeminiImageModel;
  inputTokenPriceUsdPerMillion: number;
  outputTokenPriceUsdPerMillion: number;
  imagePriceByResolution: Record<"1K" | "2K" | "4K", number>;
  effectiveFrom: string;
  source: string;
  enabled: boolean;
};

export const geminiPricingConfig: GeminiPricingEntry[] = [
  {
    model: "gemini-3.1-flash-lite-image",
    inputTokenPriceUsdPerMillion: 0.1,
    outputTokenPriceUsdPerMillion: 0.4,
    imagePriceByResolution: { "1K": 0.02, "2K": 0.03, "4K": 0.06 },
    effectiveFrom: "2026-07-01",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    enabled: true,
  },
  {
    model: "gemini-3.1-flash-image",
    inputTokenPriceUsdPerMillion: 0.3,
    outputTokenPriceUsdPerMillion: 2.5,
    imagePriceByResolution: { "1K": 0.039, "2K": 0.06, "4K": 0.12 },
    effectiveFrom: "2026-07-01",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    enabled: true,
  },
  {
    model: "gemini-3-pro-image",
    inputTokenPriceUsdPerMillion: 2,
    outputTokenPriceUsdPerMillion: 12,
    imagePriceByResolution: { "1K": 0.24, "2K": 0.24, "4K": 0.48 },
    effectiveFrom: "2026-07-01",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    enabled: true,
  },
];

export function getGeminiPricing(model: string): GeminiPricingEntry {
  const entry = geminiPricingConfig.find((p) => p.model === model && p.enabled);
  if (!entry) throw new Error(`No hay configuración de precio para el modelo "${model}".`);
  return entry;
}

// Conservative upper-bound estimate used to size the budget RESERVATION
// before calling Gemini (worst case: max resolution + a generous text-token
// allowance for the prompt/response). Actual cost is computed after the
// call from real usageMetadata via estimateFinalCostUsd().
export function estimateImageCostUsd(model: string, resolution: "1K" | "2K" | "4K") {
  const pricing = getGeminiPricing(model);
  const worstCaseTextUsd =
    (2000 / 1_000_000) * pricing.inputTokenPriceUsdPerMillion +
    (500 / 1_000_000) * pricing.outputTokenPriceUsdPerMillion;
  return pricing.imagePriceByResolution[resolution] + worstCaseTextUsd;
}

export function estimateFinalCostUsd(args: {
  model: string;
  resolution: "1K" | "2K" | "4K";
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  imageCount?: number;
}) {
  const pricing = getGeminiPricing(args.model);
  const inputCost = ((args.promptTokenCount ?? 0) / 1_000_000) * pricing.inputTokenPriceUsdPerMillion;
  const outputTextCost =
    ((args.candidatesTokenCount ?? 0) + (args.thoughtsTokenCount ?? 0)) / 1_000_000 * pricing.outputTokenPriceUsdPerMillion;
  const imageCost = pricing.imagePriceByResolution[args.resolution] * (args.imageCount ?? 1);
  return Number((inputCost + outputTextCost + imageCost).toFixed(6));
}
