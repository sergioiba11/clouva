import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEffectiveMemory } from "@/lib/server/memory-approval";
import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";

type SearchArgs = { query: string; limit?: number };
type RelevantArgs = { limit?: number };

export class MemoryExecutor extends BaseToolExecutor {
  readonly target = "memory";

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
    private readonly studioId: string | null,
  ) {
    super();
  }

  protected readonly definitions: ToolDefinition[] = [
    {
      name: "memory.search",
      description: "Busca solamente dentro de la memoria aprobada del proyecto o Estudio activo.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Texto breve que debe aparecer en título, contenido o tipo de memoria." },
          limit: { type: "INTEGER", description: "Máximo de resultados, entre 1 y 12." },
        },
        required: ["query"],
      },
      execute: async (args: SearchArgs) => {
        const query = args.query.trim().toLocaleLowerCase("es").slice(0, 200);
        if (query.length < 2) throw new Error("La búsqueda de memoria debe tener al menos 2 caracteres.");
        const rows = await loadEffectiveMemory({
          supabase: this.supabase,
          userId: this.userId,
          studioId: this.studioId,
          limit: 40,
        });
        const limit = Math.min(Math.max(args.limit ?? 8, 1), 12);
        return rows.filter((row) => `${row.memory_type} ${row.title} ${row.content}`.toLocaleLowerCase("es").includes(query)).slice(0, limit);
      },
    },
    {
      name: "memory.get_relevant",
      description: "Devuelve las memorias aprobadas más importantes del contexto activo.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          limit: { type: "INTEGER", description: "Máximo de memorias, entre 1 y 12." },
        },
      },
      execute: async (args: RelevantArgs) => loadEffectiveMemory({
        supabase: this.supabase,
        userId: this.userId,
        studioId: this.studioId,
        limit: Math.min(Math.max(args.limit ?? 8, 1), 12),
      }),
    },
  ];
}
