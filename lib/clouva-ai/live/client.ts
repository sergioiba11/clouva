"use client";

import {
  GoogleGenAI,
  Modality,
  type FunctionCall,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import type { TrebolContextPatch, TrebolRuntimeContext } from "../agent/types";
import { liveContextUpdateText } from "./context-sync";
import { TrebolLiveError, type TrebolLiveErrorCode } from "./errors";
import { logTrebolEvent } from "../telemetry";

type TokenResponse = {
  token: string;
  model: string;
  conversationId: string;
  runId: string;
  expiresAt: string;
};

type ToolResponse = {
  ok?: boolean;
  kind?: "result" | "pending_action";
  result?: unknown;
  message?: string;
  pendingAction?: unknown;
  error?: string;
  code?: TrebolLiveErrorCode;
};

export type TrebolLiveClientCallbacks = {
  onConnected?: (identity: { conversationId: string; runId: string }) => void;
  onClosed?: (reason: string) => void;
  onError?: (error: Error) => void;
  onAudio?: (base64Pcm: string) => void;
  onInterrupted?: () => void;
  onTranscript?: (role: "user" | "assistant", text: string, final: boolean) => void;
  onTurnComplete?: () => void;
  onPendingAction?: (action: unknown) => void;
  onReconnecting?: (attempt: number) => void;
  onResumptionHandle?: (handle: string) => void;
};

export type TrebolLiveClientOptions = {
  accessToken: string;
  conversationId?: string | null;
  studioId?: string | null;
  getContext: () => TrebolRuntimeContext;
  callbacks?: TrebolLiveClientCallbacks;
};

function appendTranscript(current: string, incoming: string): string {
  const text = incoming.trim();
  if (!text) return current;
  if (!current || text.startsWith(current)) return text;
  if (current.endsWith(text)) return current;
  return `${current} ${text}`.trim();
}

async function responseJson<T>(response: Response, fallbackCode: TrebolLiveErrorCode): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string; code?: TrebolLiveErrorCode };
  if (!response.ok) throw new TrebolLiveError(payload.code ?? fallbackCode, payload.error || `Trébol Live respondió HTTP ${response.status}.`, response.status);
  return payload;
}

export class TrebolLiveClient {
  private session: Session | null = null;
  private identity: TokenResponse | null = null;
  private resumptionHandle: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private reconnectExhausted = false;
  private closing = false;
  private muted = false;
  private inputTranscript = "";
  private outputTranscript = "";
  private toolQueue = Promise.resolve();
  private pendingTranscripts: Array<{ messageId: string; role: "user" | "assistant"; content: string }> = [];
  private transcriptDrain = Promise.resolve();
  private endRunSent = false;

  constructor(private readonly options: TrebolLiveClientOptions) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.options.accessToken}`,
    };
  }

  async connect() {
    this.closing = false;
    this.reconnectExhausted = false;
    this.endRunSent = false;
    logTrebolEvent("TREBOL_LIVE_CONNECTING");
    const response = await fetch("/api/clouva-ai/live/token", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        conversationId: this.options.conversationId,
        studioId: this.options.studioId,
        currentContext: this.options.getContext(),
      }),
      cache: "no-store",
    });
    this.identity = await responseJson<TokenResponse>(response, "LIVE_TOKEN_ERROR");
    await this.connectSession();
    return { conversationId: this.identity.conversationId, runId: this.identity.runId };
  }

  private async connectSession() {
    if (!this.identity) throw new Error("Trébol Live no tiene una identidad de sesión.");
    const ai = new GoogleGenAI({
      apiKey: this.identity.token,
      httpOptions: { apiVersion: "v1beta" },
    });
    this.session = await ai.live.connect({
      model: this.identity.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
      },
      callbacks: {
        onopen: () => {
          logTrebolEvent("TREBOL_LIVE_CONNECTED");
          if (this.identity) this.options.callbacks?.onConnected?.(this.identity);
        },
        onmessage: (message) => this.handleMessage(message),
        onerror: (event) => this.options.callbacks?.onError?.(new TrebolLiveError("LIVE_CONNECTION_FAILED", event.message || "Falló la conexión con Gemini Live.")),
        onclose: (event) => {
          this.session = null;
          if (!this.closing && this.resumptionHandle) {
            this.scheduleReconnect();
          } else {
            void this.persistEnd();
            this.options.callbacks?.onClosed?.(event.reason || "Conexión Live cerrada.");
          }
        },
      },
    });
  }

  private handleMessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      // A fully configured session proves that the token/handle worked.
      // Reset here (not merely on socket open) so an invalid resume loop
      // still reaches the bounded retry limit.
      this.reconnectAttempt = 0;
      this.reconnectExhausted = false;
    }
    const content = message.serverContent;
    if (content?.interrupted) {
      logTrebolEvent("TREBOL_LIVE_INTERRUPTED");
      this.options.callbacks?.onInterrupted?.();
    }

    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.options.callbacks?.onAudio?.(part.inlineData.data);
    }

    if (content?.inputTranscription?.text) {
      this.inputTranscript = appendTranscript(this.inputTranscript, content.inputTranscription.text);
      this.options.callbacks?.onTranscript?.("user", this.inputTranscript, Boolean(content.inputTranscription.finished));
      if (content.inputTranscription.finished) void this.flushTranscript("user");
    }
    if (content?.outputTranscription?.text) {
      this.outputTranscript = appendTranscript(this.outputTranscript, content.outputTranscription.text);
      this.options.callbacks?.onTranscript?.("assistant", this.outputTranscript, Boolean(content.outputTranscription.finished));
      if (content.outputTranscription.finished) void this.flushTranscript("assistant");
    }
    if (content?.turnComplete) {
      if (this.inputTranscript) void this.flushTranscript("user");
      if (this.outputTranscript) void this.flushTranscript("assistant");
      this.options.callbacks?.onTurnComplete?.();
    }

    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      this.resumptionHandle = update.newHandle;
      this.options.callbacks?.onResumptionHandle?.(update.newHandle);
    }
    if (message.goAway && this.resumptionHandle) {
      const previousSession = this.session;
      this.session = null;
      this.scheduleReconnect();
      previousSession?.close();
    }
    if (message.toolCall?.functionCalls?.length) {
      this.toolQueue = this.toolQueue
        .then(() => this.handleToolCalls(message.toolCall?.functionCalls ?? []))
        .catch((error) => this.options.callbacks?.onError?.(error instanceof Error ? error : new Error(String(error))));
    }
  }

  private async handleToolCalls(calls: FunctionCall[]) {
    if (!this.session || !this.identity) return;
    for (const call of calls) {
      if (!call.name) continue;
      let payload: ToolResponse;
      try {
        const response = await fetch("/api/clouva-ai/tools/execute", {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            runId: this.identity.runId,
            conversationId: this.identity.conversationId,
            tool: call.name,
            arguments: call.args ?? {},
            currentContext: this.options.getContext(),
          }),
          cache: "no-store",
        });
        payload = await responseJson<ToolResponse>(response, response.status === 403 ? "TOOL_PERMISSION_DENIED" : "TOOL_FAILED");
        if (payload.kind === "pending_action" && payload.pendingAction) {
          this.options.callbacks?.onPendingAction?.(payload.pendingAction);
        }
      } catch (error) {
        payload = { ok: false, error: error instanceof Error ? error.message : "La herramienta falló." };
      }

      this.session?.sendToolResponse({
        functionResponses: {
          id: call.id,
          name: call.name,
          response: payload.ok === false ? { error: payload.error } : { output: payload },
        },
      });
    }
  }

  private scheduleReconnect() {
    if (this.closing || this.reconnectTimer !== null || this.reconnectExhausted) return;
    if (this.reconnectAttempt >= 3) {
      this.reconnectExhausted = true;
      const error = new TrebolLiveError("LIVE_SESSION_EXPIRED", "No se pudo retomar la sesión Live después de 3 intentos.");
      this.options.callbacks?.onError?.(error);
      void this.persistEnd();
      this.options.callbacks?.onClosed?.(error.message);
      return;
    }
    this.reconnectAttempt += 1;
    logTrebolEvent("TREBOL_LIVE_RECONNECTING", { attempt: this.reconnectAttempt });
    this.options.callbacks?.onReconnecting?.(this.reconnectAttempt);
    const delay = Math.min(4_000, 500 * 2 ** (this.reconnectAttempt - 1));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectSession().catch((error) => {
        this.options.callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.scheduleReconnect();
      });
    }, delay);
  }

  sendAudio(base64Pcm: string) {
    if (!this.session || this.muted || !base64Pcm) return;
    this.session.sendRealtimeInput({ audio: { data: base64Pcm, mimeType: "audio/pcm;rate=16000" } });
  }

  sendText(text: string) {
    const normalized = text.trim().slice(0, 12_000);
    if (this.session && normalized) this.session.sendRealtimeInput({ text: normalized });
  }

  syncContext(patch: TrebolContextPatch) {
    const update = liveContextUpdateText(patch);
    if (update) {
      logTrebolEvent("TREBOL_CONTEXT_UPDATED", { fields: Object.keys(patch).length });
      this.sendText(update);
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  private async flushTranscript(role: "user" | "assistant") {
    if (!this.identity) return;
    const content = role === "user" ? this.inputTranscript : this.outputTranscript;
    if (!content) return;
    if (role === "user") this.inputTranscript = "";
    else this.outputTranscript = "";
    this.pendingTranscripts.push({ messageId: crypto.randomUUID(), role, content });
    this.transcriptDrain = this.transcriptDrain.then(() => this.drainTranscripts());
    await this.transcriptDrain;
  }

  private async drainTranscripts() {
    const identity = this.identity;
    if (!identity) return;
    while (this.pendingTranscripts.length) {
      const transcript = this.pendingTranscripts[0];
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch("/api/clouva-ai/live/turn", {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify({
              action: "transcript",
              runId: identity.runId,
              conversationId: identity.conversationId,
                messageId: transcript.messageId,
                role: transcript.role,
                content: transcript.content,
            }),
            cache: "no-store",
          });
          await responseJson(response, "LIVE_CONNECTION_FAILED");
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError) {
        this.options.callbacks?.onError?.(lastError instanceof Error ? lastError : new Error(String(lastError)));
        return;
      }
      this.pendingTranscripts.shift();
    }
  }

  async close() {
    this.closing = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    await Promise.all([this.flushTranscript("user"), this.flushTranscript("assistant")]);
    this.session?.sendRealtimeInput({ audioStreamEnd: true });
    this.session?.close();
    this.session = null;
    await this.persistEnd();
  }

  private async persistEnd() {
    if (!this.identity || this.endRunSent) return;
    this.endRunSent = true;
    logTrebolEvent("TREBOL_LIVE_ENDED");
    await fetch("/api/clouva-ai/live/turn", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          action: "end",
          runId: this.identity.runId,
          conversationId: this.identity.conversationId,
        }),
        cache: "no-store",
    }).catch(() => undefined);
  }
}
