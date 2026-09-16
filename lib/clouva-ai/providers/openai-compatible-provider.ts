import type { ToolFunctionDeclaration } from "../tool-router";
import { classifyProviderError, ProviderError } from "./errors";
import type { ProviderConfig } from "./config";
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

type OpenAIToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
};

type OpenAIResponse = {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown>;
  error?: { message?: string };
};

function schema(declaration: ToolFunctionDeclaration) {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(declaration.parameters.properties).map(([name, value]) => [name, {
        type: value.type.toLowerCase(),
        description: value.description,
      }]),
    ),
    required: declaration.parameters.required ?? [],
    additionalProperties: false,
  };
}

function mediaPart(part: Exclude<ClouvaAIContentPart, { type: "text" }>): Record<string, unknown> {
  const dataUrl = `data:${part.mimeType};base64,${part.dataBase64}`;
  if (part.mimeType.startsWith("image/")) {
    return { type: "image_url", image_url: { url: dataUrl } };
  }
  if (part.mimeType.startsWith("audio/")) {
    const format = part.mimeType.split("/")[1]?.replace("mpeg", "mp3") || "wav";
    return { type: "input_audio", input_audio: { data: part.dataBase64, format } };
  }
  return {
    type: "file",
    file: {
      filename: part.name || "attachment",
      file_data: dataUrl,
    },
  };
}

function messageContent(parts: ClouvaAIContentPart[]) {
  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => part.type === "text" ? part.text : "").join("");
  }
  return parts.map((part) => part.type === "text" ? { type: "text", text: part.text } : mediaPart(part));
}

function serializeMessages(instruction: string, items: ProviderConversationItem[]) {
  const messages: Array<Record<string, unknown>> = [{ role: "system", content: instruction }];
  for (const item of items) {
    if (item.kind === "message") {
      messages.push({ role: item.message.role, content: messageContent(item.message.content) });
      continue;
    }
    if (item.kind === "assistant_tool_call") {
      messages.push({
        role: "assistant",
        content: item.text || null,
        tool_calls: item.calls.map((call, index) => ({
          id: call.id || `call_${index}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      });
      continue;
    }
    messages.push({
      role: "tool",
      tool_call_id: item.result.call.id || item.result.call.name,
      name: item.result.call.name,
      content: JSON.stringify(item.result.response),
    });
  }
  return messages;
}

function parseArguments(value: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseCalls(calls: OpenAIToolCall[] | undefined): NormalizedToolCall[] {
  return (calls ?? [])
    .filter((call) => Boolean(call.function?.name))
    .map((call) => ({
      id: call.id,
      name: call.function?.name as string,
      arguments: parseArguments(call.function?.arguments),
    }));
}

async function fetchWithTimeout(provider: string, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw classifyProviderError(provider, 504, "Inference request timed out", error);
    }
    throw classifyProviderError(provider, 503, error instanceof Error ? error.message : String(error), error);
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAICompatibleProvider implements ClouvaAIProvider {
  readonly id = "clouva" as const;
  readonly capabilities = { text: true, streaming: true, tools: true, multimodal: true, realtime: false };
  readonly defaultModel: string;
  readonly fallbackModel: string | null;

  constructor(private readonly config: ProviderConfig) {
    this.defaultModel = config.model;
    this.fallbackModel = config.fallbackModel;
  }

  private url(path: string) {
    if (!this.config.baseUrl) throw new ProviderError({ code: "PROVIDER_UNAVAILABLE", provider: this.id, message: "CLOUVA_AI_BASE_URL no está configurado.", retryable: false });
    return `${this.config.baseUrl}${path}`;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
  }

  private body(args: ProviderGenerateArgs, tools?: ToolFunctionDeclaration[], stream = false) {
    return {
      model: args.model,
      messages: serializeMessages(args.instruction, args.contents),
      temperature: args.temperature ?? 0.45,
      max_tokens: args.maxOutputTokens ?? 4096,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(tools?.length ? {
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: schema(tool) },
        })),
        tool_choice: "auto",
      } : {}),
    };
  }

  private async completion(args: ProviderGenerateArgs, tools?: ToolFunctionDeclaration[]): Promise<OpenAIResponse> {
    const response = await fetchWithTimeout(
      this.id,
      this.url("/chat/completions"),
      { method: "POST", headers: this.headers(), body: JSON.stringify(this.body(args, tools)) },
      tools?.length ? 25_000 : 18_000,
    );
    const raw = await response.text();
    let payload: OpenAIResponse;
    try { payload = raw ? JSON.parse(raw) as OpenAIResponse : {}; }
    catch (error) { throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El inference service de CLOUVA devolvió JSON inválido.", cause: error }); }
    if (!response.ok) throw classifyProviderError(this.id, response.status, payload.error?.message ?? raw);
    return payload;
  }

  async generate(args: ProviderGenerateArgs): Promise<ProviderGenerateResult> {
    const payload = await this.completion(args);
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El inference service de CLOUVA respondió sin texto." });
    return {
      text,
      usage: payload.usage ?? null,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
    };
  }

  async *stream(args: ProviderGenerateArgs): AsyncGenerator<string, Omit<ProviderGenerateResult, "text">, void> {
    const response = await fetchWithTimeout(
      this.id,
      this.url("/chat/completions"),
      { method: "POST", headers: this.headers(), body: JSON.stringify(this.body(args, undefined, true)) },
      25_000,
    );
    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      let message = raw;
      try { message = (JSON.parse(raw) as OpenAIResponse).error?.message ?? raw; } catch { /* keep raw */ }
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
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payloadText = trimmed.slice(5).trim();
          if (!payloadText || payloadText === "[DONE]") continue;
          let payload: OpenAIResponse;
          try { payload = JSON.parse(payloadText) as OpenAIResponse; } catch { continue; }
          if (payload.usage) usage = payload.usage;
          finishReason = payload.choices?.[0]?.finish_reason ?? finishReason;
          const text = payload.choices?.[0]?.delta?.content ?? "";
          if (text) {
            sawText = true;
            yield text;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!sawText) throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El inference service de CLOUVA terminó el stream sin texto." });
    return { usage, finishReason };
  }

  async toolTurn(args: ProviderToolTurnArgs): Promise<ProviderToolTurnResult> {
    const payload = await this.completion(args, args.declarations);
    const message = payload.choices?.[0]?.message;
    const calls = parseCalls(message?.tool_calls);
    const text = message?.content?.trim() ?? "";
    if (!text && !calls.length) throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El inference service de CLOUVA terminó el turno de tools sin contenido." });
    return {
      text,
      calls,
      usage: payload.usage ?? null,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const response = await fetchWithTimeout(this.id, this.url("/models"), { headers: this.headers() }, 10_000);
    const raw = await response.text();
    let payload: { data?: Array<{ id?: string; name?: string; description?: string }>; error?: { message?: string } };
    try { payload = raw ? JSON.parse(raw) : {}; }
    catch (error) { throw new ProviderError({ code: "PROVIDER_BAD_RESPONSE", provider: this.id, message: "El inference service de CLOUVA devolvió un catálogo inválido.", cause: error }); }
    if (!response.ok) throw classifyProviderError(this.id, response.status, payload.error?.message ?? raw);
    const configured = new Set([this.defaultModel, this.fallbackModel].filter(Boolean));
    const models = (payload.data ?? [])
      .filter((item): item is { id: string; name?: string; description?: string } => Boolean(item.id))
      .map((item) => ({
        id: item.id,
        name: item.name ?? item.id,
        description: item.description ?? "Modelo servido por CLOUVA AI.",
        inputTokenLimit: null,
        outputTokenLimit: null,
      }));
    if (!models.length) {
      return Array.from(configured).map((id) => ({ id: id as string, name: id as string, description: "Modelo configurado en CLOUVA AI.", inputTokenLimit: null, outputTokenLimit: null }));
    }
    return models;
  }
}
