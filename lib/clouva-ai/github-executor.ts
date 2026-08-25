// GitHubExecutor — the first concrete ToolExecutor. Wraps
// lib/clouva-ai/github.ts's four functions AS-IS (no rewrite, no behavior
// change to that file) in the ToolExecutor shape: name, description, risk
// level, a parameter schema, and an execute() that just calls straight
// through. app/api/clouva-ai/github/route.ts (the client-facing endpoint)
// and lib/clouva-ai/repository-context.ts (the Orchestrator's "project"
// mode prefetch) both keep calling github.ts's functions directly — this
// executor is the Orchestrator ToolRouter's entry point; the direct route
// and repository-context helper remain for their existing legacy callers.

import { getRepositoryStatus, listRepositoryFiles, readRepositoryFile, searchRepositoryCode, writeRepositoryFile } from "./github";
import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";

type EmptyArgs = Record<string, never>;
type ReadFileArgs = { path: string };
type SearchCodeArgs = { query: string; path?: string; limit?: number };
type WriteFileArgs = {
  path: string;
  content: string;
  message: string;
  /** Internal confirmation supplied by the server-side confirmation gate.
   * It is deliberately absent from the model-visible parameter schema: a
   * model saying `confirm:true` is not user consent. */
  confirm?: boolean;
  /** SHA captured while building the user-visible diff. `null` means the
   * proposal was for a new file. Also internal, never model-controlled. */
  expectedSha?: string | null;
};

export class GitHubExecutor extends BaseToolExecutor {
  readonly target = "github";

  protected readonly definitions: ToolDefinition[] = [
    {
      name: "github_get_status",
      description: "Devuelve repositorio, rama y estado actual del repo real de CLOUVA en GitHub.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async (_args: EmptyArgs) => getRepositoryStatus(),
    },
    {
      name: "github_list_files",
      description: "Lista todos los archivos del repo real de CLOUVA en la rama configurada.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async (_args: EmptyArgs) => listRepositoryFiles(),
    },
    {
      name: "github_read_file",
      description: "Lee el contenido real de un archivo del repo de CLOUVA por su ruta.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Ruta del archivo dentro del repo, p. ej. 'app/layout.tsx'." },
        },
        required: ["path"],
      },
      execute: async (args: ReadFileArgs) => readRepositoryFile(args.path),
    },
    {
      name: "github_search_code",
      description: "Busca código real en el repositorio configurado de GitHub con resultados acotados.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "Texto o símbolo a buscar." },
          path: { type: "STRING", description: "Ruta opcional dentro del repositorio." },
          limit: { type: "INTEGER", description: "Máximo de resultados, entre 1 y 20." },
        },
        required: ["query"],
      },
      execute: async (args: SearchCodeArgs) => searchRepositoryCode(args),
    },
    {
      name: "github_write_file",
      description:
        "Prepara la creación o reemplazo de un archivo real del repo de CLOUVA. La compuerta muestra el diff y sólo ejecuta después de la confirmación humana.",
      risk: "write",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Ruta del archivo a escribir." },
          content: { type: "STRING", description: "Contenido completo nuevo del archivo (UTF-8)." },
          message: { type: "STRING", description: "Mensaje de commit." },
        },
        required: ["path", "content", "message"],
      },
      execute: async (args: WriteFileArgs) => {
        // Same explicit-confirm requirement app/api/clouva-ai/github/route.ts
        // already enforces on its own "write" action — mirrored here as a
        // belt-and-suspenders local check, not a substitute for Task 11's
        // real confirmation gate (which will sit in front of every executor,
        // not just this one tool).
        if (!args.confirm) {
          throw new Error("La escritura requiere confirmación explícita (confirm=true).");
        }
        return writeRepositoryFile({
          path: args.path,
          content: args.content,
          message: args.message,
          expectedSha: args.expectedSha,
        });
      },
    },
  ];
}
