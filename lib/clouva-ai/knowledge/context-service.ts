import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEffectiveMemory } from "@/lib/server/memory-approval";
import { createAdminSupabase } from "@/lib/server/supabase";

export type ClouvaKnowledgeScope =
  | "core"
  | "player"
  | "project"
  | "entities"
  | "relations"
  | "decisions"
  | "recent_events"
  | "procedures"
  | "live_data";

export type ClouvaContextRequest = {
  supabase: SupabaseClient;
  userId: string;
  conversationId?: string | null;
  studioId?: string | null;
  projectId?: string | null;
  query: string;
  requiredScopes?: ClouvaKnowledgeScope[];
  limit?: number;
};

type KnowledgeRpcResult = {
  query?: string;
  scopes?: string[];
  entities?: Array<Record<string, unknown>>;
  relations?: Array<Record<string, unknown>>;
  procedures?: Array<Record<string, unknown>>;
  core?: Array<Record<string, unknown>>;
  liveData?: Record<string, unknown>;
  prompt?: string;
};

type EventRow = {
  id: string;
  event_type: string;
  component: string | null;
  summary: string;
  entity_type: string | null;
  entity_id: string | null;
  source: string;
  occurred_at: string;
};

const DEFAULT_SCOPES: ClouvaKnowledgeScope[] = [
  "core",
  "player",
  "project",
  "entities",
  "relations",
  "decisions",
  "recent_events",
  "procedures",
  "live_data",
];

const STOP_WORDS = new Set([
  "para", "como", "con", "del", "las", "los", "una", "uno", "que", "por",
  "esto", "esta", "ese", "esa", "hay", "quiero", "seguimos", "seguir", "sobre",
]);

function tokensFor(query: string): string[] {
  return Array.from(new Set(query
    .toLocaleLowerCase("es")
    .split(/[^a-z0-9áéíóúüñ]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))));
}

function relevance(text: string, tokens: string[]): number {
  if (!tokens.length) return 1;
  const haystack = text.toLocaleLowerCase("es");
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function hasScope(scopes: Set<ClouvaKnowledgeScope>, scope: ClouvaKnowledgeScope) {
  return scopes.has(scope);
}

/**
 * Central selective retrieval service for CLOUVA AI.
 *
 * Canonical structured facts are resolved by an internal service-role RPC;
 * the calling user's Supabase client still owns all memory/event reads through
 * RLS. approved project_memory remains the durable human-reviewed memory
 * layer; project_events remains the recent event layer; live state is returned
 * only when the query asks for a live domain (agenda/commerce today).
 */
export async function getClouvaContext(request: ClouvaContextRequest) {
  const query = request.query.trim().slice(0, 2_000);
  const limit = Math.min(Math.max(request.limit ?? 8, 1), 12);
  const requested = new Set<ClouvaKnowledgeScope>(request.requiredScopes?.length
    ? request.requiredScopes
    : DEFAULT_SCOPES);
  const tokens = tokensFor(query);
  const admin = createAdminSupabase();

  const [{ data: graphData, error: graphError }, memoryRows, eventResult] = await Promise.all([
    admin.rpc("clouva_resolve_knowledge_context", {
      p_user_id: request.userId,
      p_query: query,
      p_studio_id: request.studioId ?? null,
      p_limit: limit,
    }),
    (hasScope(requested, "player") || hasScope(requested, "project") || hasScope(requested, "decisions"))
      ? loadEffectiveMemory({
          supabase: request.supabase,
          userId: request.userId,
          studioId: request.studioId ?? null,
          limit: 24,
        })
      : Promise.resolve([]),
    hasScope(requested, "recent_events")
      ? (() => {
          let eventQuery = request.supabase
            .from("project_events")
            .select("id,event_type,component,summary,entity_type,entity_id,source,occurred_at")
            .eq("project_key", "clouva")
            .eq("context_eligible", true)
            .order("occurred_at", { ascending: false })
            .limit(24);
          eventQuery = request.studioId
            ? eventQuery.eq("studio_id", request.studioId)
            : eventQuery.eq("user_id", request.userId).is("studio_id", null);
          return eventQuery;
        })()
      : Promise.resolve({ data: [] as EventRow[], error: null }),
  ]);

  if (graphError) throw new Error(`Knowledge retrieval failed: ${graphError.message}`);
  if (eventResult.error) throw new Error(`Recent event retrieval failed: ${eventResult.error.message}`);

  const graph = (graphData ?? {}) as KnowledgeRpcResult;
  const memory = memoryRows
    .map((row) => ({ row, score: relevance(`${row.memory_type} ${row.title} ${row.content}`, tokens) }))
    .filter(({ score }) => !tokens.length || score > 0)
    .sort((a, b) => b.score - a.score || b.row.importance - a.row.importance)
    .slice(0, limit)
    .map(({ row }) => row);

  const recentEvents = ((eventResult.data ?? []) as EventRow[])
    .map((row) => ({ row, score: relevance(`${row.event_type} ${row.component ?? ""} ${row.summary} ${row.entity_type ?? ""}`, tokens) }))
    .filter(({ score }) => !tokens.length || score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.row.occurred_at) - Date.parse(a.row.occurred_at))
    .slice(0, limit)
    .map(({ row }) => row);

  const entities = hasScope(requested, "entities") || hasScope(requested, "player") || hasScope(requested, "project")
    ? (graph.entities ?? []).filter((entity) => !request.projectId || entity.projectId === request.projectId || !entity.projectId)
    : [];
  const entityIds = new Set(entities.map((entity) => entity.id).filter((id): id is string => typeof id === "string"));
  const relations = hasScope(requested, "relations")
    ? (graph.relations ?? []).filter((relation) => {
        if (!request.projectId || !entityIds.size) return true;
        return entityIds.has(String(relation.sourceId ?? "")) || entityIds.has(String(relation.targetId ?? ""));
      })
    : [];

  const core = hasScope(requested, "core") ? graph.core ?? [] : [];
  const procedures = hasScope(requested, "procedures") ? graph.procedures ?? [] : [];
  const liveData = hasScope(requested, "live_data") ? graph.liveData ?? {} : {};

  return {
    query,
    conversationId: request.conversationId ?? null,
    studioId: request.studioId ?? null,
    projectId: request.projectId ?? null,
    requestedScopes: Array.from(requested),
    core,
    memory,
    entities,
    relations,
    recentEvents,
    procedures,
    liveData,
    sourceOfTruth: {
      memory: "project_memory",
      events: "project_events",
      entities: "canonical_source_table/canonical_source_id",
      liveData: "canonical live tables",
    },
    prompt: graph.prompt ?? "",
  };
}
