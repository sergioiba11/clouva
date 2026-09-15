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
import type { TrebolLiveEndReason, TrebolLiveTranscriptFinishReason } from "./protocol";
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

type PendingTranscript = {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  finishReason: TrebolLiveTranscriptFinishReason;
};

type LivePhase = "idle" | "token" | "socket_connecting" | "setup" | "ready" | "streaming" | "closing" | "closed";

type LiveCloseDiagnostics = {
  timestamp: string;
  sessionId: string | null;
  readyState: number | null;
  closeCode: number | null;
  closeReason: string | null;
  wasClean: boolean | null;
  socketLifetimeMs: number | null;
  lastSentEvent: string | null;
  lastReceivedEvent: string | null;
  phase: LivePhase;
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
  private pendingTranscripts: PendingTranscript[] = [];
  private transcriptDrain = Promise.resolve();
  private endRunSent = false;
  private modelTurnActive = false;
  private modelTurnInterrupted = false;
  private lastModelTurnCompleted = false;
  private phase: LivePhase = "idle";
  private socketOpenedAtMs: number | null = null;
  private lastSentEvent: string | null = null;
  private lastReceivedEvent: string | null = null;

  constructor(private readonly options: TrebolLiveClientOptions) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.options.accessToken}`,
    };
  }

  private markTurnActivity() {
    if (!this.modelTurnActive) this.modelTurnInterrupted = false;
    this.modelTurnActive = true;
    this.lastModelTurnCompleted = false;
    if (this.phase === "ready") this.phase = "streaming";
  }

  private markSent(event: string) {
    this.lastSentEvent = event;
    if (this.phase === "ready" && event !== "audioStreamEnd") this.phase = "streaming";
  }

  private markReceived(event: string) {
    this.lastReceivedEvent = event;
    if (this.phase === "ready" && event !== "setupComplete") this.phase = "streaming";
  }

  private buildCloseDiagnostics(event?: CloseEvent, fallbackReason?: string): LiveCloseDiagnostics {
    const target = event?.target as { readyState?: unknown } | null;
    const readyState = typeof target?.readyState === "number" ? target.readyState : null;
    return {
      timestamp: new Date().toISOString(),
      sessionId: this.identity?.runId ?? null,
      readyState,
      closeCode: typeof event?.code === "number" ? event.code : null,
      closeReason: (event?.reason || fallbackReason || "").slice(0, 300) || null,
      wasClean: typeof event?.wasClean === "boolean" ? event.wasClean : null,
      socketLifetimeMs: this.socketOpenedAtMs === null ? null : Math.max(0, Date.now() - this.socketOpenedAtMs),
      lastSentEvent: this.lastSentEvent,
      lastReceivedEvent: this.lastReceivedEvent,
      phase: this.phase,
    };
  }

  async connect() {
    this.closing = false;
    this.reconnectExhausted = false;
    this.endRunSent = false;
    this.modelTurnActive = false;
    this.modelTurnInterrupted = false;
    this.lastModelTurnCompleted = false;
    this.phase = "token";
    this.socketOpenedAtMs = null;
    this.lastSentEvent = null;
    this.lastReceivedEvent = null;
    logTrebolEvent("TREBOL_LIVE_CONNECTING", { phase: this.phase });
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
    const identity = this.identity;
    const ai = new GoogleGenAI({
      apiKey: identity.token,
      httpOptions: { apiVersion: "v1beta" },
    });
    this.phase = "socket_connecting";
    const session = await ai.live.connect({
      model: identity.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
      },
      callbacks: {
        onopen: () => {
          this.socketOpenedAtMs = Date.now();
          this.phase = "setup";
          // @google/genai sends the setup frame immediately after the socket-open
          // callback resolves. No realtime audio can be sent yet because
          // this.session is assigned only after ai.live.connect() resolves on
          // Gemini's setupComplete message.
          this.markSent("setup");
          logTrebolEvent("TREBOL_LIVE_CONNECTING", {
            runId: identity.runId,
            conversationId: identity.conversationId,
            phase: this.phase,
          });
        },
        onmessage: (message) => this.handleMessage(message),
        onerror: (event) => {
          this.lastReceivedEvent = "socket_error";
          this.options.callbacks?.onError?.(new TrebolLiveError("LIVE_CONNECTION_FAILED", event.message || "Falló la conexión con Gemini Live."));
        },
        onclose: (event) => {
          const diagnostics = this.buildCloseDiagnostics(event);
          this.phase = "closed";
          this.session = null;
          logTrebolEvent("TREBOL_LIVE_SOCKET_CLOSED", {
            runId: identity.runId,
            conversationId: identity.conversationId,
            closeCode: diagnostics.closeCode,
            wasClean: diagnostics.wasClean,
            socketLifetimeMs: diagnostics.socketLifetimeMs,
            phase: diagnostics.phase,
            lastSentEvent: diagnostics.lastSentEvent,
            lastReceivedEvent: diagnostics.lastReceivedEvent,
          });
          void this.persistDiagnostic(diagnostics);
          if (this.closing) {
            this.options.callbacks?.onClosed?.(diagnostics.closeReason || "Conexión Live cerrada.");
            return;
          }
          if (this.resumptionHandle) {
            this.scheduleReconnect();
            return;
          }
          void this.handleUnexpectedClose(diagnostics);
        },
      },
    });

    // ai.live.connect() resolves only after Gemini sends setupComplete. Keep the
    // Session unavailable until this point so sendAudio/sendText cannot race the
    // handshake.
    this.session = session;
    this.phase = "ready";
    this.lastReceivedEvent = this.lastReceivedEvent ?? "setupComplete";
    logTrebolEvent("TREBOL_LIVE_CONNECTED", {
      runId: identity.runId,
      conversationId: identity.conversationId,
      phase: this.phase,
    });
    this.options.callbacks?.onConnected?.(identity);
  }

  private handleMessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      this.markReceived("setupComplete");
      this.phase = "ready";
      // A fully configured session proves that the token/handle worked.
      // Reset here (not merely on socket open) so an invalid resume loop
      // still reaches the bounded retry limit.
      this.reconnectAttempt = 0;
      this.reconnectExhausted = false;
    }
    const content = message.serverContent;
    const modelParts = content?.modelTurn?.parts ?? [];
    if (modelParts.length) {
      this.markReceived("serverContent.modelTurn");
      this.markTurnActivity();
    }
    for (const part of modelParts) {
      if (part.inlineData?.data) this.options.callbacks?.onAudio?.(part.inlineData.data);
    }

    if (content?.inputTranscription?.text) {
      this.markReceived("serverContent.inputTranscription");
      this.markTurnActivity();
      this.inputTranscript = appendTranscript(this.inputTranscript, content.inputTranscription.text);
      const final = Boolean(content.inputTranscription.finished);
      this.options.callbacks?.onTranscript?.("user", this.inputTranscript, final);
      if (final) void this.flushTranscript("user", "USER_TURN_COMPLETE");
    }

    if (content?.outputTranscription?.text) {
      this.markReceived("serverContent.outputTranscription");
      this.markTurnActivity();
      this.outputTranscript = appendTranscript(this.outputTranscript, content.outputTranscription.text);
      // outputTranscription.finished is a transcription-segment boundary,
      // not the persistence boundary for the model turn. Persist only when
      // Gemini reports interruption or turnComplete.
      this.options.callbacks?.onTranscript?.("assistant", this.outputTranscript, false);
    }

    if (content?.interrupted) {
      this.markReceived("serverContent.interrupted");
      this.markTurnActivity();
      this.modelTurnInterrupted = true;
      this.lastModelTurnCompleted = false;
      logTrebolEvent("TREBOL_LIVE_INTERRUPTED");
      if (this.outputTranscript) void this.flushTranscript("assistant", "MODEL_INTERRUPTED");
      this.options.callbacks?.onInterrupted?.();
    }

    if (content?.turnComplete) {
      this.markReceived("serverContent.turnComplete");
      const wasInterrupted = this.modelTurnInterrupted;
      if (this.inputTranscript) void this.flushTranscript("user", "USER_TURN_COMPLETE");
      if (this.outputTranscript) {
        this.options.callbacks?.onTranscript?.("assistant", this.outputTranscript, true);
        void this.flushTranscript("assistant", wasInterrupted ? "MODEL_INTERRUPTED" : "MODEL_TURN_COMPLETE");
      }
      this.lastModelTurnCompleted = !wasInterrupted;
      this.modelTurnActive = false;
      this.modelTurnInterrupted = false;
      this.phase = "ready";
      this.options.callbacks?.onTurnComplete?.();
    }

    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) {
      this.markReceived("sessionResumptionUpdate");
      this.resumptionHandle = update.newHandle;
      this.options.callbacks?.onResumptionHandle?.(update.newHandle);
    }
    if (message.goAway && this.resumptionHandle) {
      this.markReceived("goAway");
      const previousSession = this.session;
      this.session = null;
      this.scheduleReconnect();
      previousSession?.close();
    }
    if (message.toolCall?.functionCalls?.length) {
      this.markReceived("toolCall");
      this.markTurnActivity();
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

      this.markSent("toolResponse");
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
      void this.finishAfterTransportLoss("RECONNECT_EXHAUSTED", error.message);
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
    this.markSent("realtimeInput.audio");
    this.session.sendRealtimeInput({ audio: { data: base64Pcm, mimeType: "audio/pcm;rate=16000" } });
  }

  sendText(text: string) {
    const normalized = text.trim().slice(0, 12_000);
    if (this.session && normalized) {
      this.markSent("realtimeInput.text");
      this.session.sendRealtimeInput({ text: normalized });
    }
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
    if (muted && this.session) {
      this.markSent("audioStreamEnd");
      this.session.sendRealtimeInput({ audioStreamEnd: true });
    }
  }

  private async flushTranscript(
    role: "user" | "assistant",
    finishReason: TrebolLiveTranscriptFinishReason,
  ) {
    if (!this.identity) return;
    const content = role === "user" ? this.inputTranscript : this.outputTranscript;
    if (!content) return;
    if (role === "user") this.inputTranscript = "";
    else this.outputTranscript = "";
    this.pendingTranscripts.push({
      messageId: crypto.randomUUID(),
      role,
      content,
      finishReason,
    });
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
              finishReason: transcript.finishReason,
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

  private async persistDiagnostic(diagnostics: LiveCloseDiagnostics) {
    const identity = this.identity;
    if (!identity) return;
    try {
      const response = await fetch("/api/clouva-ai/live/turn", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          action: "diagnostic",
          runId: identity.runId,
          conversationId: identity.conversationId,
          diagnostics,
        }),
        cache: "no-store",
      });
      await responseJson(response, "LIVE_CONNECTION_FAILED");
    } catch (error) {
      console.warn("Trébol Live diagnostic persistence failed", error instanceof Error ? error.message : String(error));
    }
  }

  private async handleUnexpectedClose(diagnostics: LiveCloseDiagnostics) {
    const cleanAfterCompletedTurn = this.lastModelTurnCompleted && !this.modelTurnActive;
    const finishReason: TrebolLiveEndReason = cleanAfterCompletedTurn
      ? "MODEL_TURN_COMPLETE"
      : "SOCKET_CLOSED_UNEXPECTEDLY";
    if (!cleanAfterCompletedTurn) {
      await this.flushTranscript("user", "SOCKET_CLOSED_UNEXPECTEDLY");
      await this.flushTranscript("assistant", "SOCKET_CLOSED_UNEXPECTEDLY");
    }
    await this.transcriptDrain;
    await this.persistEnd(finishReason, diagnostics);
    this.options.callbacks?.onClosed?.(diagnostics.closeReason || "Conexión Live cerrada inesperadamente.");
  }

  private async finishAfterTransportLoss(reason: "RECONNECT_EXHAUSTED", message: string) {
    const cleanAfterCompletedTurn = this.lastModelTurnCompleted && !this.modelTurnActive;
    if (!cleanAfterCompletedTurn) {
      await this.flushTranscript("user", reason);
      await this.flushTranscript("assistant", reason);
    }
    await this.transcriptDrain;
    const diagnostics = this.buildCloseDiagnostics(undefined, message);
    await this.persistEnd(cleanAfterCompletedTurn ? "MODEL_TURN_COMPLETE" : reason, diagnostics);
    this.options.callbacks?.onClosed?.(message);
  }

  async close() {
    this.closing = true;
    this.phase = "closing";
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    const cleanAfterCompletedTurn = this.lastModelTurnCompleted && !this.modelTurnActive;
    if (!cleanAfterCompletedTurn) {
      await this.flushTranscript("user", "CLIENT_CANCELLED");
      await this.flushTranscript("assistant", "CLIENT_CANCELLED");
    }
    await this.transcriptDrain;
    const diagnostics = this.buildCloseDiagnostics(undefined, "Cierre solicitado por el cliente.");
    await this.persistEnd(cleanAfterCompletedTurn ? "MODEL_TURN_COMPLETE" : "CLIENT_CANCELLED", diagnostics);

    if (this.session) {
      this.markSent("audioStreamEnd");
      this.session.sendRealtimeInput({ audioStreamEnd: true });
      this.markSent("session.close");
      this.session.close();
    }
    this.session = null;
  }

  private async persistEnd(finishReason: TrebolLiveEndReason, diagnostics?: LiveCloseDiagnostics) {
    if (!this.identity || this.endRunSent) return;
    this.endRunSent = true;
    logTrebolEvent("TREBOL_LIVE_ENDED", {
      finishReason,
      runId: this.identity.runId,
      phase: diagnostics?.phase ?? this.phase,
      closeCode: diagnostics?.closeCode ?? null,
    });
    try {
      const response = await fetch("/api/clouva-ai/live/turn", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          action: "end",
          runId: this.identity.runId,
          conversationId: this.identity.conversationId,
          finishReason,
          diagnostics,
        }),
        cache: "no-store",
      });
      await responseJson(response, "LIVE_CONNECTION_FAILED");
    } catch (error) {
      this.endRunSent = false;
      this.options.callbacks?.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
