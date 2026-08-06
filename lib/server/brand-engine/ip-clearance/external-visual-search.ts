import "server-only";
import type { VisualBrandMatch, VisualBrandSearchProvider } from "./types";

export function configuredVisualBrandProviders(): VisualBrandSearchProvider[] {
  return [];
}

export async function searchExternalVisuals(args: {
  providers?: VisualBrandSearchProvider[];
  imageBytes: Buffer;
  categories: string[];
}): Promise<{ available: boolean; sourcesChecked: string[]; results: VisualBrandMatch[] }> {
  const providers = (args.providers ?? configuredVisualBrandProviders()).filter((provider) => provider.isAvailable());
  if (providers.length === 0) return { available: false, sourcesChecked: [], results: [] };

  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({ provider: provider.id, results: await provider.searchVisual({ imageBytes: args.imageBytes, categories: args.categories }) })),
  );
  const sourcesChecked: string[] = [];
  const results: VisualBrandMatch[] = [];
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    sourcesChecked.push(item.value.provider);
    results.push(...item.value.results);
  }
  return { available: sourcesChecked.length > 0, sourcesChecked, results };
}
