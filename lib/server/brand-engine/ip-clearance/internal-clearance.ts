import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hammingDistanceHex } from "../fingerprint-logo";
import type { BrandNaming, BrandOwnerType, InternalBrandMatch, InternalClearanceStatus, LogoFingerprint } from "../types";
import { normalizeBrandText } from "./normalize-brand-query";

const BLOCK_DISTANCE = 6;
const REVIEW_DISTANCE = 12;

type StoredVersion = {
  id: string;
  fingerprint: Partial<LogoFingerprint> | null;
  generation_metadata: { naming?: BrandNaming } | null;
  brand_assets: { owner_type: BrandOwnerType; owner_id: string } | Array<{ owner_type: BrandOwnerType; owner_id: string }> | null;
};

function ownerFromRow(row: StoredVersion) {
  return Array.isArray(row.brand_assets) ? row.brand_assets[0] ?? null : row.brand_assets;
}

function fingerprintDistance(a: LogoFingerprint, b: Partial<LogoFingerprint>): number | null {
  const left = a.dhash ?? a.phash;
  const right = b.dhash ?? b.phash;
  if (!left || !right) return null;
  return hammingDistanceHex(left, right);
}

export async function runInternalClearance(args: {
  admin: SupabaseClient;
  ownerType: BrandOwnerType;
  ownerId: string;
  fingerprint: LogoFingerprint;
  naming: BrandNaming;
}): Promise<{
  checked: true;
  status: InternalClearanceStatus;
  highestSimilarity: number;
  conflictingOwnerId: string | null;
  conflictingVersionId: string | null;
  matches: InternalBrandMatch[];
}> {
  const { data, error } = await args.admin
    .from("brand_asset_versions")
    .select("id,fingerprint,generation_metadata,brand_assets!inner(owner_type,owner_id)")
    .in("status", ["approved", "published"]);
  if (error) throw new Error(`No se pudo ejecutar el clearance interno: ${error.message}`);

  const candidateName = normalizeBrandText(args.naming.displayName);
  const candidateDescriptor = normalizeBrandText(args.naming.descriptor);
  const matches: InternalBrandMatch[] = [];
  let status: InternalClearanceStatus = "internal_clear";

  for (const raw of data ?? []) {
    const row = raw as unknown as StoredVersion;
    const owner = ownerFromRow(row);
    if (!owner) continue;
    if (owner.owner_type === args.ownerType && owner.owner_id === args.ownerId) continue;

    const stored = row.fingerprint ?? {};
    const storedName = normalizeBrandText(row.generation_metadata?.naming?.displayName);
    const storedDescriptor = normalizeBrandText(row.generation_metadata?.naming?.descriptor);
    let similarity = 0;
    let reason = "";
    let blocked = false;
    let review = false;

    if (stored.sha256 && stored.sha256 === args.fingerprint.sha256) {
      similarity = 1;
      reason = "Archivo idéntico a una identidad de otro propietario.";
      blocked = true;
    } else if (stored.normalizedSha256 && args.fingerprint.normalizedSha256 && stored.normalizedSha256 === args.fingerprint.normalizedSha256) {
      similarity = 1;
      reason = "Activo normalizado idéntico a una identidad de otro propietario.";
      blocked = true;
    } else {
      const distance = fingerprintDistance(args.fingerprint, stored);
      if (distance !== null) {
        similarity = Math.max(similarity, 1 - distance / 64);
        if (distance <= BLOCK_DISTANCE) {
          reason = "Similitud visual extremadamente alta con una identidad de otro propietario.";
          blocked = true;
        } else if (distance <= REVIEW_DISTANCE) {
          reason = "Similitud visual intermedia con una identidad de otro propietario.";
          review = true;
        }
      }
    }

    const exactName = Boolean(candidateName && storedName && candidateName === storedName);
    const exactDescriptor = candidateDescriptor === storedDescriptor;
    if (!blocked && exactName && exactDescriptor) {
      similarity = Math.max(similarity, 0.92);
      reason = "Nombre y descriptor coinciden con otra identidad de CLOUVA.";
      review = true;
    } else if (!blocked && exactName) {
      similarity = Math.max(similarity, 0.8);
      reason = reason || "Nombre principal coincide con otra identidad de CLOUVA.";
      review = true;
    }

    if (blocked || review) {
      matches.push({
        versionId: row.id,
        ownerType: owner.owner_type,
        ownerId: owner.owner_id,
        similarity,
        reason,
      });
      if (blocked) status = "internal_blocked_duplicate";
      else if (status === "internal_clear") status = "internal_review_required";
    }
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  const first = matches[0] ?? null;
  return {
    checked: true,
    status,
    highestSimilarity: first?.similarity ?? 0,
    conflictingOwnerId: first?.ownerId ?? null,
    conflictingVersionId: first?.versionId ?? null,
    matches: matches.slice(0, 10),
  };
}
