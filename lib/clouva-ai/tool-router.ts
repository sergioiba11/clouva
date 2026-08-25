import type {
  ToolDefinition,
  ToolExecutor,
  ToolParameterSchema,
} from "./tool-executor";

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface RoutedTool {
  /** Gemini-compatible name. Workspace's dotted protocol names are exposed
   * with underscores, then mapped back to the exact Desktop tool name. */
  functionName: string;
  executor: ToolExecutor;
  definition: ToolDefinition;
}

const MAX_ARGUMENT_BYTES = 250_000;

function geminiFunctionName(target: string, toolName: string): string {
  const normalized = toolName.replace(/[^A-Za-z0-9_]/g, "_");
  const safe = /^[A-Za-z_]/.test(normalized) ? normalized : `${target}_${normalized}`;
  return safe.slice(0, 64);
}

function riskInstruction(risk: ToolDefinition["risk"]): string {
  if (risk === "read") return "Lectura: puede ejecutarse automáticamente.";
  if (risk === "write") return "Escritura: se prepara un diff y espera confirmación humana.";
  return "Acción de alto riesgo: requiere confirmación humana reforzada.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "STRING") return typeof value === "string";
  if (type === "BOOLEAN") return typeof value === "boolean";
  if (type === "NUMBER") return typeof value === "number" && Number.isFinite(value);
  if (type === "INTEGER") return typeof value === "number" && Number.isInteger(value);
  return false;
}

/** The one registry used by Gemini and by the confirmation endpoint. It
 * rejects ambiguous names and strips every argument that is not declared in
 * the tool schema, so model output cannot smuggle server-only flags such as
 * `confirm` or `expectedSha`. */
export class ToolRouter {
  private readonly routed = new Map<string, RoutedTool>();

  constructor(private readonly executors: ToolExecutor[]) {
    for (const executor of executors) {
      for (const definition of executor.tools()) {
        const functionName = geminiFunctionName(executor.target, definition.name);
        if (this.routed.has(functionName)) {
          throw new Error(`Nombre de herramienta ambiguo: ${functionName}.`);
        }
        this.routed.set(functionName, { functionName, executor, definition });
      }
    }
  }

  declarations(): GeminiFunctionDeclaration[] {
    return Array.from(this.routed.values()).map(({ functionName, executor, definition }) => ({
      name: functionName,
      description: `[${executor.target}] ${definition.description} ${riskInstruction(definition.risk)}`,
      parameters: definition.parameters,
    }));
  }

  resolve(functionName: string): RoutedTool | undefined {
    return this.routed.get(functionName);
  }

  normalizeArguments(routed: RoutedTool, value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`Argumentos inválidos para ${routed.functionName}.`);

    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, "utf8") > MAX_ARGUMENT_BYTES) {
      throw new Error(`Los argumentos de ${routed.functionName} son demasiado grandes.`);
    }

    const { properties, required = [] } = routed.definition.parameters;
    const normalized: Record<string, unknown> = {};

    for (const name of required) {
      if (!(name in value)) throw new Error(`Falta el argumento requerido '${name}' para ${routed.functionName}.`);
    }

    for (const [name, schema] of Object.entries(properties)) {
      const argument = value[name];
      if (argument === undefined) continue;
      if (!matchesType(argument, schema.type)) {
        throw new Error(`El argumento '${name}' de ${routed.functionName} no tiene el tipo esperado.`);
      }
      normalized[name] = argument;
    }

    return normalized;
  }

  async close(): Promise<void> {
    await Promise.all(
      this.executors.map(async (executor) => {
        const close = (executor as ToolExecutor & { close?: () => Promise<void> }).close;
        if (typeof close === "function") await close.call(executor);
      }),
    );
  }
}
