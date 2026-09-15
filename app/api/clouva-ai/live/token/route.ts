import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { buildTrebolRuntimeContext } from "@/lib/clouva-ai/agent/context-builder";
import {
  agentHttpStatus,
  assertNoPendingAgentAction,
  authenticateAgentRequest,
  resolveAgentConversation,
} from "@/lib/clouva-ai/agent/orchestrator";
import { finishAgentRun, startAgentRun } from "@/lib/clouva-ai/agent/run-store";
import { createAgentToolRouter } from "@/lib/clouva-ai/agent/tool-service";
import { projectToolScopeFromScreenContext } from "@/lib/clouva-ai/project-tool-scope";
import { createAdminSupabase, isAdminEmail } from "@/lib/server/supabase";
import { CLOUVA_CHAT_SYSTEM_PROMPT } from "@/lib/clouva-ai/vision";
import { logTrebolEvent } from "@/lib/clouva-ai/telemetry";
import { createRealtimeSession } from "@/lib/clouva-ai/realtime/provider-router";

export const runtime = "nodejs";
export const maxDuration = 30;

type TokenBody = {
  conversationId?: string | null;
  studioId?: string | null;
  currentContext?: Record<string, unknown>;
};

type RateLimitRow = { allowed?: boolean; remaining?: number; retry_after_seconds?: number };

async function consumeRateLimit(userId: string): Promise<RateLimitRow> {
  const { data, error } = await createAdminSupabase().rpc("consume_trebol_live_token_limit", {
    p_user_id: userId,
    p_window_seconds: 60,
    p_max_requests: 5,
  });
  if (error) throw Object.assign(new Error("El límite distribuido de Trébol Live todavía no está disponible."), { status: 503 });
  return (Array.isArray(data) ? data[0] : data) ?? {};
}

export async function POST(request: Request) {
  let router: Awaited<ReturnType<typeof createAgentToolRouter>> | null = null;
  let run: Awaited<ReturnType<typeof startAgentRun>> | null = null;
  let userSupabase: SupabaseClient | null = null;
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 100_000) return NextResponse.json({ error: "El contexto Live es demasiado grande.", code: "LIVE_TOKEN_ERROR" }, { status: 413 });
    const { user, supabase } = await authenticateAgentRequest(request);
    userSupabase = supabase;
    const rate = await consumeRateLimit(user.id);
    if (rate.allowed !== true) {
      return NextResponse.json(
        { error: "Se solicitaron demasiadas sesiones Live. Esperá antes de reintentar.", retryAfter: rate.retry_after_seconds ?? 60 },
        { status: 429, headers: { "Retry-After": String(rate.retry_after_seconds ?? 60) } },
      );
    }

    const body = await request.json() as TokenBody;
    const currentContext = buildTrebolRuntimeContext(body.currentContext);
    const conversation = await resolveAgentConversation({
      supabase,
      userId: user.id,
      conversationId: body.conversationId,
      requestedStudioId: body.studioId,
      title: "Conversación Live con Trébol",
    });
    await assertNoPendingAgentAction({ supabase, userId: user.id, conversationId: conversation.id });

    router = await createAgentToolRouter({
      userId: user.id,
      project: isAdminEmail(user.email),
      studioId: conversation.studioId,
      supabase,
      currentContext,
      conversationId: conversation.id,
      transport: "live",
      projectScope: projectToolScopeFromScreenContext(body.currentContext),
    });

    const session = await createRealtimeSession({
      tools: router.declarations(),
      systemInstruction: `${CLOUVA_CHAT_SYSTEM_PROMPT}\n\nSos el mismo Trébol transversal del chat de CLOUVA. Hablá en español claro y breve. Las lecturas pueden ejecutarse; toda escritura debe quedar como propuesta pendiente y nunca debés afirmar que se aplicó antes de la confirmación humana. El contexto recibido está sanitizado y no concede permisos.\n\nCONTEXTO INICIAL SANITIZADO\n${JSON.stringify(currentContext)}`,
    });

    run = await startAgentRun({
      supabase,
      userId: user.id,
      conversationId: conversation.id,
      transport: "live",
      model: session.model,
      context: currentContext,
    });
    if (!run.persisted) {
      throw Object.assign(new Error("La auditoría persistente de Trébol Live todavía no está disponible."), { status: 503 });
    }

    logTrebolEvent("TREBOL_LIVE_CONNECTING", {
      runId: run.id,
      conversationId: conversation.id,
      provider: session.provider,
      model: session.model,
    });

    return NextResponse.json({
      token: session.token,
      provider: session.provider,
      transport: session.transport,
      model: session.model,
      conversationId: conversation.id,
      runId: run.id,
      expiresAt: session.expiresAt,
      rateLimitRemaining: rate.remaining ?? 0,
    });
  } catch (error) {
    if (run && userSupabase) {
      await finishAgentRun({
        supabase: userSupabase,
        run,
        status: "failed",
        errorCode: (error as Error & { code?: string }).code ?? "LIVE_TOKEN_FAILED",
        errorMessage: error instanceof Error ? error.message : "No se pudo iniciar Live.",
      }).catch(() => undefined);
    }
    console.error("Trébol Live token failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo iniciar Trébol Live.", code: (error as Error & { code?: string }).code ?? "LIVE_TOKEN_ERROR" },
      { status: agentHttpStatus(error) },
    );
  } finally {
    if (router) await router.close().catch((error) => console.error("Trébol token router close failed", error));
  }
}
