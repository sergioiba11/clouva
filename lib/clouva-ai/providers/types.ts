import type { ToolFunctionDeclaration } from "../tool-router";

export type ClouvaAIProviderId = "clouva" | "gemini";

export type ClouvaAIContentPart =
  | { type: "text"; text: string }
  | {
      type: "media";
      mimeType: string;
      dataBase64: string;
      name?: string;
      kind?: "image" | "audio" | "file" | "preview";
    };

export type ClouvaAIMessage = {
  role: "user" | "assistant";
  content: ClouvaAIContentPart[];
};

export type NormalizedToolCall = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type NormalizedToolResult = {
  call: NormalizedToolCall;
  response: Record<string, unknown>;
};

export type ProviderConversationItem =
  | { kind: "message"; message: ClouvaAIMessage }
  | { kind: "assistant_tool_call"; text: string; calls: NormalizedToolCall[] }
  | { kind: "tool_result"; result: NormalizedToolResult };

export type ProviderCapabilities = {
  text: boolean;
  streaming: boolean;
  tools: boolean;
  multimodal: boolean;
  realtime: boolean;
};

export type ProviderModel = {
  id: string;
  name: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
};

export type ProviderUsage = Record<string, unknown> | null;

export type ProviderGenerateArgs = {
  model: string;
  instruction: string;
  contents: ProviderConversationItem[];
  temperature?: number;
  maxOutputTokens?: number;
};

export type ProviderToolTurnArgs = ProviderGenerateArgs & {
  declarations: ToolFunctionDeclaration[];
};

export type ProviderGenerateResult = {
  text: string;
  usage: ProviderUsage;
  finishReason?: string | null;
};

export type ProviderToolTurnResult = ProviderGenerateResult & {
  calls: NormalizedToolCall[];
};

export interface ClouvaAIProvider {
  readonly id: ClouvaAIProviderId;
  readonly capabilities: ProviderCapabilities;
  readonly defaultModel: string;
  readonly fallbackModel: string | null;
  generate(args: ProviderGenerateArgs): Promise<ProviderGenerateResult>;
  stream(args: ProviderGenerateArgs): AsyncGenerator<string, Omit<ProviderGenerateResult, "text">, void>;
  toolTurn(args: ProviderToolTurnArgs): Promise<ProviderToolTurnResult>;
  listModels(): Promise<ProviderModel[]>;
}

export type RoutedProviderResult<T> = T & {
  provider: ClouvaAIProviderId;
  model: string;
  primaryProvider: ClouvaAIProviderId;
  fallbackUsed: boolean;
};
