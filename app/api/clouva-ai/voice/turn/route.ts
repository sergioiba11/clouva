import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TRANSCRIPT_LENGTH = 20_000;

type VoiceTurnBody = {
  conversationId?: string;
  userText?: string;
  assistantText?: string;
  model?: string;
  projectKey?: string;
};

function cleanTranscript(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TRANSCRIPT_LENGTH);
}

export async function POST(request: NextRequest) {
  try {
    const authenticated = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as VoiceTurnBody;
    const conversationId = body.conversationId?.trim();
    const userText = cleanTranscript(body.userText);
    const assistantText = cleanTranscript(body.assistantText);
    const projectKey = body.projectKey?.trim() || "clouva";
    const model = /^gemini-[a-z0-9._-]+$/i.test(body.model ?? "")
      ? body.model!
      : process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";

    if (!conversationId) {
      return NextResponse.json({ error: "Falta la conversación de voz." }, { status: 400 });
    }
    if (!userText && !assistantText) {
      return NextResponse.json({ error: "El turno de voz no tiene transcripción." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: conversation, error: conversationError } = await admin
      .from("ai_conversations")
      .select("id,title")
      .eq("id", conversationId)
      .eq("user_id", authenticated.user.id)
      .maybeSingle();
    if (conversationError) throw new Error("No se pudo verificar la conversación.");
    if (!conversation) {
      return NextResponse.json({ error: "La conversación de voz no pertenece a esta sesión." }, { status: 404 });
    }

    const rows = [];
    if (userText) {
      rows.push({
        conversation_id: conversationId,
        user_id: authenticated.user.id,
        role: "user",
        content: userText,
        metadata: { provider: "gemini-live", model, channel: "voice" },
      });
    }
    if (assistantText) {
      rows.push({
        conversation_id: conversationId,
        user_id: authenticated.user.id,
        role: "assistant",
        content: assistantText,
        metadata: { provider: "gemini-live", model, channel: "voice" },
      });
    }

    const { error: insertError } = await admin.from("ai_messages").insert(rows);
    if (insertError) throw new Error(insertError.message);

    const conversationUpdate: Record<string, string> = { updated_at: new Date().toISOString() };
    if (userText && (!conversation.title || conversation.title === "Conversación por voz")) {
      conversationUpdate.title = userText.slice(0, 72);
    }

    const operations = [
      admin.from("ai_conversations").update(conversationUpdate).eq("id", conversationId).eq("user_id", authenticated.user.id),
      admin.from("project_events").insert({
        user_id: authenticated.user.id,
        project_key: projectKey,
        event_type: "ai_voice_interaction",
        component: "clouva-ai",
        summary: (userText || assistantText).slice(0, 240),
        payload: {
          conversationId,
          provider: "gemini-live",
          model,
          channel: "voice",
        },
      }),
    ];
    const results = await Promise.all(operations);
    const operationError = results.find((result) => result.error)?.error;
    if (operationError) throw new Error(operationError.message);

    console.info("AI_VOICE_TURN_SAVED", {
      conversationId,
      userId: authenticated.user.id,
      model,
      hasUserTranscript: Boolean(userText),
      hasAssistantTranscript: Boolean(assistantText),
    });

    return NextResponse.json({
      ok: true,
      conversationId,
      userText,
      assistantText,
      model,
    });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    const message = error instanceof Error ? error.message : "No se pudo guardar el turno de voz.";
    console.error("AI_VOICE_TURN_ERROR", { message });
    return NextResponse.json({ error: message }, { status });
  }
}
