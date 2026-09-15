import type { ToolFunctionDeclaration } from "../tool-router";
import { classifyProviderError, ProviderError } from "./errors";
import type {
  ClouvaAIContentPart,
  ClouvaAIProvider,
  NormalizedToolCall,
  ProviderConversationItem,
  ProviderGenerateArgs,
  ProviderGenerateResult,
  ProviderModel,
  ProviderToolTurnArgs,
  ProviderToolTurnResult,
} from "./types";
import type { ProviderConfig } from "./config";

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
  candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

function contentPart(part: ClouvaAIContentPart): GeminiPart {
  if (part.type === "text") return { text: part.text };
  return { inlineData: { mimeType: part.mimeType, data: part.dataBase64 } };
}

function serializeContents(items: ProviderConversationItem[]): GeminiContent[] {
  return items.map((item): GeminiContent => {
    if (item.kind === "message") {
      return {
        role: item.message.role === "assistant" ? "model" : "user",
        parts: item.message.content.map(contentPart),
      };
    }
    if (item.kind === "assistant_tool_call") {
      const parts: GeminiPart[] = [];
      if (item.text) parts.push({ text: item.text });
      for (const call of item.calls) {
        parts.push({ functionCall: { ...(call.id ? { id: call.id } : {}), name: call.name, args: call.arguments } });
      }
      return { role: "model", parts };
    }
    return {
      role: "user",
      parts: [{
        functionResponse: {
          ...(item.result.call.id ? { id: item.result.call.id } : {}),
          name: item.result.call.name,
          response: item.result.response,
        },
      }],
    };
  });
}

function functionDeclarations(declarations: ToolFunctionDeclaration[]) {
  return declarations.map((item) => ({
    name: item.name,
    description: item.description,
    parameters: item.parameters,
  }));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw classifyProviderError("gemini", 504, "Gemini timed out", error);
    }
    throw classifyProviderError("gemini", 503, error instanceof Error ? error.message : String(error), error);
  } finally {
    clearTimeout(timeout);
  }
}

function requestBody(args: ProviderGenerateArgs, declarations?: ToolFunctionDeclaration[]) {
  return {
    systemInstruction: { parts: [{ text: args.instruction }] },
    contents: serializeContents(args.contents),
    ...(declarations?.length
      ? {
          tools: [{ functionDeclarations: functionDeclarations(declarations) }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        }
      : {}),
    generationConfig: {
      temperature: args.temperature ?? 0.45,
      maxOutputTokens: args.maxOutputTokens ?? 4096,
    },
  };
}

function parseText(payload: GeminiPayload) {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

function parseCalls(payload: GeminiPayload): NormalizedToolCall[] {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.functionCall)
    .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
    .map((call) => ({ id: call.id, name: call.name as string, arguments: call.args ?? {} }));
}

export class GeminiProvider implements ClouvaAIProvider {
  readonly id = "gemini" as const;
  readonly capabilities = { text: true, streaming: true, tools: true, multimodal: true, realtime: true };
  readonly defaultModel: string;
  readonly fallbackModel: string | null;

  constructor(private readonly config: ProviderConfig) {
    this.defaultModel = config.model;
    this.fallbackModel = config.fallbackModel;
  }

  private endpoint(model: string, method: "generateContent" | "streamGenerateContent") {
    const base = this.config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    return `${base}/models/${encodeURIComponent(model)}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`;
  }

  private headers() {
    if (!this.config.apiKey) {
      throw new ProviderError({
        code: "PROVIDER_AUTH_ERROR",
        provider: this.id,
        status: 503,
        retryable: false,
        message: "El provider Gemini no está configurado.",
      });
    }
    return { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey };
  }

  async generate(args: ProviderGenerateArgs): Promise<ProviderGenerateResult> {
    const response = await fetchWithTimeout(
      this.endpoint(args.model, "generateContent"),
      { method: "POST", headers: this.headers(), body: JSON.stringify(requestBody(args)) },
      18_000,
    );
    const raw = await response.text();
    let payload: GeminiPayload;
    try {
      payload = raw ? JSON.parse(raw) as GeminiPayload : {};
    } catch (error) {
      throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "Gemini devolvió JSON inválido.", cause: error });
    }
    if (!response.ok) throw classifyProviderError(this.id, response.status, payload.error?.message ?? raw);
    const text = parseText(payload);
    if (!text) {
      throw new ProviderError({
        code: "PROVIDER_BAD_RESPONSE",
        provider: this.id,
        message: payload.candidates?.[0]?.finishReason
          ? `El modelo terminó sin texto (${payload.candidates[0].finishReason}).`
          : "El proveedor terminó sin texto.",
      });
    }
    return {
      text,
      usage: payload.usageMetadata ?? null,
      finishReason: payload.candidates?.[0]?.finishReason ?? null,
    };
  }

  async *stream(args: ProviderGenerateArgs): AsyncGenerator<string, Omit<ProviderGenerateResult, "text">, void> {
    const response = await fetchWithTimeout(
      this.endpoint(args.model, "streamGenerateContent"),
      { method: "POST", headers: this.headers(), body: JSON.stringify(requestBody(args)) },
      25_000,
    );
    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      let message = raw;
      try { message = (JSON.parse(raw) as GeminiPayload).error?.message ?? raw; } catch { /* keep raw */ }
      throw classifyProviderError(this.id, response.status, message);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: Record<string, unknown> | null = null;
    let finishReason: string | null = null;
    let sawText = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const body = trimmed.slice(5).trim();
          if (!body) continue;
          let payload: GeminiPayload;
          try { payload = JSON.parse(body) as GeminiPayload; } catch { continue; }
          if (payload.usageMetadata) usage = payload.usageMetadata;
          finishReason = payload.candidates?.[0]?.finishReason ?? finishReason;
          const text = parseText(payload);
          if (text) {
            sawText = true;
            yield text;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!sawText) throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El proveedor terminó el stream sin texto." });
    return { usage, finishReason };
  }

  async toolTurn(args: ProviderToolTurnArgs): Promise<ProviderToolTurnResult> {
    const response = await fetchWithTimeout(
      this.endpoint(args.model, "generateContent"),
      { method: "POST", headers: this.headers(), body: JSON.stringify(requestBody(args, args.declarations)) },
      25_000,
    );
    const raw = await response.text();
    let payload: GeminiPayload;
    try { payload = raw ? JSON.parse(raw) as GeminiPayload : {}; }
    catch (error) { throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "Gemini devolvió una respuesta de herramientas inválida.", cause: error }); }
    if (!response.ok) throw classifyProviderError(this.id, response.status, payload.error?.message ?? raw);
    const calls = parseCalls(payload);
    const text = parseText(payload);
    if (!calls.length && !text) {
      throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El proveedor terminó el ciclo de herramientas sin contenido." });
    }
    return {
      text,
      calls,
      usage: payload.usageMetadata ?? null,
      finishReason: payload.candidates?.[0]?.finishReason ?? null,
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const base = this.config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const response = await fetchWithTimeout(`${base}/models?pageSize=1000`, { headers: this.headers() }, 12_000);
    const raw = await response.text();
    let payload: { models?: Array<{ name?: string; displayName?: string; description?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number; outputTokenLimit?: number }>; error?: { message?: string } };
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch (error) { throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "Gemini devolvió un catálogo inválido.", cause: error }); }
    if (!response.ok) throw classifyProviderError(this.id, response.status, payload.error?.message ?? raw);
    const preferred = new Set([this.defaultModel, this.fallbackModel].filter(Boolean));
    return (payload.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => ({
        id: (model.name ?? "").replace(/^models\//, ""),
        name: model.displayName ?? (model.name ?? "").replace(/^models\//, ""),
        description: model.description ?? "Modelo Gemini compatible con ClouAI.",
        inputTokenLimit: model.inputTokenLimit ?? null,
        outputTokenLimit: model.outputTokenLimit ?? null,
      }))
      .filter((model) => preferred.size === 0 || preferred.has(model.id));
  }
}
