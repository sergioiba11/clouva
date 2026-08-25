import type { SupabaseClient } from "@supabase/supabase-js";
import { collectClouvaProcesses } from "@/lib/server/clouva-control";
import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";

type ListArgs = { limit?: number };
type JobArgs = { jobId: string };

export class RuntimeExecutor extends BaseToolExecutor {
  readonly target = "runtime";

  constructor(private readonly supabase: SupabaseClient) {
    super();
  }

  private async jobs(limit?: number) {
    return collectClouvaProcesses(this.supabase, Math.min(Math.max(limit ?? 12, 1), 30));
  }

  protected readonly definitions: ToolDefinition[] = [
    {
      name: "runtime.get_jobs",
      description: "CLOUVA CONTROL: lista procesos recientes visibles para un administrador validado.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { limit: { type: "INTEGER", description: "Máximo por fuente, entre 1 y 30." } },
      },
      execute: async (args: ListArgs) => this.jobs(args.limit),
    },
    {
      name: "runtime.get_failed_jobs",
      description: "CLOUVA CONTROL: lista procesos recientes fallidos o que requieren atención.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { limit: { type: "INTEGER", description: "Máximo por fuente, entre 1 y 30." } },
      },
      execute: async (args: ListArgs) => (await this.jobs(args.limit))
        .filter((job) => job.normalizedStatus === "failed" || job.normalizedStatus === "attention"),
    },
    {
      name: "runtime.get_job",
      description: "CLOUVA CONTROL: obtiene un proceso específico por su identificador exacto.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { jobId: { type: "STRING", description: "Identificador exacto del proceso." } },
        required: ["jobId"],
      },
      execute: async (args: JobArgs) => {
        const jobId = args.jobId.trim().slice(0, 200);
        const job = (await this.jobs(30)).find((item) => item.id === jobId);
        if (!job) throw new Error("CLOUVA CONTROL no encontró ese proceso entre los trabajos recientes.");
        return job;
      },
    },
  ];
}
