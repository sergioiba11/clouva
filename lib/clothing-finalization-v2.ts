import { finalizeClothingItem as finalizeLegacy } from "@/lib/clothing-finalization";

type FinalizeInput = Parameters<typeof finalizeLegacy>[0];

function cleanOriginalUrl(metadata: Record<string, unknown>, fallback: string) {
  const candidate = metadata.source_meshy_model_url;
  if (typeof candidate !== "string" || !candidate.startsWith("https://")) return fallback;
  return candidate;
}

export async function finalizeClothingItem(input: FinalizeInput) {
  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata as Record<string, unknown>
    : {};
  const originalModelUrl = cleanOriginalUrl(metadata, input.modelUrl);

  return finalizeLegacy({
    ...input,
    modelUrl: originalModelUrl,
    metadata: {
      ...metadata,
      source_meshy_model_url: originalModelUrl,
      source_model_kind: "meshy-original",
      force_fresh_source: true,
    },
  });
}
