import "server-only";
import type { TrademarkSearchProvider, TrademarkSearchResult } from "./types";

// Los registros oficiales (INPI/WIPO/USPTO/EUIPO/TMview) requieren una
// integración específica, términos de uso y, según el caso, credenciales.
// Hasta conectar providers reales, el resultado debe ser explícitamente
// "no disponible"; nunca se puede inferir que la marca está libre.
export function configuredTrademarkProviders(): TrademarkSearchProvider[] {
  return [];
}

export async function searchExternalNames(args: {
  providers?: TrademarkSearchProvider[];
  variants: string[];
  categories: string[];
  country: string | null;
}): Promise<{ available: boolean; sourcesChecked: string[]; results: TrademarkSearchResult[] }> {
  const providers = (args.providers ?? configuredTrademarkProviders()).filter((provider) => provider.isAvailable());
  if (providers.length === 0) return { available: false, sourcesChecked: [], results: [] };

  const settled = await Promise.allSettled(
    providers.map(async (provider) => ({ provider: provider.id, results: await provider.searchName({ variants: args.variants, categories: args.categories, country: args.country }) })),
  );
  const sourcesChecked: string[] = [];
  const results: TrademarkSearchResult[] = [];
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    sourcesChecked.push(item.value.provider);
    results.push(...item.value.results);
  }
  return { available: sourcesChecked.length > 0, sourcesChecked, results };
}
