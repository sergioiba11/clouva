import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parsePendingToolAction,
  ToolConfirmationGate,
  type PendingToolAction,
} from "@/lib/clouva-ai/tool-confirmation";
import { isAdminEmail } from "@/lib/server/supabase";
import { normalizeVoiceToolDecision } from "@/lib/clouva-ai/voice-confirmation";
import { logTrebolEvent } from "@/lib/clouva-ai/telemetry";
import { createAgentToolRouter } from "./tool-service";

type MessageMetadata = Record<string, unknown> & {
  pendingAction?: PendingToolAction | null;
  runId?: string;
  mode?: string;
};

type DecisionSource = "ui" | "voice";

function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toolExecutionMessage(action: PendingToolAction, result: unknown): string {
  if (action.target === "github" && action.tool === "github_write_file" && isRecord(result)) {
    const path = typeof result.path === "string" ? result.path : String(action.arguments.path ?? "archivo");
    const commit = typeof result.commitSha === "string" ? result.commitSha.slice(0, 7) : "creado";
    const branch = typeof result.branch === "string" ? result.branch : "main";
    return `Cambio aplicado en \`${path}\`. Commit \`${commit}\` sobre \`${branch}\`.`;
  }
  if (action.target === "clouva" && action.tool === "updatePlayer" && isRecord(result)) {
    const player = isRecord(result.player) ? result.player : {};
    const identity = isRecord(player.player) ? player.player : {};
    const name = typeof identity.display_name === "string" ? identity.display_name : String(action.arguments.playerId ?? "Player");
    const role = typeof player.role === "string" ? ` Su rol público ahora es “${player.role}”.` : "";
    return `Se actualizó ${name} dentro del Estudio.${role}`;
  }
  if (action.target === "clouva" && action.tool === "startPlayerProfileGeneration" && isRecord(result)) {
    const jobId = typeof result.jobId === "string" ? result.jobId : "desconocido";
    return `${result.reused === true ? "Se reutilizó la generación activa" : "La generación quedó encolada"} (job ${jobId}).`;
  }
  if (action.target === "clouva" && action.tool === "updateStudioIdentityDraft" && isRecord(result)) {
    const version = isRecord(result.version) ? result.version : {};
    const versionNumber = typeof version.version_number === "number" ? ` v${version.version_number}` : "";
    return `Se actualizó únicamente la propuesta${versionNumber}. ACTUAL no fue modificada ni publicada.`;
  }
  if (action.target === "media" && action.tool === "media.generate_image" && isRecord(result)) {
    const url = typeof result.url === "string" ? result.url : "";
    const jobId = typeof result.jobId === "string" ? result.jobId : "desconocido";
    return url
      ? `Imagen generada y guardada (job ${jobId}).\n\n![Imagen generada por Trébol](${url})`
      : `La generación de imagen quedó en estado ${String(result.status ?? "procesando")} (job ${jobId}).`;
  }
  return `Acción confirmada y ejecutada: ${action.title}.`;
}

async function persistDecisionMessage(args: {
  supabase: SupabaseClient;
  conversationId: string;
  userId: string;
  content: string;
  metadata: Record<string, unknown>;
}) {
  const { error } = await args.supabase.from("ai_messages").insert({
    conversation_id: args.conversationId,
    user_id: args.userId,
    role: "assistant",
    content: args.content,
    metadata: args.metadata,
  });
  if (error) throw new Error(error.message);
  await args.supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", args.conversationId);
}

async function updateAgentAudit(args: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  runId?: string;
  actionId: string;
  status: "executed" | "cancelled" | "failed";
  source: DecisionSource;
  transport?: "text" | "live";
  error?: string;
}) {
  const now = new Date().toISOString();
  const callResult = await args.supabase
    .from("ai_tool_calls")
    .update({
      status: args.status,
      confirmation: { actionId: args.actionId, source: args.source, accepted: args.status === "executed", decidedAt: now },
      error_message: args.error?.slice(0, 500) || null,
      completed_at: now,
      updated_at: now,
    })
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .contains("confirmation", { actionId: args.actionId });
  if (callResult.error && !/ai_tool_calls.*schema cache|relation .* does not exist/i.test(callResult.error.message)) {
    console.error("Trébol tool decision audit failed", callResult.error);
  }
  if (args.runId) {
    const liveContinues = args.transport === "live" && args.status !== "failed";
    let runQuery = args.supabase
      .from("ai_agent_runs")
      .update({
        status: liveContinues
          ? "running"
          : args.status === "failed"
            ? "failed"
            : args.status === "cancelled"
              ? "cancelled"
              : "completed",
        completed_at: liveContinues ? null : now,
        updated_at: now,
      })
      .eq("id", args.runId)
      .eq("user_id", args.userId)
      .eq("conversation_id", args.conversationId);
    if (liveContinues) runQuery = runQuery.eq("status", "waiting_confirmation");
    const runResult = await runQuery;
    if (runResult.error && !/ai_agent_runs.*schema cache|relation .* does not exist/i.test(runResult.error.message)) {
      console.error("Trébol run decision audit failed", runResult.error);
    }
  }
}

export async function decidePendingToolAction(args: {
  supabase: SupabaseClient;
  userId: string;
  userEmail: string | null | undefined;
  conversationId: string;
  pendingMessageId: string;
  pendingActionId: string;
  decision?: "confirm" | "cancel";
  source?: DecisionSource;
  voiceTranscript?: string;
}) {
  const source = args.source ?? "ui";
  const { data: row, error: readError } = await args.supabase
    .from("ai_messages")
    .select("id,conversation_id,user_id,metadata")
    .eq("id", args.pendingMessageId)
    .eq("conversation_id", args.conversationId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const metadata = isRecord(row?.metadata) ? row.metadata as MessageMetadata : null;
  const pendingAction = parsePendingToolAction(metadata?.pendingAction);
  if (!row || !metadata || !pendingAction || pendingAction.id !== args.pendingActionId) {
    throw statusError("La propuesta no existe o ya no pertenece a esta conversación.", 404);
  }
  if (pendingAction.status !== "pending") throw statusError("La propuesta ya fue resuelta o está siendo procesada.", 409);

  let decision = args.decision;
  if (source === "voice") {
    decision = normalizeVoiceToolDecision(args.voiceTranscript ?? "", pendingAction.confirmation === "explicit") ?? undefined;
    if (!decision) throw statusError("La confirmación por voz fue ambigua. Decí una frase de confirmación explícita o usá los botones.", 422);
  }
  if (decision !== "confirm" && decision !== "cancel") throw statusError("La decisión no es válida.", 400);

  const { data: conversation, error: conversationError } = await args.supabase
    .from("ai_conversations")
    .select("id,studio_id")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (conversationError) throw new Error(conversationError.message);
  if (!conversation) throw statusError("La conversación ya no está disponible.", 404);

  const isProjectAction = pendingAction.target === "github" || pendingAction.target === "workspace";
  const isDomainAction = pendingAction.target === "clouva";
  const isMediaAction = pendingAction.target === "media";
  if (!isProjectAction && !isDomainAction && !isMediaAction) throw statusError("La herramienta pendiente ya no está habilitada.", 409);
  if (isProjectAction && !isAdminEmail(args.userEmail)) throw statusError("Tu usuario no está autorizado para ejecutar herramientas de Proyecto.", 403);
  if (isDomainAction && !conversation.studio_id) throw statusError("La acción de dominio perdió el contexto de su Estudio.", 409);

  const now = new Date().toISOString();
  const lockedAction: PendingToolAction = {
    ...pendingAction,
    status: decision === "cancel" ? "cancelled" : "executing",
    updatedAt: now,
  };
  const { data: locked, error: lockError } = await args.supabase
    .from("ai_messages")
    .update({ metadata: { ...metadata, pendingAction: lockedAction } })
    .eq("id", args.pendingMessageId)
    .contains("metadata", { pendingAction: { id: args.pendingActionId, status: "pending" } })
    .select("id")
    .maybeSingle();
  if (lockError) throw new Error(lockError.message);
  if (!locked) throw statusError("La propuesta fue resuelta desde otra sesión.", 409);

  if (decision === "cancel") {
    const message = `Acción cancelada: ${pendingAction.title}. No se ejecutó ningún cambio.`;
    await Promise.all([
      persistDecisionMessage({
        supabase: args.supabase,
        conversationId: args.conversationId,
        userId: args.userId,
        content: message,
        metadata: { mode: isProjectAction ? "project" : "chat", toolDecision: { actionId: pendingAction.id, status: "cancelled", source } },
      }),
      updateAgentAudit({
        supabase: args.supabase,
        userId: args.userId,
        conversationId: args.conversationId,
        runId: metadata.runId,
        actionId: pendingAction.id,
        status: "cancelled",
        source,
        transport: metadata.mode === "live" ? "live" : "text",
      }),
    ]);
    return { ok: true, message, pendingAction: null };
  }

  const router = await createAgentToolRouter({
    userId: args.userId,
    project: isProjectAction,
    studioId: isDomainAction ? conversation.studio_id : null,
    supabase: args.supabase,
    includeRuntime: false,
    includeMedia: true,
    conversationId: args.conversationId,
    transport: metadata.mode === "live" ? "live" : "text",
  });
  try {
    const result = await new ToolConfirmationGate().confirm(router, lockedAction);
    const executedAction: PendingToolAction = { ...lockedAction, status: "executed", updatedAt: new Date().toISOString() };
    const resultSummary = toolExecutionMessage(executedAction, result);
    const { error: updateError } = await args.supabase
      .from("ai_messages")
      .update({ metadata: { ...metadata, pendingAction: executedAction } })
      .eq("id", args.pendingMessageId)
      .contains("metadata", { pendingAction: { id: args.pendingActionId, status: "executing" } });
    if (updateError) throw new Error(updateError.message);

    await Promise.all([
      persistDecisionMessage({
        supabase: args.supabase,
        conversationId: args.conversationId,
        userId: args.userId,
        content: resultSummary,
        metadata: { mode: isProjectAction ? "project" : "chat", toolExecution: { actionId: pendingAction.id, target: pendingAction.target, tool: pendingAction.tool, source } },
      }),
      args.supabase.from("project_events").insert({
        user_id: args.userId,
        project_key: "clouva",
        event_type: source === "voice" ? "TREBOL_CONFIRMATION_ACCEPTED" : "ai_tool_execution",
        component: pendingAction.target,
        summary: resultSummary.slice(0, 240),
        payload: { conversationId: args.conversationId, actionId: pendingAction.id, tool: pendingAction.tool, risk: pendingAction.risk, source },
      }),
      updateAgentAudit({
        supabase: args.supabase,
        userId: args.userId,
        conversationId: args.conversationId,
        runId: metadata.runId,
        actionId: pendingAction.id,
        status: "executed",
        source,
        transport: metadata.mode === "live" ? "live" : "text",
      }),
    ]);
    logTrebolEvent("TREBOL_CONFIRMATION_ACCEPTED", { actionId: pendingAction.id, tool: pendingAction.tool, source });
    return { ok: true, message: resultSummary, result, pendingAction: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo ejecutar la acción confirmada.";
    const failedAction: PendingToolAction = { ...lockedAction, status: "failed", updatedAt: new Date().toISOString(), error: message };
    await args.supabase
      .from("ai_messages")
      .update({ metadata: { ...metadata, pendingAction: failedAction } })
      .eq("id", args.pendingMessageId)
      .contains("metadata", { pendingAction: { id: args.pendingActionId, status: "executing" } });
    await Promise.all([
      persistDecisionMessage({
        supabase: args.supabase,
        conversationId: args.conversationId,
        userId: args.userId,
        content: `No se ejecutó ${pendingAction.title}: ${message}`,
        metadata: { mode: isProjectAction ? "project" : "chat", toolExecution: { actionId: pendingAction.id, target: pendingAction.target, tool: pendingAction.tool, status: "failed", error: message, source } },
      }).catch((persistError) => console.error("CLOUVA AI: failed to persist tool failure", persistError)),
      updateAgentAudit({
        supabase: args.supabase,
        userId: args.userId,
        conversationId: args.conversationId,
        runId: metadata.runId,
        actionId: pendingAction.id,
        status: "failed",
        source,
        transport: metadata.mode === "live" ? "live" : "text",
        error: message,
      }),
    ]);
    throw error;
  } finally {
    await router.close();
  }
}
