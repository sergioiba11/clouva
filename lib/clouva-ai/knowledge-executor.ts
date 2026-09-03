import type { SupabaseClient } from "@supabase/supabase-js";
import { getClouvaContext, type ClouvaKnowledgeScope } from "@/lib/clouva-ai/knowledge/context-service";
import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";

type ContextArgs = {
  query: string;
  scopes?: string;
  projectId?: string;
  limit?: number;
};

const ALLOWED_SCOPES = new Set<ClouvaKnowledgeScope>([
  "core",
  "player",
  "project",
  "entities",
  "relations",
  "decisions",
  "recent_events",
  "procedures",
  "live_data",
]);

function parseScopes(value?: string): ClouvaKnowledgeScope[] | undefined {
  if (!value?.trim()) return undefined;
  const scopes = value.split(",")
    .map((scope) => scope.trim())
    .filter((scope): scope is ClouvaKnowledgeScope => ALLOWED_SCOPES.has(scope as ClouvaKnowledgeScope));
  return scopes.length ? Array.from(new Set(scopes)) : undefined;
}

/** Read-only selective knowledge access through the single CLOUVA AI Tool Router. */
export class KnowledgeExecutor extends BaseToolExecutor {
  readonly target = "knowledge";

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
    private readonly studioId: string | null,
    private readonly conversationId: string | null,
  ) {
    super();
  }

  protected readonly definitions: ToolDefinition[] = [
    {
      name: "knowledge.context",
      description: "Recupera contexto relevante de CLOUVA Core, Player, proyecto, entidades, relaciones, procedimientos, eventos y datos vivos. Usala cuando una referencia como 'seguimos con...' necesite recuperar qué objeto/proyecto se está hablando, o cuando necesites conocimiento canónico sin inventarlo.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Consulta breve o referencia que necesita contexto, por ejemplo: 'pica del Iglú'." },
          scopes: { type: "STRING", description: "Scopes opcionales separados por coma: core,player,project,entities,relations,decisions,recent_events,procedures,live_data." },
          projectId: { type: "STRING", description: "UUID de proyecto si ya fue resuelto; no lo inventes." },
          limit: { type: "INTEGER", description: "Máximo de resultados por capa, entre 1 y 12." },
        },
        required: ["query"],
      },
      execute: async (args: ContextArgs) => {
        const query = args.query?.trim().slice(0, 2_000);
        if (!query || query.length < 2) throw new Error("La consulta de conocimiento debe tener al menos 2 caracteres.");
        return getClouvaContext({
          supabase: this.supabase,
          userId: this.userId,
          studioId: this.studioId,
          conversationId: this.conversationId,
          projectId: args.projectId?.trim() || null,
          query,
          requiredScopes: parseScopes(args.scopes),
          limit: Math.min(Math.max(args.limit ?? 8, 1), 12),
        });
      },
    },
  ];
}
