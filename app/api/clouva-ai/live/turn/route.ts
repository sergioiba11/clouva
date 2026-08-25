import { NextResponse } from "next/server";
import {
  agentHttpStatus,
  authenticateAgentRequest,
  requireAgentConversation,
} from "@/lib/clouva-ai/agent/orchestrator";
import { finishAgentRun, requireAgentRun } from "@/lib/clouva-ai/agent/run-store";

export const runtime = "nodejs";

type TurnBody = {
  action?: "transcript" | "end";
  runId?: string;
  conversationId?: string;
  messageId?: string;
  role?: "user" | "assistant";
  content?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      await finishAgentRun({ supabase, run, status: "completed" });
      return NextResponse.json({ ok: true });
    }

    const messageId = body.messageId?.trim() ?? "";
    const content = body.content?.trim() ?? "";
    if (!UUID.test(messageId) || !["user", "assistant"].includes(body.role ?? "") || !content) {
      return NextResponse.json({ error: "La transcripción final no es válida." }, { status: 400 });
    }
    if (content.length > 20_000) return NextResponse.json({ error: "La transcripción es demasiado larga." }, { status: 413 });

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
        transcriptFinal: true,
      },
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    if (error?.code === "23505") {
      // The browser can retry a completed transcript after a reconnect.
      // Its client-generated UUID makes that retry idempotent, including
      // the surrounding audit event and conversation timestamp.
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
        payload: { conversationId, runId, role: body.role, messageId },
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
