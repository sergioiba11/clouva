import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hammingDistanceHex } from "./fingerprint-logo";
import type { LogoFingerprint } from "./types";

// Umbral inicial, a calibrar con casos reales (punto 9 del plan: sin
// embeddings/pgvector todavía, esto es una primera pasada honesta, no una
// garantía matemática de "nunca se repite" -- ver aclaración del pedido
// original: "la semejanza conceptual absoluta no se demuestra
// matemáticamente"). 64 bits totales; 6 bits de diferencia o menos se trata
// como "básicamente la misma imagen" (recoloreada/escalada/comprimida).
export const PHASH_SIMILARITY_THRESHOLD = 6;

export type UniquenessCheckResult = { unique: true } | { unique: false; reason: string };

// Compara contra (a) los candidatos ya generados en esta misma corrida y
// (b) los fingerprints de brand_asset_versions aprobadas/publicadas en toda
// la app. Nunca compara contra 'draft' -- un draft todavía no es una
// identidad real, no tiene sentido bloquear una generación nueva por
// parecerse a un borrador que ni siquiera se aprobó.
export async function checkUniqueness(
  admin: SupabaseClient,
  candidate: LogoFingerprint,
  sameRunCandidates: LogoFingerprint[],
): Promise<UniquenessCheckResult> {
  for (const other of sameRunCandidates) {
    if (other.sha256 === candidate.sha256) return { unique: false, reason: "Idéntico a otro candidato de esta misma corrida." };
    if (hammingDistanceHex(other.phash, candidate.phash) <= PHASH_SIMILARITY_THRESHOLD) {
      return { unique: false, reason: "Demasiado parecido a otro candidato de esta misma corrida." };
    }
  }

  const { data: existing, error } = await admin
    .from("brand_asset_versions")
    .select("fingerprint")
    .in("status", ["approved", "published"]);
  if (error) throw new Error(`No se pudo verificar unicidad: ${error.message}`);

  for (const row of existing ?? []) {
    const fingerprint = row.fingerprint as Partial<LogoFingerprint> | null;
    if (!fingerprint?.sha256 || !fingerprint?.phash) continue;
    if (fingerprint.sha256 === candidate.sha256) {
      return { unique: false, reason: "Idéntico a un logo oficial ya guardado en CLOUVA." };
    }
    if (hammingDistanceHex(fingerprint.phash, candidate.phash) <= PHASH_SIMILARITY_THRESHOLD) {
      return { unique: false, reason: "Demasiado parecido a un logo oficial ya guardado en CLOUVA." };
    }
  }

  return { unique: true };
}
