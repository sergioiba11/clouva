import { createHash, randomUUID } from "node:crypto";
import type { ToolRiskLevel } from "./tool-executor";
import type { RoutedTool, ToolRouter } from "./tool-router";

export type ToolConfirmationRequirement = "review" | "explicit";
export type ToolActionStatus = "pending" | "executing" | "executed" | "cancelled" | "failed";

export interface ToolActionPreview {
  kind: "diff" | "parameters";
  detail: string;
  diff?: string;
  truncated?: boolean;
}

export interface PendingToolAction {
  id: string;
  functionName: string;
  target: string;
  tool: string;
  risk: Exclude<ToolRiskLevel, "read">;
  title: string;
  summary: string;
  confirmation: ToolConfirmationRequirement;
  preview: ToolActionPreview;
  arguments: Record<string, unknown>;
  /** GitHub blob SHA read while producing the diff. `null` means the file
   * did not exist. Checked again at execution time to reject stale diffs. */
  baseVersion?: string | null;
  status: ToolActionStatus;
  requestedAt: string;
  updatedAt?: string;
  error?: string;
}

export interface PendingToolActionView
  extends Omit<PendingToolAction, "arguments" | "baseVersion"> {
  messageId: string;
}

export type ToolGateDecision =
  | { kind: "executed"; result: unknown }
  | { kind: "confirmation_required"; action: PendingToolAction };

interface ConfirmationGateOptions {
  id?: () => string;
  now?: () => Date;
}

const DIFF_SIDE_LIMIT = 90;

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function takeChangedLines(lines: string[]): { lines: string[]; truncated: boolean } {
  if (lines.length <= DIFF_SIDE_LIMIT) return { lines, truncated: false };
  const head = lines.slice(0, Math.floor(DIFF_SIDE_LIMIT / 2));
  const tail = lines.slice(-Math.ceil(DIFF_SIDE_LIMIT / 2));
  return { lines: [...head, `… ${lines.length - DIFF_SIDE_LIMIT} líneas omitidas …`, ...tail], truncated: true };
}

/** Compact unified-style diff for a full-file replacement. It preserves
 * three context lines at each edge and caps very large changed regions so a
 * model cannot flood the confirmation UI with hundreds of kilobytes. */
export function createTextDiff(path: string, before: string, after: string): ToolActionPreview {
  if (before === after) {
    return { kind: "diff", detail: `Sin cambios efectivos en ${path}.`, diff: "(sin diferencias)" };
  }

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const removedView = takeChangedLines(removed);
  const addedView = takeChangedLines(added);
  const beforeContext = beforeLines.slice(Math.max(0, prefix - 3), prefix);
  const afterContext = suffix ? afterLines.slice(afterLines.length - suffix, afterLines.length - suffix + 3) : [];
  const oldStart = Math.max(1, prefix - beforeContext.length + 1);
  const newStart = Math.max(1, prefix - beforeContext.length + 1);

  const diff = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${beforeContext.length + removed.length + afterContext.length} +${newStart},${beforeContext.length + added.length + afterContext.length} @@`,
    ...beforeContext.map((line) => ` ${line}`),
    ...removedView.lines.map((line) => `-${line}`),
    ...addedView.lines.map((line) => `+${line}`),
    ...afterContext.map((line) => ` ${line}`),
  ].join("\n");

  return {
    kind: "diff",
    detail: `${removed.length} líneas reemplazadas; ${added.length} líneas nuevas en ${path}.`,
    diff,
    truncated: removedView.truncated || addedView.truncated,
  };
}

function safeParameterPreview(args: Record<string, unknown>): string {
  const safe = Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      /token|secret|password|credential|api[_-]?key/i.test(key) ? "[oculto]" : value,
    ]),
  );
  const text = JSON.stringify(safe, null, 2);
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n… vista previa truncada …` : text;
}

function textContentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parsePendingToolAction(value: unknown): PendingToolAction | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.functionName !== "string" ||
    typeof value.target !== "string" ||
    typeof value.tool !== "string" ||
    !["write", "destructive", "sensitive"].includes(String(value.risk)) ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    !["review", "explicit"].includes(String(value.confirmation)) ||
    !isRecord(value.preview) ||
    !isRecord(value.arguments) ||
    !["pending", "executing", "executed", "cancelled", "failed"].includes(String(value.status)) ||
    typeof value.requestedAt !== "string"
  ) {
    return null;
  }
  return value as unknown as PendingToolAction;
}

export function pendingToolActionView(action: PendingToolAction, messageId: string): PendingToolActionView {
  const { arguments: _arguments, baseVersion: _baseVersion, ...visible } = action;
  return { ...visible, messageId };
}

export class ToolConfirmationGate {
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(options: ConfirmationGateOptions = {}) {
    this.createId = options.id ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async evaluate(routed: RoutedTool, args: Record<string, unknown>): Promise<ToolGateDecision> {
    if (routed.definition.risk === "read") {
      return { kind: "executed", result: await routed.definition.execute(args) };
    }

    let preview: ToolActionPreview;
    let summary = `${routed.definition.description}`;
    let title = `Revisar ${routed.definition.name}`;
    let baseVersion: string | null | undefined;

    if (routed.executor.target === "github" && routed.definition.name === "github_write_file") {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const commitMessage = String(args.message ?? "");
      const readTool = routed.executor.getTool("github_read_file");
      let before = "";
      let exists = false;

      if (!readTool) throw new Error("GitHubExecutor no expone la lectura necesaria para preparar el diff.");
      try {
        const current = (await readTool.execute({ path })) as { content?: string; sha?: string };
        before = current.content ?? "";
        baseVersion = current.sha || null;
        exists = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/no encontr[oó]/i.test(message)) throw error;
        baseVersion = null;
      }

      preview = createTextDiff(path, before, content);
      title = exists ? `Actualizar ${path}` : `Crear ${path}`;
      summary = `${exists ? "Reemplazar" : "Crear"} el archivo y generar el commit “${commitMessage}”.`;
    } else if (routed.executor.target === "workspace" && routed.definition.name === "workspace.files.write") {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const readTool = routed.executor.getTool("workspace.files.read");
      let before = "";
      let exists = false;

      if (!readTool) throw new Error("WorkspaceExecutor no expone la lectura necesaria para preparar el diff.");
      try {
        const current = (await readTool.execute({ path })) as { content?: string };
        before = current.content ?? "";
        baseVersion = textContentHash(before);
        exists = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/enoent|no such file|no encontr/i.test(message)) throw error;
        baseVersion = "missing";
      }

      preview = createTextDiff(path, before, content);
      title = exists ? `Actualizar ${path}` : `Crear ${path}`;
      summary = `${exists ? "Reemplazar" : "Crear"} el archivo local después de revisar el diff.`;
    } else {
      const detail = safeParameterPreview(args);
      preview = { kind: "parameters", detail, truncated: detail.includes("truncada") };
    }

    const risk = routed.definition.risk as Exclude<ToolRiskLevel, "read">;
    return {
      kind: "confirmation_required",
      action: {
        id: this.createId(),
        functionName: routed.functionName,
        target: routed.executor.target,
        tool: routed.definition.name,
        risk,
        title,
        summary,
        confirmation: risk === "write" ? "review" : "explicit",
        preview,
        arguments: args,
        baseVersion,
        status: "pending",
        requestedAt: this.now().toISOString(),
      },
    };
  }

  async confirm(router: ToolRouter, action: PendingToolAction): Promise<unknown> {
    if (action.status !== "pending" && action.status !== "executing") {
      throw new Error("La acción ya no está pendiente de confirmación.");
    }
    const routed = router.resolve(action.functionName);
    if (!routed || routed.executor.target !== action.target || routed.definition.name !== action.tool) {
      throw new Error("La herramienta propuesta ya no está disponible.");
    }
    if (routed.definition.risk === "read" || routed.definition.risk !== action.risk) {
      throw new Error("El nivel de riesgo de la herramienta cambió; prepará una propuesta nueva.");
    }

    const normalized = router.normalizeArguments(routed, action.arguments);
    const executionArgs: Record<string, unknown> = { ...normalized, confirm: true };
    if (action.target === "github" && action.tool === "github_write_file") {
      executionArgs.expectedSha = action.baseVersion ?? null;
    }
    if (action.target === "workspace" && action.tool === "workspace.files.write") {
      executionArgs.expectedContentHash = action.baseVersion ?? "missing";
    }
    return routed.definition.execute(executionArgs);
  }
}
