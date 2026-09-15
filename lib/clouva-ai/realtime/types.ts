import type { ToolFunctionDeclaration } from "../tool-router";

export type RealtimeProviderId = "gemini" | "clouva";

export type RealtimeSessionRequest = {
  systemInstruction: string;
  tools: ToolFunctionDeclaration[];
};

export type RealtimeSession = {
  provider: RealtimeProviderId;
  token: string;
  model: string;
  expiresAt: string;
  transport: "gemini-live" | "clouva-realtime";
};

export interface RealtimeProvider {
  readonly id: RealtimeProviderId;
  createSession(request: RealtimeSessionRequest): Promise<RealtimeSession>;
}
