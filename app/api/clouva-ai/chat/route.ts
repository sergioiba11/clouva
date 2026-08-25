import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { buildTrebolRuntimeContext } from "@/lib/clouva-ai/agent/context-builder";
import {
  agentHttpStatus,
  assertNoPendingAgentAction,
  authenticateAgentRequest,
  resolveAgentConversation,
} from "@/lib/clouva-ai/agent/orchestrator";
import { finishAgentRun, recordAgentToolCall, startAgentRun } from "@/lib/clouva-ai/agent/run-store";
import { decidePendingToolAction } from "@/lib/clouva-ai/agent/tool-decision";
import { createAgentToolRouter } from "@/lib/clouva-ai/agent/tool-service";
import { resolveStudioContext } from "@/lib/clouva-ai/context-resolver";
import { selectedModelFromRequest } from "@/lib/clouva-ai/gemini-text";
import { streamGeminiWithFallback } from "@/lib/clouva-ai/gemini-stream";
import { runGeminiToolLoop, type ToolCallTrace } from "@/lib/clouva-ai/gemini-tools";
import {
  createMemoryProposal,
  detectMemoryCandidate,
  pendingMemoryProposalView,
  type MemoryProposal,
} from "@/lib/clouva-ai/memory-proposals";
import {
  pendingToolActionView,
  ToolConfirmationGate,
  type PendingToolAction,
} from "@/lib/clouva-ai/tool-confirmation";
import { ToolRouter } from "@/lib/clouva-ai/tool-router";
import { decideMemoryProposal, loadEffectiveMemory } from "@/lib/server/memory-approval";
import { createAdminSupabase, isAdminEmail } from "@/lib/server/supabase";
import { CLOUVA_CHAT_SYSTEM_PROMPT, CLOUVA_PRODUCT_CONTEXT, CLOUVA_REPOSITORY_AGENT_PROMPT } from "@/lib/clouva-ai/vision";
import { attachmentPart, normalizeAttachments, normalizeScreenContext } from "@/lib/clouva-ai/multimodal";
import { projectToolScopeFromScreenContext } from "@/lib/clouva-ai/project-tool-scope";

// THE canonical CLOUVA AI Conversation Orchestrator. Single server-side
// writer of ai_conversations/ai_messages — components/clouva-ai/ClouvaAIChat.tsx
// no longer inserts into Supabase itself, and no longer calls /api/gemini or
// /api/clouva-ai/agent directly; both those routes are legacy now (kept
// working, not deleted, per the approved migration plan).
//
// Persistence + auth run under the CALLING USER's own JWT (not a service
// role) — RLS on ai_conversations/ai_messages is what actually decides who
// can read/write a conversation, this route doesn't re-implement that
// decision. See supabase/migrations for is_active_studio_participant()
// (chat) vs can_manage_studio() (creating a Studio conversation, and every
// sensitive/structured action layered on top later).
//
// Studio-conversation context (studio/members/players/relevant profile
// versions) comes from lib/clouva-ai/context-resolver.ts — selective, not a
// full-table dump. Project and Studio domain function-calling are routed only
// through ToolRouter + ToolConfirmationGate: reads may execute immediately;
// no write/destructive/sensitive call can bypass the persisted human review.

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMode = "chat" | "project";
type ChatMessageRow = { role: "user" | "assistant"; content: string; created_at: string };
type RequestBody = {
  action?: "message" | "confirm_tool" | "cancel_tool" | "approve_memory" | "reject_memory";
  message?: string;
  conversationId?: string | null;
  studioId?: string | null;
  mode?: ChatMode;
  screenContext?: Record<string, unknown>;
  attachments?: Array<{
    name?: string;
    mimeType?: string;
    size?: number;
    dataBase64?: string;
    kind?: "image" | "audio" | "file" | "preview";
  }>;
  pendingMessageId?: string;
  pendingActionId?: string;
  memoryMessageId?: string;
  memoryProposalId?: string;
};

const STUDIO_DOMAIN_TOOL_RULES = `REGLAS DE HERRAMIENTAS DE DOMINIO
- Usá getStudio y getStudioPlayers para consultar datos actuales; no inventes IDs, roles ni estados.
- Para trabajar sobre el Preview de identidad, primero llamá getStudioIdentityVersions y usá exclusivamente el id/configuración del draft devuelto.
- updateStudioIdentityDraft modifica sólo la PROPUESTA draft. La versión publicada (ACTUAL) es inmutable y esta herramienta nunca publica.
- El layout debe conservar el contrato canónico y sólo puede reutilizar assets ya vinculados al draft. No generes HTML, JSX, CSS libre ni URLs de assets inventadas.
- Toda escritura queda como propuesta pendiente de revisión humana. Iniciar una generación de perfil además requiere confirmación reforzada porque consume el pipeline de IA.
- Nunca pidas un argumento de confirmación ni afirmes que una escritura ocurrió antes de recibir su resultado.
- Si el servicio real rechaza una acción por permisos, Studio OS, VIP o estado de versión, explicá ese motivo sin intentar una escritura alternativa.`;

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

async function handleToolDecision(args: {
  body: RequestBody;
  supabase: SupabaseClient;
  userId: string;
  userEmail: string | null | undefined;
}): Promise<NextResponse> {
  const { body, supabase, userId, userEmail } = args;
  const conversationId = body.conversationId?.trim();
  const pendingMessageId = body.pendingMessageId?.trim();
  const pendingActionId = body.pendingActionId?.trim();
  if (!conversationId || !pendingMessageId || !pendingActionId) {
    return NextResponse.json({ error: "Faltan los identificadores de la acción pendiente." }, { status: 400 });
  }
  try {
    const result = await decidePendingToolAction({
      supabase,
      userId,
      userEmail,
      conversationId,
      pendingMessageId,
      pendingActionId,
      decision: body.action === "cancel_tool" ? "cancel" : "confirm",
      source: "ui",
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo resolver la acción.", pendingAction: null },
      { status },
    );
  }
}

async function handleMemoryDecision(args: {
  body: RequestBody;
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
}): Promise<NextResponse> {
  const conversationId = args.body.conversationId?.trim();
  const messageId = args.body.memoryMessageId?.trim();
  const proposalId = args.body.memoryProposalId?.trim();
  if (!conversationId || !messageId || !proposalId) {
    return NextResponse.json({ error: "Faltan los identificadores de la propuesta de memoria." }, { status: 400 });
  }

  try {
    const approved = args.body.action === "approve_memory";
    const result = await decideMemoryProposal({
      supabase: args.supabase,
      admin: args.admin,
      userId: args.userId,
      conversationId,
      messageId,
      proposalId,
      decision: approved ? "approve" : "reject",
    });

    const message = approved
      ? result.duplicate
        ? "Memoria aprobada. Ya existía una memoria equivalente, así que no se creó un duplicado."
        : "Memoria aprobada y agregada al contexto futuro."
      : "Propuesta de memoria rechazada. No entrará al contexto futuro.";

    await persistDecisionMessage({
      supabase: args.supabase,
      conversationId,
      userId: args.userId,
      content: message,
      metadata: {
        mode: "chat",
        memoryDecision: {
          proposalId,
          status: result.status,
          memoryId: "memoryId" in result ? result.memoryId : null,
          duplicate: "duplicate" in result ? result.duplicate : false,
          idempotent: result.idempotent,
        },
      },
    });
    await args.supabase.from("project_events").insert({
      user_id: args.userId,
      project_key: "clouva",
      event_type: approved ? "ai_memory_approved" : "ai_memory_rejected",
      component: "clouva-ai",
      summary: message,
      payload: {
        conversationId,
        sourceMessageId: messageId,
        proposalId,
        memoryId: "memoryId" in result ? result.memoryId : null,
        duplicate: "duplicate" in result ? result.duplicate : false,
      },
    });

    return NextResponse.json({ ok: true, message, result, pendingMemoryProposal: null });
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo resolver la propuesta de memoria." },
      { status },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const { user, supabase } = await authenticateAgentRequest(request);
    const userId = user.id;

    if (body.action === "confirm_tool" || body.action === "cancel_tool") {
      return handleToolDecision({ body, supabase, userId, userEmail: user.email });
    }
    if (body.action === "approve_memory" || body.action === "reject_memory") {
      return handleMemoryDecision({
        body,
        supabase,
        admin: createAdminSupabase(),
        userId,
      });
    }

    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });
    if (message.length > 20_000) return NextResponse.json({ error: "El mensaje es demasiado largo." }, { status: 413 });
    const screenContext = normalizeScreenContext(body.screenContext);
    const attachments = normalizeAttachments(body.attachments);

    const mode: ChatMode = body.mode === "project" ? "project" : "chat";
    const requestedStudioId = body.studioId?.trim() || null;

    if (mode === "project" && !isAdminEmail(user.email)) {
      return NextResponse.json({ error: "Tu usuario no está autorizado para el modo Proyecto." }, { status: 403 });
    }

    // Resolve or create the conversation. RLS decides whether this user may
    // see/reuse an existing one, or create a new Studio-scoped one — this
    // route never overrides that with a service role. If conversationId is
    // given but RLS hides it (wrong owner, not a participant of that
    // Studio), it's treated as if it didn't exist rather than erroring.
    const conversation = await resolveAgentConversation({
      supabase,
      userId,
      conversationId: body.conversationId,
      requestedStudioId,
      title: message,
    });
    const activeConversationId = conversation.id;
    const studioId = conversation.studioId;

    // Context and approved memory are available in every mode. Project and
    // Studio executors are added only when their real scope allows them.
    const toolsEnabled = true;

    const [, unresolvedMemoryResult] = await Promise.all([
      toolsEnabled
        ? assertNoPendingAgentAction({ supabase, userId, conversationId: activeConversationId })
        : Promise.resolve(),
      supabase
        .from("ai_messages")
        .select("id")
        .eq("conversation_id", activeConversationId)
        .eq("user_id", userId)
        .contains("metadata", { memoryProposal: { status: "pending" } })
        .limit(1),
    ]);
    if (unresolvedMemoryResult.error) throw new Error(unresolvedMemoryResult.error.message);
    if (unresolvedMemoryResult.data?.length) {
      return NextResponse.json(
        { error: "Hay una propuesta de memoria pendiente. Aprobala o rechazala antes de continuar." },
        { status: 409 },
      );
    }

    await supabase.from("ai_messages").insert({
      conversation_id: activeConversationId,
      user_id: userId,
      role: "user",
      content: message,
      metadata: {
        mode,
        screenContext,
        attachments: attachments.map(({ name, mimeType, size, kind }) => ({ name, mimeType, size, kind })),
      },
    });

    // --- Context gathering -------------------------------------------------
    const [{ data: recentMessages }, studioContextResult, memoryRows, eventRows] = await Promise.all([
      supabase
        .from("ai_messages")
        .select("role,content,created_at")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: false })
        .limit(24),
      studioId ? resolveStudioContext(supabase, studioId) : Promise.resolve(null),
      loadEffectiveMemory({ supabase, userId, studioId }),
      studioId
        ? Promise.resolve({ data: [] as Array<{ event_type: string; component: string | null; summary: string; created_at: string }> })
        : supabase
            .from("project_events")
            .select("event_type,component,summary,created_at")
            .eq("user_id", userId)
            .eq("project_key", "clouva")
            .order("created_at", { ascending: false })
            .limit(24),
    ]);

    const memoryContext = memoryRows
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");
    const eventContext = (eventRows.data ?? [])
      .map((item) => `[${item.created_at}] ${item.event_type}/${item.component ?? "general"}: ${item.summary}`)
      .join("\n");
    const studioContext = studioContextResult?.summary ?? "";

    let instruction: string;
    if (mode === "project") {
      instruction = `${CLOUVA_REPOSITORY_AGENT_PROMPT}

REGLAS DE HERRAMIENTAS
- Usá las funciones disponibles para obtener hechos reales de GitHub o del Workspace conectado; no inventes lecturas.
- Las herramientas de lectura se ejecutan automáticamente y podés encadenarlas.
- Cuando hay un Web Preview local activo, priorizá workspace.files.list/read/write sobre GitHub: Workspace representa el código local actual y permite verificar Hot Reload. Usá GitHub sólo si el usuario pide explícitamente el remoto o si Workspace no está disponible.
- No repitas una lectura con la misma herramienta y los mismos argumentos. Leé sólo los archivos necesarios; cuando ya tengas el archivo objetivo, avanzá a una sola propuesta de escritura.
- Para modificar algo, llamá la herramienta de escritura con el contenido completo propuesto. La aplicación va a mostrar el diff y esperar una decisión humana; nunca afirmes que el cambio ya ocurrió antes de recibir el resultado de ejecución.
- No pidas ni generes un argumento de confirmación: la confirmación sólo puede venir de la interfaz humana y del servidor.
- No agrupes varias escrituras en paralelo. Prepará una sola acción revisable por vez.
- Si una herramienta falla o Workspace no está conectado, explicá el error real y ofrecé el siguiente paso sin fingir acceso.

MEMORIA PERSISTENTE DEL PROYECTO
${memoryContext || "Sin memoria adicional guardada."}

CONTEXTO DE PANTALLA
${JSON.stringify(screenContext)}

Recordatorio de visión estable:
${CLOUVA_PRODUCT_CONTEXT}`;
      if (studioId) instruction += `\n\n${STUDIO_DOMAIN_TOOL_RULES}`;
    } else {
      instruction = `${CLOUVA_CHAT_SYSTEM_PROMPT}\n\n${studioContext}\n\nMEMORIA CONFIRMADA DEL PROYECTO\n${memoryContext || "Todavía no hay memoria guardada."}\n\nEVENTOS RECIENTES\n${eventContext || "No hay eventos recientes registrados."}\n\nCONTEXTO DE WORKSPACE\n${JSON.stringify(screenContext)}`;
      if (studioId) {
        instruction += `\n\n${STUDIO_DOMAIN_TOOL_RULES}\n- updatePlayer sólo cambia la relación pública del Player con este Estudio, nunca su identidad global.`;
      }
    }

    const history: ChatMessageRow[] = (recentMessages ?? []).slice().reverse() as ChatMessageRow[];
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = history.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content.slice(0, 10_000) }],
    }));
    if (attachments.length) {
      for (let index = contents.length - 1; index >= 0; index -= 1) {
        if (contents[index].role !== "user") continue;
        contents[index] = {
          ...contents[index],
          parts: [...contents[index].parts, ...attachments.map(attachmentPart)],
        };
        break;
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en el servicio de Cloud Run.");
    const selectedModel = selectedModelFromRequest(request);
    const runtimeContext = buildTrebolRuntimeContext(screenContext);
    const agentRun = await startAgentRun({
      supabase,
      userId,
      conversationId: activeConversationId,
      transport: "text",
      model: selectedModel,
      context: runtimeContext,
    });
    const generationOptions = {
      temperature: mode === "project" ? 0.25 : 0.45,
      maxOutputTokens: mode === "project" ? 6000 : 4096,
    };

    // The client keeps one NDJSON protocol for both modes. Chat streams text
    // directly; project mode first completes the function-calling/gate loop,
    // then emits the final answer or the persisted proposal as a chunk.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        function send(frame: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        }

        let assistantMessage = "";
        let model = selectedModel;
        let pendingAction: PendingToolAction | null = null;
        let toolTraces: ToolCallTrace[] = [];
        let usage: Record<string, unknown> | null = null;
        let router: ToolRouter | null = null;
        // Detection is independent from answer generation and considers only
        // the user's explicit statement. Run it concurrently so the review
        // card does not add another full model round trip after streaming.
        const memoryDetectionPromise = detectMemoryCandidate({
          apiKey,
          selectedModel,
          userMessage: message,
          assistantMessage: "",
          studioId,
        }).catch((error) => {
          console.error("CLOUVA AI memory proposal detection failed", error);
          return null;
        });

        try {
          if (toolsEnabled) {
            router = await createAgentToolRouter({
              userId,
              project: mode === "project",
              studioId,
              supabase,
              currentContext: runtimeContext,
              conversationId: activeConversationId,
              transport: "text",
              projectScope: projectToolScopeFromScreenContext(screenContext),
            });
            const result = await runGeminiToolLoop({
              apiKey,
              selectedModel,
              instruction,
              contents,
              router,
              gate: new ToolConfirmationGate(),
              onToolCall: async (event) => {
                await recordAgentToolCall({
                  supabase,
                  run: agentRun,
                  userId,
                  routed: event.routed,
                  toolArguments: event.arguments,
                  status: event.status,
                  confirmation: event.pendingAction
                    ? { actionId: event.pendingAction.id, status: event.pendingAction.status }
                    : null,
                  result: event.result,
                  errorMessage: event.error,
                });
              },
              ...generationOptions,
            });
            model = result.model;
            pendingAction = result.pendingAction;
            toolTraces = result.traces;
            usage = result.usage;

            if (pendingAction) {
              assistantMessage = result.text;
            } else {
              // The function-selection loop is deliberately buffered so a
              // tool call cannot slip past the gate. Once it has finished,
              // make a final tools-disabled streaming pass over the exact
              // model/function history. If that pass fails before emitting
              // text, the loop's already-valid draft remains a safe fallback.
              try {
                const finalGenerator = streamGeminiWithFallback({
                  apiKey,
                  selectedModel: result.model,
                  instruction: `${instruction}\n\nRESPUESTA FINAL\nLas herramientas ya fueron resueltas para este turno. Respondé ahora con la conclusión final basada únicamente en el historial y los resultados de función disponibles.${result.limitReached ? " Se alcanzó el límite seguro del ciclo: no hay una propuesta de escritura pendiente ni un cambio ejecutado. No pidas más herramientas; explicá lo averiguado y el próximo paso concreto sin afirmar que modificaste archivos." : ""}`,
                  contents: result.continuationContents,
                  ...generationOptions,
                });
                while (true) {
                  const { value, done } = await finalGenerator.next();
                  if (done) {
                    model = value.model;
                    usage = value.usage;
                    break;
                  }
                  assistantMessage += value;
                  send({ type: "chunk", text: value });
                }
              } catch (streamError) {
                if (assistantMessage) throw streamError;
                assistantMessage = result.text;
                send({ type: "chunk", text: assistantMessage });
              }
            }
          } else {
            const generator = streamGeminiWithFallback({ apiKey, selectedModel, instruction, contents, ...generationOptions });
            while (true) {
              const { value, done } = await generator.next();
              if (done) {
                model = value.model;
                usage = value.usage;
                break;
              }
              assistantMessage += value;
              send({ type: "chunk", text: value });
            }
          }

          if (!assistantMessage) throw new Error("CLOUVA AI no devolvió texto.");

          const assistantMessageId = randomUUID();
          let memoryProposal: MemoryProposal | null = null;
          if (!pendingAction) {
            const detected = await memoryDetectionPromise;
            if (detected?.candidate) {
              memoryProposal = createMemoryProposal({
                candidate: detected.candidate,
                userId,
                studioId,
                conversationId: activeConversationId,
                sourceMessageId: assistantMessageId,
                detectorModel: detected.model,
              });
            }
          }

          const { data: assistantRow, error: assistantError } = await supabase
            .from("ai_messages")
            .insert({
              id: assistantMessageId,
              conversation_id: activeConversationId,
              user_id: userId,
              role: "assistant",
              content: assistantMessage,
              metadata: {
                model,
                provider: "gemini",
                mode,
                runId: agentRun.id,
                pendingAction,
                memoryProposal,
                toolCalls: toolTraces,
                usage,
              },
            })
            .select("id")
            .single();

          if (assistantError && (pendingAction || memoryProposal)) {
            throw new Error(`No se pudo guardar la propuesta para revisarla: ${assistantError.message}`);
          }
          if (assistantError) {
            console.error("CLOUVA AI orchestrator: failed to persist the assistant turn", assistantError);
          }

          const pendingActionForClient = pendingAction && assistantRow?.id
            ? pendingToolActionView(pendingAction, assistantRow.id)
            : null;
          const pendingMemoryForClient = memoryProposal && assistantRow?.id
            ? pendingMemoryProposalView(memoryProposal, assistantRow.id)
            : null;

          // Project/tool turns are buffered until the action proposal is
          // safely persisted. Ordinary chat already emitted its real token
          // chunks above.
          if (toolsEnabled && pendingAction) send({ type: "chunk", text: assistantMessage });

          await Promise.all([
            supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", activeConversationId),
            supabase.from("project_events").insert({
              user_id: userId,
              project_key: "clouva",
              event_type: "ai_interaction",
              component: typeof body.screenContext?.page === "string" ? body.screenContext.page : "clouva-ai",
              summary: message.slice(0, 240),
              payload: {
                conversationId: activeConversationId,
                studioId,
                provider: "gemini",
                model,
                mode,
                toolCalls: toolTraces,
                pendingActionId: pendingAction?.id ?? null,
                memoryProposalId: memoryProposal?.id ?? null,
              },
            }),
          ]);

          await finishAgentRun({
            supabase,
            run: agentRun,
            status: pendingAction ? "waiting_confirmation" : "completed",
          });

          send({
            type: "done",
            conversationId: activeConversationId,
            studioId,
            model,
            mode,
            pendingAction: pendingActionForClient,
            pendingMemoryProposal: pendingMemoryForClient,
            toolCalls: toolTraces,
          });
        } catch (error) {
          await finishAgentRun({
            supabase,
            run: agentRun,
            status: "failed",
            errorCode: "AGENT_TURN_FAILED",
            errorMessage: error instanceof Error ? error.message : "CLOUVA AI no respondió.",
          }).catch((auditError) => console.error("CLOUVA AI run finalization failed", auditError));
          send({ type: "error", error: error instanceof Error ? error.message : "CLOUVA AI no respondió." });
        } finally {
          if (router) await router.close().catch((error) => console.error("CLOUVA AI: failed to close tool router", error));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("CLOUVA AI orchestrator error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado en CLOUVA AI." },
      { status: agentHttpStatus(error) },
    );
  }
}
