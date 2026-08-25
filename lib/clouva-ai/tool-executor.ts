// The ToolExecutor contract — the shared shape every "thing CLOUVA AI can
// act on" implements: GitHubExecutor (this task, wraps lib/clouva-ai/github.ts)
// now, WorkspaceExecutor later (Task 10, talks to the user's PC over the
// existing Gateway instead of GitHub's REST API), CLOUVA domain-service
// executors later still (Task 12). A future Tool Router picks an executor by
// `target` and dispatches model-requested calls through Task 11's
// ToolConfirmationGate.
//
// Existence in an executor never grants automatic execution: ToolRouter
// exposes declarations to Gemini, validates arguments, and the separate
// confirmation gate decides whether the call may run or must pause.

export type ToolRiskLevel = "read" | "write" | "destructive" | "sensitive";

/** A minimal, Gemini-function-declaration-compatible JSON Schema subset
 * (OpenAPI-ish, uppercase types — matches what
 * https://ai.google.dev/api/rest/v1beta/Tool expects). Kept intentionally
 * small since nothing consumes it yet; extend it if/when Task 12's real
 * function-calling wiring needs more (enums, nested objects, arrays). */
export interface ToolParameterSchema {
  type: "OBJECT";
  properties: Record<string, { type: "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN"; description: string }>;
  required?: string[];
}

export interface ToolDefinition<Args extends Record<string, unknown> = Record<string, unknown>, Result = unknown> {
  /** Unique within its executor's `target` — not globally, since two
 * executors could plausibly expose a same-named tool ("readFile") against
 * different targets (GitHub vs a Workspace project). ToolRouter rejects
 * ambiguous Gemini-visible names. */
  name: string;
  description: string;
  risk: ToolRiskLevel;
  parameters: ToolParameterSchema;
  execute(args: Args): Promise<Result>;
}

export interface ToolExecutor {
  /** Which physical thing this executor talks to — "github" today,
   * "workspace" once Task 10 lands. */
  readonly target: string;
  tools(): ToolDefinition[];
  getTool(name: string): ToolDefinition | undefined;
}

/** Small shared base so every concrete executor only has to supply its tool
 * list — `tools()`/`getTool()` stay identical (case-sensitive exact match)
 * across all of them instead of each one reimplementing the same lookup. */
export abstract class BaseToolExecutor implements ToolExecutor {
  abstract readonly target: string;
  protected abstract readonly definitions: ToolDefinition[];

  tools(): ToolDefinition[] {
    return this.definitions;
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.definitions.find((tool) => tool.name === name);
  }
}
