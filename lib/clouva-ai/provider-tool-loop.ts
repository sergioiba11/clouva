import type { PendingToolAction, ToolConfirmationGate } from "./tool-confirmation";
import type { ToolRiskLevel } from "./tool-executor";
import type { RoutedTool, ToolRouter } from "./tool-router";
import type { ClouvaAIProviderId, NormalizedToolCall, ProviderConversationItem } from "./providers/types";
import type { ClouvaAIProviderRouter } from "./providers/provider-router";

export interface ToolCallTrace {
  target: string;
  tool: string;
  risk: ToolRiskLevel;
  status: "executed" | "failed" | "confirmation_required";
  error?: string;
}

export interface ProviderToolLoopResult {
  text: string;
  provider: ClouvaAIProviderId;
  model: string;
  primaryProvider: ClouvaAIProviderId;
  fallbackUsed: boolean;
  pendingAction: PendingToolAction | null;
  traces: ToolCallTrace[];
  usage: Record<string, unknown> | null;
  continuationContents: ProviderConversationItem[];
  limitReached: boolean;
}

export interface ToolCallAuditEvent {
  routed: RoutedTool;
  arguments: Record<string, unknown>;
  status: "executed" | "failed" | "pending_confirmation";
  result?: unknown;
  error?: string;
  pendingAction?: PendingToolAction;
}

function safeToolResponse(result: unknown): Record<string, unknown> {
  let raw: string;
  try { raw = JSON.stringify(result ?? null); }
  catch { return { ok: false, error: "La herramienta devolvió un resultado no serializable." }; }
  if (raw.length <= 60_000) return { ok: true, result: result ?? null };
  return { ok: true, truncated: true, resultPreview: raw.slice(0, 60_000) };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function callFingerprint(call: NormalizedToolCall, args: Record<string, unknown>) {
  return `${call.name}:${canonicalJson(args)}`;
}

export async function runProviderToolLoop(args: {
  providerRouter: ClouvaAIProviderRouter;
  instruction: string;
  contents: ProviderConversationItem[];
  router: ToolRouter;
  gate: ToolConfirmationGate;
  temperature?: number;
  maxOutputTokens?: number;
  maxSteps?: number;
  onToolCall?: (event: ToolCallAuditEvent) => Promise<void> | void;
}): Promise<ProviderToolLoopResult> {
  const workingContents = args.contents.slice();
  const traces: ToolCallTrace[] = [];
  const declarations = args.router.declarations();
  const maxSteps = args.maxSteps ?? 8;
  const completedReadCalls = new Set<string>();
  let activeProvider: ClouvaAIProviderId = args.providerRouter.primaryProvider.id;
  let activeModel = args.providerRouter.selectedModel;
  let primaryProvider = args.providerRouter.primaryProvider.id;
  let fallbackUsed = false;
  let lastUsage: Record<string, unknown> | null = null;

  async function audit(event: ToolCallAuditEvent) {
    try { await args.onToolCall?.(event); }
    catch (error) { console.error("CLOUVA AI tool audit failed", error); }
  }

  for (let step = 0; step < maxSteps; step += 1) {
    const turn = await args.providerRouter.toolTurn({
      instruction: args.instruction,
      contents: workingContents,
      declarations,
      temperature: args.temperature,
      maxOutputTokens: args.maxOutputTokens,
      preferredProvider: activeProvider,
      preferredModel: activeModel,
    });
    activeProvider = turn.provider;
    activeModel = turn.model;
    primaryProvider = turn.primaryProvider;
    fallbackUsed ||= turn.fallbackUsed;
    lastUsage = turn.usage;

    if (!turn.calls.length) {
      if (!turn.text) throw new Error("ClouAI terminó el ciclo de herramientas sin una respuesta final.");
      return {
        text: turn.text,
        provider: activeProvider,
        model: activeModel,
        primaryProvider,
        fallbackUsed,
        pendingAction: null,
        traces,
        usage: lastUsage,
        continuationContents: workingContents,
        limitReached: false,
      };
    }

    workingContents.push({ kind: "assistant_tool_call", text: turn.text, calls: turn.calls });

    for (const call of turn.calls) {
      const routed = args.router.resolve(call.name);
      if (!routed) {
        workingContents.push({
          kind: "tool_result",
          result: { call, response: { ok: false, error: `El modelo pidió una herramienta desconocida: ${call.name}.` } },
        });
        continue;
      }

      try {
        const normalized = args.router.normalizeArguments(routed, call.arguments);
        const normalizedCall = { ...call, arguments: normalized };
        const fingerprint = callFingerprint(normalizedCall, normalized);
        if (routed.definition.risk === "read" && completedReadCalls.has(fingerprint)) {
          const error = "Esta lectura ya se ejecutó con los mismos argumentos. Usá el resultado anterior y avanzá a la respuesta o a una única propuesta de escritura.";
          traces.push({ target: routed.executor.target, tool: routed.definition.name, risk: routed.definition.risk, status: "failed", error });
          await audit({ routed, arguments: normalized, status: "failed", error });
          workingContents.push({ kind: "tool_result", result: { call: normalizedCall, response: { ok: false, duplicate: true, error } } });
          continue;
        }

        const decision = await args.gate.evaluate(routed, normalized);
        if (decision.kind === "confirmation_required") {
          traces.push({ target: routed.executor.target, tool: routed.definition.name, risk: routed.definition.risk, status: "confirmation_required" });
          await audit({ routed, arguments: normalized, status: "pending_confirmation", pendingAction: decision.action });
          const prefix = turn.text ? `${turn.text}\n\n` : "";
          return {
            text: `${prefix}${decision.action.summary}\n\nRevisá la propuesta antes de decidir; todavía no se ejecutó ningún cambio.`,
            provider: activeProvider,
            model: activeModel,
            primaryProvider,
            fallbackUsed,
            pendingAction: decision.action,
            traces,
            usage: lastUsage,
            continuationContents: workingContents,
            limitReached: false,
          };
        }

        if (routed.definition.risk === "read") completedReadCalls.add(fingerprint);
        traces.push({ target: routed.executor.target, tool: routed.definition.name, risk: routed.definition.risk, status: "executed" });
        await audit({ routed, arguments: normalized, status: "executed", result: decision.result });
        workingContents.push({ kind: "tool_result", result: { call: normalizedCall, response: safeToolResponse(decision.result) } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        traces.push({ target: routed.executor.target, tool: routed.definition.name, risk: routed.definition.risk, status: "failed", error: message });
        const normalized = (() => {
          try { return args.router.normalizeArguments(routed, call.arguments); } catch { return {}; }
        })();
        await audit({ routed, arguments: normalized, status: "failed", error: message });
        workingContents.push({ kind: "tool_result", result: { call: { ...call, arguments: normalized }, response: { ok: false, error: message } } });
      }
    }
  }

  return {
    text: `Revisé ${traces.length} resultado${traces.length === 1 ? "" : "s"} de herramientas, pero el ciclo alcanzó su límite seguro antes de preparar una acción. No se ejecutó ni se propuso ninguna escritura.`,
    provider: activeProvider,
    model: activeModel,
    primaryProvider,
    fallbackUsed,
    pendingAction: null,
    traces,
    usage: lastUsage,
    continuationContents: workingContents,
    limitReached: true,
  };
}
