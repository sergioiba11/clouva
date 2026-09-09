import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hammingDistanceHex } from "../fingerprint-logo";
import type { BrandNaming, BrandOwnerType, InternalBrandMatch, InternalClearanceStatus, LogoFingerprint } from "../types";
import { normalizeBrandText } from "./normalize-brand-query";

const BLOCK_DISTANCE = 6;
const REVIEW_DISTANCE = 12;

type StoredVersion = {
  id: string;
  brand_asset_id: string;
  fingerprint: Partial<LogoFingerprint> | null;
  generation_metadata: { naming?: BrandNaming } | null;
};

type StoredOwner = {
  id: string;
  owner_type: BrandOwnerType;
  owner_id: string;
};

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
  // Do not embed brand_assets from brand_asset_versions here. The schema has
  // two legitimate relationships between these tables (version.brand_asset_id
  // and asset.active_version_id), so PostgREST cannot infer a unique join.
  // Resolve owners in two explicit queries keyed by brand_asset_id instead.
  const { data: versionData, error: versionError } = await args.admin
    .from("brand_asset_versions")
    .select("id,brand_asset_id,fingerprint,generation_metadata")
    .in("status", ["approved", "published"]);
  if (versionError) throw new Error(`No se pudo ejecutar el clearance interno: ${versionError.message}`);

  const versions = (versionData ?? []) as unknown as StoredVersion[];
  const brandAssetIds = Array.from(new Set(versions.map((row) => row.brand_asset_id).filter(Boolean)));
  const ownersByAssetId = new Map<string, StoredOwner>();

  if (brandAssetIds.length) {
    const { data: ownerData, error: ownerError } = await args.admin
      .from("brand_assets")
      .select("id,owner_type,owner_id")
      .in("id", brandAssetIds);
    if (ownerError) throw new Error(`No se pudo ejecutar el clearance interno: ${ownerError.message}`);
    for (const owner of (ownerData ?? []) as unknown as StoredOwner[]) ownersByAssetId.set(owner.id, owner);
  }

  const candidateName = normalizeBrandText(args.naming.displayName);
  const candidateDescriptor = normalizeBrandText(args.naming.descriptor);
  const matches: InternalBrandMatch[] = [];
  let status: InternalClearanceStatus = "internal_clear";

  for (const row of versions) {
    const owner = ownersByAssetId.get(row.brand_asset_id);
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
