import { NextResponse } from "next/server";
import { agentHttpStatus, authenticateAgentRequest } from "@/lib/clouva-ai/agent/orchestrator";
import { decidePendingToolAction } from "@/lib/clouva-ai/agent/tool-decision";

export const runtime = "nodejs";
export const maxDuration = 60;

type ConfirmationBody = {
  conversationId?: string;
  pendingMessageId?: string;
  pendingActionId?: string;
  transcript?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { user, supabase } = await authenticateAgentRequest(request);
    const body = await request.json() as ConfirmationBody;
    const conversationId = body.conversationId?.trim() ?? "";
    const pendingMessageId = body.pendingMessageId?.trim() ?? "";
    const pendingActionId = body.pendingActionId?.trim() ?? "";
    const transcript = body.transcript?.trim().slice(0, 300) ?? "";
    if (![conversationId, pendingMessageId, pendingActionId].every((value) => UUID.test(value)) || !transcript) {
      return NextResponse.json({ error: "Faltan los datos de la confirmación por voz." }, { status: 400 });
    }
    const result = await decidePendingToolAction({
      supabase,
      userId: user.id,
      userEmail: user.email,
      conversationId,
      pendingMessageId,
      pendingActionId,
      source: "voice",
      voiceTranscript: transcript,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo resolver la confirmación por voz.",
        code: agentHttpStatus(error) === 403 ? "TOOL_PERMISSION_DENIED" : "TOOL_FAILED",
      },
      { status: agentHttpStatus(error) },
    );
  }
}
