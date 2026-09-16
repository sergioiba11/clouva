import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeVisualContext } from "@/lib/clouva-ai/media/providers/google/context";
import { enrichMediaPrompt } from "@/lib/clouva-ai/media/providers/google/prompt";
import type { ClouAIContext, ClouAIContextAsset, ContextBundle } from "@/lib/clouva-ai/media/types";

const CONTEXT_COLUMNS = "id,name,description,instructions,tags,summary_json,summary_state,summary_model,summary_updated_at,created_at,updated_at";
const ASSET_COLUMNS = "id,context_id,name,kind,storage_path,public_url,mime_type,width,height,byte_size,position,priority,is_primary,metadata_json,created_at";

type ContextRow = {
  id: string; name: string; description: string; instructions: string; tags: string[];
  summary_json: Record<string, unknown>; summary_state: "stale" | "ready" | "failed";
  summary_model: string | null; summary_updated_at: string | null; created_at: string; updated_at: string;
};
type AssetRow = {
  id: string; context_id: string; name: string; kind: string; storage_path: string; public_url: string | null;
  mime_type: string; width: number | null; height: number | null; byte_size: number | null;
  position: number; priority: number; is_primary: boolean; metadata_json: Record<string, unknown>; created_at: string;
};

function contextFromRow(row: ContextRow): ClouAIContext {
  return {
    id: row.id, name: row.name, description: row.description, instructions: row.instructions,
    tags: row.tags ?? [], summary: row.summary_json ?? {}, summaryState: row.summary_state,
    summaryModel: row.summary_model, summaryUpdatedAt: row.summary_updated_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function assetFromRow(row: AssetRow): ClouAIContextAsset {
  return {
    id: row.id, contextId: row.context_id, name: row.name, kind: row.kind, storagePath: row.storage_path,
    publicUrl: row.public_url, mimeType: row.mime_type, width: row.width, height: row.height,
    byteSize: row.byte_size, position: row.position, priority: row.priority, isPrimary: row.is_primary,
    metadata: row.metadata_json ?? {}, createdAt: row.created_at,
  };
}

export async function listContextPacks(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("clouai_contexts").select(CONTEXT_COLUMNS).eq("user_id", userId).order("updated_at", { ascending: false });
  if (error) throw new Error("No se pudieron cargar los contextos de ClouAI.");
  const rows = (data ?? []) as unknown as ContextRow[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const { data: assetRows } = await admin.from("clouai_context_assets").select("context_id").eq("user_id", userId).in("context_id", ids);
  const counts = new Map<string, number>();
  for (const item of assetRows ?? []) counts.set(String(item.context_id), (counts.get(String(item.context_id)) ?? 0) + 1);
  return rows.map((row) => ({ ...contextFromRow(row), assetCount: counts.get(row.id) ?? 0 }));
}

export async function getContextPack(admin: SupabaseClient, userId: string, contextId: string) {
  const { data: contextRow, error } = await admin.from("clouai_contexts").select(CONTEXT_COLUMNS).eq("id", contextId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("No se pudo cargar el contexto.");
  if (!contextRow) return null;
  const { data: assetRows, error: assetError } = await admin.from("clouai_context_assets").select(ASSET_COLUMNS).eq("context_id", contextId).eq("user_id", userId).order("is_primary", { ascending: false }).order("priority", { ascending: false }).order("position", { ascending: true });
  if (assetError) throw new Error("No se pudieron cargar los assets del contexto.");
  return {
    context: contextFromRow(contextRow as unknown as ContextRow),
    assets: ((assetRows ?? []) as unknown as AssetRow[]).map(assetFromRow),
  };
}

export async function refreshContextSummary(admin: SupabaseClient, userId: string, contextId: string) {
  const pack = await getContextPack(admin, userId, contextId);
  if (!pack) throw new Error("El contexto no existe.");
  const images = pack.assets.filter((asset) => asset.kind === "image" && asset.mimeType.startsWith("image/"));
  try {
    const result = await summarizeVisualContext({
      name: pack.context.name,
      description: pack.context.description,
      instructions: pack.context.instructions,
      images: images.map((asset) => ({
        id: asset.id, name: asset.name, storagePath: asset.storagePath, mimeType: asset.mimeType,
        isPrimary: asset.isPrimary, priority: asset.priority,
      })),
    });
    const now = new Date().toISOString();
    const { error } = await admin.from("clouai_contexts").update({
      summary_json: result.summary,
      summary_state: "ready",
      summary_model: result.model,
      summary_updated_at: now,
      updated_at: now,
    }).eq("id", contextId).eq("user_id", userId);
    if (error) throw new Error("No se pudo guardar el resumen de contexto.");
    return { ...pack.context, summary: result.summary, summaryState: "ready" as const, summaryModel: result.model, summaryUpdatedAt: now, updatedAt: now };
  } catch (error) {
    await admin.from("clouai_contexts").update({ summary_state: "failed", updated_at: new Date().toISOString() }).eq("id", contextId).eq("user_id", userId);
    throw error;
  }
}

export async function buildContextBundle(admin: SupabaseClient, userId: string, contextIds: string[], mode: "image" | "video"): Promise<ContextBundle> {
  const uniqueIds = [...new Set(contextIds.filter(Boolean))].slice(0, 12);
  if (!uniqueIds.length) return { contexts: [], assets: [], activeReferences: [], contextText: "" };
  const contexts: ClouAIContext[] = [];
  const assets: ClouAIContextAsset[] = [];

  for (const id of uniqueIds) {
    let pack = await getContextPack(admin, userId, id);
    if (!pack) throw new Error(`El contexto ${id} no existe o no te pertenece.`);
    if (pack.context.summaryState !== "ready") {
      await refreshContextSummary(admin, userId, id);
      pack = await getContextPack(admin, userId, id);
      if (!pack) throw new Error("El contexto dejó de estar disponible.");
    }
    contexts.push(pack.context);
    assets.push(...pack.assets);
  }

  const sortedImages = assets
    .filter((asset) => asset.kind === "image" && asset.mimeType.startsWith("image/"))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.priority - a.priority || a.position - b.position);
  const maxRefs = mode === "video" ? 3 : 14;
  const activeReferences = sortedImages.slice(0, maxRefs);
  const contextText = contexts.map((context) => [
    `CONTEXT: ${context.name}`,
    context.description ? `Description: ${context.description}` : "",
    context.instructions ? `AUTHORITATIVE USER INSTRUCTIONS: ${context.instructions}` : "",
    `Structured summary: ${JSON.stringify(context.summary)}`,
  ].filter(Boolean).join("\n")).join("\n\n---\n\n");

  return { contexts, assets, activeReferences, contextText };
}

export async function compilePromptWithContext(admin: SupabaseClient, userId: string, args: { mode: "image" | "video"; prompt: string; contextIds: string[] }) {
  const bundle = await buildContextBundle(admin, userId, args.contextIds, args.mode);
  const enrichedPrompt = await enrichMediaPrompt({
    mode: args.mode,
    prompt: args.prompt,
    contextText: bundle.contextText,
    activeReferenceNames: bundle.activeReferences.map((asset) => asset.name),
  });
  return { bundle, enrichedPrompt };
}
