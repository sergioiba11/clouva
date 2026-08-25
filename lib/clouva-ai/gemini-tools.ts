import type { PendingToolAction, ToolConfirmationGate } from "./tool-confirmation";
import type { ToolRiskLevel } from "./tool-executor";
import type { GeminiFunctionDeclaration, RoutedTool, ToolRouter } from "./tool-router";

type GeminiFunctionCall = { id?: string; name: string; args: Record<string, unknown> };
type GeminiPart = {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  [key: string]: unknown;
};
type GeminiContent = { role: string; parts: GeminiPart[] };

type GeminiPayload = {
  candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

export interface ToolCallTrace {
  target: string;
  tool: string;
  risk: ToolRiskLevel;
  status: "executed" | "failed" | "confirmation_required";
  error?: string;
}

export interface GeminiToolLoopResult {
  text: string;
  model: string;
  pendingAction: PendingToolAction | null;
  traces: ToolCallTrace[];
  usage: Record<string, unknown> | null;
  /** Full model/function history before the already-generated draft answer.
   * The route uses it for one final real streaming pass with tools disabled,
   * so Task 11 does not regress Task 5's token streaming. */
  continuationContents: Array<Record<string, unknown>>;
  /** The bounded tool phase stopped before the model produced a final turn.
   * The route will still perform one tools-disabled finalization pass. */
  limitReached: boolean;
}

interface ToolTurnResult {
  model: string;
  content: GeminiContent;
  text: string;
  calls: GeminiFunctionCall[];
  usage: Record<string, unknown> | null;
}

function transient(status: number, message: string): boolean {
  const normalized = message.toLowerCase();
  return status === 429 || status >= 500 || /overload|unavailable|temporar|high demand/.test(normalized);
}

async function callToolTurn(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  declarations: GeminiFunctionDeclaration[];
  temperature: number;
  maxOutputTokens: number;
}): Promise<Omit<ToolTurnResult, "model">> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.instruction }] },
          contents: args.contents,
          tools: [{ functionDeclarations: args.declarations }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: {
            temperature: args.temperature,
            maxOutputTokens: args.maxOutputTokens,
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    let payload: GeminiPayload = {};
    try {
      payload = raw ? (JSON.parse(raw) as GeminiPayload) : {};
    } catch {
      throw new Error("Gemini devolvió una respuesta de herramientas inválida.");
    }

    if (!response.ok) {
      const error = new Error(payload.error?.message || `Gemini respondió HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const candidate = payload.candidates?.[0];
    const content = candidate?.content;
    if (!content?.parts?.length) {
      throw new Error(candidate?.finishReason ? `Gemini terminó sin respuesta (${candidate.finishReason}).` : "Gemini respondió sin contenido.");
    }

    const calls = content.parts
      .map((part) => part.functionCall)
      .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
      .map((call) => ({ id: call.id, name: call.name as string, args: call.args ?? {} }));
    const text = content.parts.map((part) => part.text ?? "").join("").trim();

    return { content: { role: content.role || "model", parts: content.parts }, text, calls, usage: payload.usageMetadata ?? null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`El modelo ${args.model} tardó demasiado en decidir las herramientas.`) as Error & { status?: number };
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateToolTurnWithFallback(args: {
  apiKey: string;
  selectedModel: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  declarations: GeminiFunctionDeclaration[];
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<ToolTurnResult> {
  const fallback = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError: unknown = new Error("Gemini no respondió.");

  for (const model of models) {
    try {
      const result = await callToolTurn({
        ...args,
        model,
        temperature: args.temperature ?? 0.2,
        maxOutputTokens: args.maxOutputTokens ?? 4096,
      });
      return { ...result, model };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as Error & { status?: number }).status ?? 500;
      if (!transient(status, message)) throw error;
    }
  }

  throw lastError;
}

function safeToolResponse(result: unknown): Record<string, unknown> {
  let raw: string;
  try {
    raw = JSON.stringify(result ?? null);
  } catch {
    return { ok: false, error: "La herramienta devolvió un resultado no serializable." };
  }
  if (raw.length <= 60_000) return { ok: true, result: result ?? null };
  return { ok: true, truncated: true, resultPreview: raw.slice(0, 60_000) };
}

export interface ToolCallAuditEvent {
  routed: RoutedTool;
  arguments: Record<string, unknown>;
  status: "executed" | "failed" | "pending_confirmation";
  result?: unknown;
  error?: string;
  pendingAction?: PendingToolAction;
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

function callFingerprint(call: GeminiFunctionCall, args: Record<string, unknown>): string {
  return `${call.name}:${canonicalJson(args)}`;
}

function functionResponsePart(call: GeminiFunctionCall, response: Record<string, unknown>): GeminiPart {
  return {
    functionResponse: {
      name: call.name,
      ...(call.id ? { id: call.id } : {}),
      response,
    },
  };
}

/** Executes Gemini's real function-calling loop. Only the gate is allowed to
 * invoke tools: reads pass immediately, while every non-read call returns a
 * persisted proposal instead of executing. */
export async function runGeminiToolLoop(args: {
  apiKey: string;
  selectedModel: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  router: ToolRouter;
  gate: ToolConfirmationGate;
  temperature?: number;
  maxOutputTokens?: number;
  maxSteps?: number;
  onToolCall?: (event: ToolCallAuditEvent) => Promise<void> | void;
}): Promise<GeminiToolLoopResult> {
  const workingContents = args.contents.slice();
  const traces: ToolCallTrace[] = [];
  const declarations = args.router.declarations();
  const maxSteps = args.maxSteps ?? 8;
  const completedReadCalls = new Set<string>();
  let activeModel = args.selectedModel;
  let lastUsage: Record<string, unknown> | null = null;

  async function audit(event: ToolCallAuditEvent) {
    try {
      await args.onToolCall?.(event);
    } catch (error) {
      // Observability cannot change whether an already-authorized read ran or
      // convert an executed tool into a false failure response for Gemini.
      console.error("CLOUVA AI tool audit failed", error);
    }
  }

  for (let step = 0; step < maxSteps; step += 1) {
    const turn = await generateToolTurnWithFallback({
      apiKey: args.apiKey,
      selectedModel: activeModel,
      instruction: args.instruction,
      contents: workingContents,
      declarations,
      temperature: args.temperature,
      maxOutputTokens: args.maxOutputTokens,
    });
    activeModel = turn.model;
    lastUsage = turn.usage;
    workingContents.push(turn.content as unknown as Record<string, unknown>);

    if (!turn.calls.length) {
      if (!turn.text) throw new Error("Gemini terminó el ciclo de herramientas sin una respuesta final.");
      return {
        text: turn.text,
        model: activeModel,
        pendingAction: null,
        traces,
        usage: lastUsage,
        continuationContents: workingContents.slice(0, -1),
        limitReached: false,
      };
    }

    const responseParts: GeminiPart[] = [];
    for (const call of turn.calls) {
      const routed = args.router.resolve(call.name);
      if (!routed) {
        const error = `Gemini pidió una herramienta desconocida: ${call.name}.`;
        responseParts.push(functionResponsePart(call, { ok: false, error }));
        continue;
      }

      try {
        const normalized = args.router.normalizeArguments(routed, call.args);
        const fingerprint = callFingerprint(call, normalized);
        if (routed.definition.risk === "read" && completedReadCalls.has(fingerprint)) {
          const error = "Esta lectura ya se ejecutó con los mismos argumentos. Usá el resultado anterior y avanzá a la respuesta o a una única propuesta de escritura.";
          traces.push({
            target: routed.executor.target,
            tool: routed.definition.name,
            risk: routed.definition.risk,
            status: "failed",
            error,
          });
          await audit({ routed, arguments: normalized, status: "failed", error });
          responseParts.push(functionResponsePart(call, { ok: false, duplicate: true, error }));
          continue;
        }

        const decision = await args.gate.evaluate(routed, normalized);
        if (decision.kind === "confirmation_required") {
          traces.push({
            target: routed.executor.target,
            tool: routed.definition.name,
            risk: routed.definition.risk,
            status: "confirmation_required",
          });
          await audit({
            routed,
            arguments: normalized,
            status: "pending_confirmation",
            pendingAction: decision.action,
          });
          const prefix = turn.text ? `${turn.text}\n\n` : "";
          return {
            text: `${prefix}${decision.action.summary}\n\nRevisá la propuesta antes de decidir; todavía no se ejecutó ningún cambio.`,
            model: activeModel,
            pendingAction: decision.action,
            traces,
            usage: lastUsage,
            continuationContents: workingContents,
            limitReached: false,
          };
        }

        if (routed.definition.risk === "read") completedReadCalls.add(fingerprint);

        traces.push({
          target: routed.executor.target,
          tool: routed.definition.name,
          risk: routed.definition.risk,
          status: "executed",
        });
        await audit({ routed, arguments: normalized, status: "executed", result: decision.result });
        responseParts.push(functionResponsePart(call, safeToolResponse(decision.result)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        traces.push({
          target: routed.executor.target,
          tool: routed.definition.name,
          risk: routed.definition.risk,
          status: "failed",
          error: message,
        });
        const normalized = (() => {
          try {
            return args.router.normalizeArguments(routed, call.args);
          } catch {
            return {};
          }
        })();
        await audit({ routed, arguments: normalized, status: "failed", error: message });
        responseParts.push(functionResponsePart(call, { ok: false, error: message }));
      }
    }

    // Gemini expects functionResponse parts in a user turn. A synthetic
    // `function` role can make the model ignore results and repeat calls.
    workingContents.push({ role: "user", parts: responseParts });
  }

  return {
    text: `Revisé ${traces.length} resultado${traces.length === 1 ? "" : "s"} de herramientas, pero el ciclo alcanzó su límite seguro antes de preparar una acción. No se ejecutó ni se propuso ninguna escritura.`,
    model: activeModel,
    pendingAction: null,
    traces,
    usage: lastUsage,
    continuationContents: workingContents,
    limitReached: true,
  };
}
