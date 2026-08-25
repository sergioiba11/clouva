import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only wrapper around the ai_image_budgets ledger. Every call here
// goes through the SECURITY DEFINER Postgres functions (service-role only)
// so the reserve-check-commit sequence is atomic even under concurrent
// requests -- this module intentionally does no arithmetic of its own that
// could race against another request.
export const VISUAL_REDESIGN_BUDGET_SCOPE = "visual_redesign_2026";
export const TREBOL_MEDIA_BUDGET_SCOPE = "trebol_media_2026";
export const MAX_CONCURRENT_GENERATIONS = 2;
export const MAX_RETRIES_PER_ASSET = 2;

export function isImageGenerationEnabled() {
  return process.env.GEMINI_IMAGE_GENERATION_ENABLED !== "false";
}

export function hashFor(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type BudgetSnapshot = {
  allowed: boolean;
  reason: string;
  spent_usd: number | null;
  reserved_usd: number | null;
  hard_limit_usd: number | null;
  normal_limit_usd: number | null;
};

export async function reserveBudget(
  admin: SupabaseClient,
  args: { scope?: string; estimatedCostUsd: number; useReserve?: boolean },
): Promise<BudgetSnapshot> {
  const { data, error } = await admin.rpc("reserve_ai_image_budget", {
    p_scope: args.scope ?? VISUAL_REDESIGN_BUDGET_SCOPE,
    p_estimated_cost_usd: args.estimatedCostUsd,
    p_use_reserve: args.useReserve ?? false,
  });
  if (error) throw new Error(`No se pudo reservar presupuesto: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row as BudgetSnapshot;
}

export async function finalizeBudget(
  admin: SupabaseClient,
  args: { scope?: string; estimatedCostUsd: number; actualCostUsd: number },
) {
  const { error } = await admin.rpc("finalize_ai_image_budget", {
    p_scope: args.scope ?? VISUAL_REDESIGN_BUDGET_SCOPE,
    p_estimated_cost_usd: args.estimatedCostUsd,
    p_actual_cost_usd: args.actualCostUsd,
  });
  if (error) throw new Error(`No se pudo confirmar el gasto: ${error.message}`);
}

export async function releaseBudget(
  admin: SupabaseClient,
  args: { scope?: string; estimatedCostUsd: number },
) {
  const { error } = await admin.rpc("release_ai_image_budget", {
    p_scope: args.scope ?? VISUAL_REDESIGN_BUDGET_SCOPE,
    p_estimated_cost_usd: args.estimatedCostUsd,
  });
  if (error) throw new Error(`No se pudo liberar la reserva: ${error.message}`);
}

export async function getBudgetStatus(admin: SupabaseClient, scope = VISUAL_REDESIGN_BUDGET_SCOPE) {
  const { data, error } = await admin
    .from("ai_image_budgets")
    .select("*")
    .eq("scope", scope)
    .single();
  if (error) throw new Error(`No se pudo leer el presupuesto: ${error.message}`);
  return data;
}

export async function countActiveGenerations(admin: SupabaseClient, scope = VISUAL_REDESIGN_BUDGET_SCOPE) {
  const { count, error } = await admin
    .from("ai_image_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("scope", scope)
    .in("status", ["budget_reserved", "generating"]);
  if (error) throw new Error(`No se pudo verificar la concurrencia: ${error.message}`);
  return count ?? 0;
}

// Reuse: an already-completed job for the exact same prompt/input/model/resolution
// is served back instead of paying for a duplicate generation.
export async function findReusableJob(
  admin: SupabaseClient,
  args: { promptHash: string; inputHash: string; model: string; resolution: string },
) {
  const { data, error } = await admin
    .from("ai_image_generation_jobs")
    .select("id, output_path, actual_cost_usd")
    .eq("prompt_hash", args.promptHash)
    .eq("input_hash", args.inputHash)
    .eq("model", args.model)
    .eq("resolution", args.resolution)
    .eq("status", "completed")
    .not("output_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo verificar reutilización: ${error.message}`);
  return data;
}
