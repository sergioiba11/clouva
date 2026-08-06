import "server-only";
import type { BrandClearanceResult, BrandNaming, BrandOwnerType, LogoFingerprint } from "../types";
import { buildBrandSearchVariants } from "./normalize-brand-query";
import { runInternalClearance } from "./internal-clearance";
import { searchExternalNames } from "./external-name-search";
import { searchExternalVisuals } from "./external-visual-search";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function runBrandClearance(args: {
  admin: SupabaseClient;
  ownerType: BrandOwnerType;
  ownerId: string;
  fingerprint: LogoFingerprint;
  naming: BrandNaming;
  imageBytes: Buffer;
  categories: string[];
  country: string | null;
}): Promise<BrandClearanceResult> {
  const internal = await runInternalClearance({
    admin: args.admin,
    ownerType: args.ownerType,
    ownerId: args.ownerId,
    fingerprint: args.fingerprint,
    naming: args.naming,
  });

  const variants = buildBrandSearchVariants(args.naming.displayName, args.naming.descriptor);
  const [nameSearch, visualSearch] = await Promise.all([
    searchExternalNames({ variants, categories: args.categories, country: args.country }),
    searchExternalVisuals({ imageBytes: args.imageBytes, categories: args.categories }),
  ]);

  const sourcesChecked = Array.from(new Set([...nameSearch.sourcesChecked, ...visualSearch.sourcesChecked]));
  const nameRisk = nameSearch.results.reduce((max, match) => Math.max(max, match.similarity), 0);
  const visualRisk = visualSearch.results.reduce((max, match) => Math.max(max, match.similarity), 0);
  const classOverlap = [...nameSearch.results, ...visualSearch.results].reduce((max, match) => Math.max(max, match.classOverlap), 0);
  const externalAvailable = nameSearch.available || visualSearch.available;

  const decisionReasons: string[] = [];
  let status: BrandClearanceResult["status"];
  let externalStatus: BrandClearanceResult["external"]["status"];

  if (internal.status === "internal_blocked_duplicate") {
    status = "blocked_internal_duplicate";
    externalStatus = externalAvailable ? "review_required" : "external_check_unavailable";
    decisionReasons.push("La identidad coincide o es excesivamente parecida a la de otro propietario dentro de CLOUVA.");
  } else if (!externalAvailable) {
    status = "external_check_unavailable";
    externalStatus = "external_check_unavailable";
    decisionReasons.push("No hay providers oficiales externos configurados; la identidad requiere revisión antes de publicarse.");
  } else if (nameRisk >= 0.92 && visualRisk >= 0.9 && classOverlap >= 0.5) {
    status = "blocked_combined_conflict";
    externalStatus = "blocked";
    decisionReasons.push("Se detectó un conflicto combinado fuerte de nombre, imagen y rubro.");
  } else if (nameRisk >= 0.95 && classOverlap >= 0.5) {
    status = "blocked_external_name_conflict";
    externalStatus = "blocked";
    decisionReasons.push("Se detectó un conflicto externo fuerte de nombre en categorías relacionadas.");
  } else if (visualRisk >= 0.94) {
    status = "blocked_external_visual_conflict";
    externalStatus = "blocked";
    decisionReasons.push("Se detectó un conflicto visual externo fuerte.");
  } else if (internal.status === "internal_review_required" || nameRisk >= 0.72 || visualRisk >= 0.78) {
    status = "review_required";
    externalStatus = "review_required";
    decisionReasons.push("La identidad necesita revisión por similitudes internas o externas intermedias.");
  } else {
    status = "clear";
    externalStatus = "clear";
    decisionReasons.push("No se encontraron coincidencias relevantes en las fuentes efectivamente consultadas.");
  }

  return {
    status,
    internal,
    external: {
      checked: externalAvailable,
      status: externalStatus,
      nameRisk,
      visualRisk,
      classOverlap,
      sourcesChecked,
      matches: [...nameSearch.results, ...visualSearch.results].slice(0, 20),
    },
    decisionReasons,
    checkedAt: new Date().toISOString(),
  };
}
