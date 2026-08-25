import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildTrebolRuntimeContext } from "@/lib/clouva-ai/agent/context-builder";
import {
  agentHttpStatus,
  assertNoPendingAgentAction,
  authenticateAgentRequest,
  requireAgentConversation,
} from "@/lib/clouva-ai/agent/orchestrator";
import {
  finishAgentRun,
  recordAgentToolCall,
  requireAgentRun,
} from "@/lib/clouva-ai/agent/run-store";
import { createAgentToolRouter } from "@/lib/clouva-ai/agent/tool-service";
import { pendingToolActionView, ToolConfirmationGate } from "@/lib/clouva-ai/tool-confirmation";
import { projectToolScopeFromScreenContext } from "@/lib/clouva-ai/project-tool-scope";
import { isAdminEmail } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type ExecuteBody = {
  runId?: string;
  conversationId?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  currentContext?: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeToolResponse(value: unknown): unknown {
  const raw = JSON.stringify(value ?? null);
  if (raw.length <= 60_000) return value ?? null;
  return { truncated: true, resultPreview: raw.slice(0, 60_000) };
}

export async function POST(request: Request) {
  let router: Awaited<ReturnType<typeof createAgentToolRouter>> | null = null;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 300_000) {
      return NextResponse.json({ error: "La solicitud de herramienta es demasiado grande." }, { status: 413 });
    }

    const { user, supabase } = await authenticateAgentRequest(request);
    const body = await request.json() as ExecuteBody;
    const runId = body.runId?.trim() ?? "";
    const conversationId = body.conversationId?.trim() ?? "";
    const functionName = body.tool?.trim() ?? "";
    if (!UUID.test(runId) || !UUID.test(conversationId) || !functionName) {
      return NextResponse.json({ error: "Faltan identificadores válidos para ejecutar la herramienta." }, { status: 400 });
    }
    if (JSON.stringify(body.arguments ?? {}).length > 100_000) {
      return NextResponse.json({ error: "Los argumentos de la herramienta son demasiado grandes.", code: "TOOL_FAILED" }, { status: 413 });
    }

    const conversation = await requireAgentConversation({ supabase, conversationId });
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
    await assertNoPendingAgentAction({ supabase, userId: user.id, conversationId });

    const currentContext = buildTrebolRuntimeContext(body.currentContext);
    router = await createAgentToolRouter({
      userId: user.id,
      project: isAdminEmail(user.email),
      studioId: conversation.studioId,
      supabase,
      currentContext,
      conversationId,
      transport: "live",
      projectScope: projectToolScopeFromScreenContext(body.currentContext),
    });
    const routed = router.resolve(functionName);
    if (!routed) return NextResponse.json({ error: "La herramienta no está permitida en este contexto." }, { status: 403 });
    const normalized = router.normalizeArguments(routed, body.arguments ?? {});
    const gate = new ToolConfirmationGate();

    try {
      const decision = await gate.evaluate(routed, normalized);
      if (decision.kind === "confirmation_required") {
        const messageId = randomUUID();
        const content = `${decision.action.summary}\n\nRevisá la propuesta antes de decidir; todavía no se ejecutó ningún cambio.`;
        const { error } = await supabase.from("ai_messages").insert({
          id: messageId,
          conversation_id: conversationId,
          user_id: user.id,
          role: "assistant",
          content,
          metadata: {
            provider: "gemini-live",
            mode: "live",
            runId: run.id,
            pendingAction: decision.action,
          },
        });
        if (error) throw new Error(`No se pudo guardar la propuesta para revisarla: ${error.message}`);

        await Promise.all([
          recordAgentToolCall({
            supabase,
            run,
            userId: user.id,
            routed,
            toolArguments: normalized,
            status: "pending_confirmation",
            confirmation: { actionId: decision.action.id, status: "pending" },
          }),
          finishAgentRun({ supabase, run, status: "waiting_confirmation" }),
          supabase.from("project_events").insert({
            user_id: user.id,
            project_key: "clouva",
            event_type: "TREBOL_TOOL_PENDING",
            component: "clouva-ai-live",
            summary: decision.action.summary.slice(0, 240),
            payload: {
              conversationId,
              runId: run.id,
              actionId: decision.action.id,
              target: decision.action.target,
              tool: decision.action.tool,
              risk: decision.action.risk,
            },
          }),
        ]);

        return NextResponse.json({
          ok: true,
          kind: "pending_action",
          message: content,
          pendingAction: pendingToolActionView(decision.action, messageId),
        });
      }

      await recordAgentToolCall({
        supabase,
        run,
        userId: user.id,
        routed,
        toolArguments: normalized,
        status: "executed",
        result: decision.result,
      });
      return NextResponse.json({ ok: true, kind: "result", result: safeToolResponse(decision.result) });
    } catch (error) {
      await recordAgentToolCall({
        supabase,
        run,
        userId: user.id,
        routed,
        toolArguments: normalized,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "La herramienta falló.",
      }).catch((auditError) => console.error("Trébol tool failure audit failed", auditError));
      throw error;
    }
  } catch (error) {
    console.error("Trébol tool execution failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo ejecutar la herramienta.",
        code: agentHttpStatus(error) === 403 ? "TOOL_PERMISSION_DENIED" : "TOOL_FAILED",
      },
      { status: agentHttpStatus(error) },
    );
  } finally {
    if (router) await router.close().catch((error) => console.error("Trébol tool router close failed", error));
  }
}
