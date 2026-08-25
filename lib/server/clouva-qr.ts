import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/site-url";

export type ClouvaQrEntityType = "PRODUCT" | "VARIANT" | "ITEM" | "USER" | "SPACE";
export type ClouvaQrStatus = "ACTIVE" | "REVOKED";

export type ClouvaQrRecord = {
  id: string;
  public_token: string;
  entity_type: ClouvaQrEntityType;
  entity_id: string;
  studio_id: string | null;
  source_identifier_id: string | null;
  status: ClouvaQrStatus;
  is_canonical: boolean;
  destination_path: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ClouvaQrRpcResult = {
  qr: ClouvaQrRecord;
  created: boolean;
};

export function clouvaQrUrl(publicToken: string) {
  return `${siteUrl.replace(/\/$/, "")}/q/${encodeURIComponent(publicToken)}`;
}

export async function getClouvaQr(args: {
  admin: SupabaseClient;
  entityType: ClouvaQrEntityType;
  entityId: string;
}) {
  const { data, error } = await args.admin
    .from("clouva_qr_registry")
    .select("id,public_token,entity_type,entity_id,studio_id,source_identifier_id,status,is_canonical,destination_path,metadata,created_at,updated_at")
    .eq("entity_type", args.entityType)
    .eq("entity_id", args.entityId)
    .eq("status", "ACTIVE")
    .eq("is_canonical", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClouvaQrRecord | null) ?? null;
}

export async function getOrCreateClouvaQr(args: {
  admin: SupabaseClient;
  entityType: Extract<ClouvaQrEntityType, "USER" | "ITEM" | "SPACE">;
  entityId: string;
  actorId: string;
  studioId?: string | null;
  destinationPath?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const existing = await getClouvaQr({
    admin: args.admin,
    entityType: args.entityType,
    entityId: args.entityId,
  });
  if (existing && (!args.destinationPath || existing.destination_path === args.destinationPath)) {
    return { qr: existing, created: false, url: clouvaQrUrl(existing.public_token) };
  }

  // The service-role RPC is also responsible for refreshing a canonical
  // destination path without rotating the permanent public token.
  const { data, error } = await args.admin.rpc("get_or_create_clouva_qr", {
    p_entity_type: args.entityType,
    p_entity_id: args.entityId,
    p_actor_id: args.actorId,
    p_studio_id: args.studioId ?? null,
    p_destination_path: args.destinationPath ?? null,
    p_metadata: args.metadata ?? {},
  });
  if (error) throw new Error(error.message);
  const result = data as ClouvaQrRpcResult | null;
  if (!result?.qr?.public_token) throw new Error("El registro QR no devolvió un token válido.");
  return { qr: result.qr, created: Boolean(result.created), url: clouvaQrUrl(result.qr.public_token) };
}

export function serializeClouvaQr(qr: ClouvaQrRecord, created = false) {
  return {
    id: qr.id,
    entityType: qr.entity_type,
    entityId: qr.entity_id,
    publicToken: qr.public_token,
    url: clouvaQrUrl(qr.public_token),
    status: qr.status,
    destinationPath: qr.destination_path,
    createdAt: qr.created_at,
    created,
  };
}
