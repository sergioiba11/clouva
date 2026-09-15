import { NextResponse } from "next/server";
import {
  agentHttpStatus,
  authenticateAgentRequest,
  requireAgentConversation,
} from "@/lib/clouva-ai/agent/orchestrator";
import { finishAgentRun, requireAgentRun } from "@/lib/clouva-ai/agent/run-store";
import {
  isCompletedTranscriptReason,
  isTrebolLiveEndReason,
  isTrebolLiveTranscriptFinishReason,
  type TrebolLiveEndReason,
} from "@/lib/clouva-ai/live/protocol";

export const runtime = "nodejs";

type TurnBody = {
  action?: "transcript" | "end";
  runId?: string;
  conversationId?: string;
  messageId?: string;
  role?: "user" | "assistant";
  content?: string;
  finishReason?: string;
  diagnostics?: unknown;
};

type SafeLiveDiagnostics = {
  timestamp?: string | null;
  sessionId: string;
  readyState?: number | null;
  closeCode?: number | null;
  closeReason?: string | null;
  wasClean?: boolean | null;
  socketLifetimeMs?: number | null;
  lastSentEvent?: string | null;
  lastReceivedEvent?: string | null;
  phase?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function safeLiveDiagnostics(value: unknown, runId: string): SafeLiveDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return {
    timestamp: boundedString(source.timestamp, 40),
    sessionId: runId,
    readyState: boundedNumber(source.readyState, 0, 3),
    closeCode: boundedNumber(source.closeCode, 0, 65_535),
    closeReason: boundedString(source.closeReason, 300),
    wasClean: typeof source.wasClean === "boolean" ? source.wasClean : null,
    socketLifetimeMs: boundedNumber(source.socketLifetimeMs, 0, 24 * 60 * 60 * 1_000),
    lastSentEvent: boundedString(source.lastSentEvent, 80),
    lastReceivedEvent: boundedString(source.lastReceivedEvent, 80),
    phase: boundedString(source.phase, 40),
  };
}

function runEndState(reason: TrebolLiveEndReason, diagnostics: SafeLiveDiagnostics | null) {
  switch (reason) {
    case "MODEL_TURN_COMPLETE":
      return { status: "completed" as const, errorCode: null, errorMessage: null };
    case "CLIENT_CANCELLED":
      return {
        status: "cancelled" as const,
        errorCode: "CLIENT_CANCELLED",
        errorMessage: "La sesión Live fue cerrada por el cliente antes de completar un nuevo turno del modelo.",
      };
    case "SOCKET_CLOSED_UNEXPECTEDLY":
      return {
        status: "failed" as const,
        errorCode: "GEMINI_LIVE_SOCKET_CLOSED",
        errorMessage: diagnostics?.closeReason
          ? `Gemini Live cerró el socket: ${diagnostics.closeReason}`
          : "Gemini Live cerró el socket sin una finalización limpia.",
      };
    case "RECONNECT_EXHAUSTED":
      return {
        status: "failed" as const,
        errorCode: "RECONNECT_EXHAUSTED",
        errorMessage: "La sesión Live agotó los intentos de reconexión.",
      };
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await authenticateAgentRequest(request);
    const body = await request.json() as TurnBody;
    const runId = body.runId?.trim() ?? "";
    const conversationId = body.conversationId?.trim() ?? "";
    if (!UUID.test(runId) || !UUID.test(conversationId)) {
      return NextResponse.json({ error: "La ejecución Live no es válida." }, { status: 400 });
    }

    await requireAgentConversation({ supabase, conversationId });
    const run = await requireAgentRun({
      supabase,
      runId,
      userId: user.id,
      conversationId,
      transport: "live",
    });
    if (!run.persisted) {
      throw Object.assign(new Error("La auditoría de esta sesión Live no está disponible."), { status: 503 });
    }

    if (body.action === "end") {
      if (!isTrebolLiveEndReason(body.finishReason)) {
        return NextResponse.json({ error: "La finalización Live no tiene una causa válida." }, { status: 400 });
      }
      const diagnostics = safeLiveDiagnostics(body.diagnostics, runId);
      const end = runEndState(body.finishReason, diagnostics);
      if (diagnostics) {
        console.info(JSON.stringify({
          event: "TREBOL_LIVE_END_DIAGNOSTIC",
          at: new Date().toISOString(),
          runId,
          conversationId,
          finishReason: body.finishReason,
          ...diagnostics,
        }));
      }
      await finishAgentRun({
        supabase,
        run,
        status: end.status,
        errorCode: end.errorCode,
        errorMessage: end.errorMessage,
        diagnosticMetadata: diagnostics,
      });
      return NextResponse.json({ ok: true, status: end.status, finishReason: body.finishReason });
    }

    const messageId = body.messageId?.trim() ?? "";
    const content = body.content?.trim() ?? "";
    if (
      !UUID.test(messageId)
      || !["user", "assistant"].includes(body.role ?? "")
      || !content
      || !isTrebolLiveTranscriptFinishReason(body.finishReason)
    ) {
      return NextResponse.json({ error: "La transcripción final no es válida." }, { status: 400 });
    }
    if (content.length > 20_000) return NextResponse.json({ error: "La transcripción es demasiado larga." }, { status: 413 });

    const transcriptFinal = isCompletedTranscriptReason(body.finishReason);
    const { error } = await supabase.from("ai_messages").insert({
      id: messageId,
      conversation_id: conversationId,
      user_id: user.id,
      role: body.role,
      content,
      metadata: {
        provider: "gemini-live",
        mode: "live",
        runId,
        transcriptFinal,
        finishReason: body.finishReason,
      },
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    if (error?.code === "23505") {
      // Retries reuse the browser-generated message UUID, so transcript
      // persistence remains idempotent across reconnects.
      return NextResponse.json({ ok: true, messageId, duplicate: true });
    }

    await Promise.all([
      supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId),
      supabase.from("project_events").insert({
        user_id: user.id,
        project_key: "clouva",
        event_type: "TREBOL_LIVE_TRANSCRIPT",
        component: "clouva-ai-live",
        summary: content.slice(0, 240),
        payload: {
          conversationId,
          runId,
          role: body.role,
          messageId,
          finishReason: body.finishReason,
          transcriptFinal,
        },
      }),
    ]);
    return NextResponse.json({ ok: true, messageId, duplicate: false });
  } catch (error) {
    console.error("Trébol Live turn persistence failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el turno Live." },
      { status: agentHttpStatus(error) },
    );
  }
}
