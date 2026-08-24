import { NextRequest, NextResponse } from "next/server";
import { CLOUVA_CHAT_SYSTEM_PROMPT } from "@/lib/clouva-ai/vision";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AUTH_TOKEN_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const MAX_CONTEXT_MESSAGES = 24;
const MAX_MEMORIES = 40;
const MAX_EVENTS = 20;

type VoiceSessionBody = {
  conversationId?: string | null;
  projectKey?: string;
};

type AuthTokenResponse = {
  name?: string;
  expireTime?: string;
  newSessionExpireTime?: string;
  error?: { message?: string; code?: number; status?: string };
};

function normalizeModel(value: string | undefined) {
  const model = value?.trim() || DEFAULT_LIVE_MODEL;
  if (!/^gemini-[a-z0-9._-]+$/i.test(model)) {
    throw new Error("GEMINI_LIVE_MODEL tiene un formato inválido.");
  }
  return model;
}

async function resolveConversation(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  userId: string;
  projectKey: string;
  requestedId?: string | null;
}) {
  if (args.requestedId) {
    const { data, error } = await args.admin
      .from("ai_conversations")
      .select("id,title,created_at")
      .eq("id", args.requestedId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (error) throw new Error("No se pudo verificar la conversación activa.");
    if (data) return data;
  }

  const { data, error } = await args.admin
    .from("ai_conversations")
    .insert({
      user_id: args.userId,
      project_key: args.projectKey,
      title: "Conversación por voz",
    })
    .select("id,title,created_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo crear la conversación de voz.");
  return data;
}

function compactContext(items: Array<{ role?: string; content?: string }> | null) {
  return (items ?? [])
    .filter((item) => typeof item.content === "string" && item.content.trim())
    .map((item) => `${item.role === "assistant" ? "TRÉBOL" : "USUARIO"}: ${item.content?.trim()}`)
    .join("\n");
}

export async function POST(request: NextRequest) {
  try {
    const authenticated = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as VoiceSessionBody;
    const projectKey = body.projectKey?.trim() || "clouva";
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });
    }

    const model = normalizeModel(process.env.GEMINI_LIVE_MODEL);
    const admin = createAdminSupabase();
    const conversation = await resolveConversation({
      admin,
      userId: authenticated.user.id,
      projectKey,
      requestedId: body.conversationId,
    });

    const [messagesResult, memoriesResult, eventsResult] = await Promise.all([
      admin
        .from("ai_messages")
        .select("role,content,created_at")
        .eq("conversation_id", conversation.id)
        .eq("user_id", authenticated.user.id)
        .order("created_at", { ascending: false })
        .limit(MAX_CONTEXT_MESSAGES),
      admin
        .from("project_memory")
        .select("memory_type,title,content,importance,updated_at")
        .eq("user_id", authenticated.user.id)
        .eq("project_key", projectKey)
        .eq("status", "active")
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(MAX_MEMORIES),
      admin
        .from("project_events")
        .select("event_type,component,summary,created_at")
        .eq("user_id", authenticated.user.id)
        .eq("project_key", projectKey)
        .order("created_at", { ascending: false })
        .limit(MAX_EVENTS),
    ]);

    if (messagesResult.error || memoriesResult.error || eventsResult.error) {
      throw new Error("No se pudo preparar el contexto compartido de Trébol.");
    }

    const messageContext = compactContext([...(messagesResult.data ?? [])].reverse());
    const memoryContext = (memoriesResult.data ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");
    const eventContext = (eventsResult.data ?? [])
      .map((item) => `[${item.created_at}] ${item.event_type}/${item.component ?? "general"}: ${item.summary}`)
      .join("\n");

    const systemInstruction = `${CLOUVA_CHAT_SYSTEM_PROMPT}\n\nCANAL ACTUAL: VOZ EN TIEMPO REAL\nSos el mismo Trébol del chat de CLOUVA, no otro asistente. Respondé de forma natural para audio, sin leer markdown, URLs largas ni bloques de código salvo que el usuario los pida. Conservá el contexto de la conversación y de CLOUVA. Si una acción requiere confirmación en el chat, explicalo brevemente por voz.\n\nMEMORIA CONFIRMADA DEL PROYECTO:\n${memoryContext || "Sin memoria adicional guardada."}\n\nEVENTOS RECIENTES:\n${eventContext || "Sin eventos recientes."}\n\nHISTORIAL RECIENTE DE ESTA MISMA CONVERSACIÓN:\n${messageContext || "La conversación todavía no tiene turnos guardados."}`;

    const now = Date.now();
    const tokenRequest = {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      bidiGenerateContentSetup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: {},
      },
    };

    const tokenResponse = await fetch(AUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(tokenRequest),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const tokenPayload = (await tokenResponse.json().catch(() => ({}))) as AuthTokenResponse;
    if (!tokenResponse.ok || !tokenPayload.name) {
      throw new Error(tokenPayload.error?.message ?? `Gemini Live no pudo crear la sesión (HTTP ${tokenResponse.status}).`);
    }

    console.info("AI_VOICE_SESSION_CREATED", {
      conversationId: conversation.id,
      userId: authenticated.user.id,
      provider: "gemini-live",
      model,
    });

    return NextResponse.json({
      ok: true,
      conversationId: conversation.id,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.created_at,
      },
      provider: "gemini-live",
      model,
      token: tokenPayload.name,
      expiresAt: tokenPayload.expireTime ?? tokenRequest.expireTime,
      newSessionExpiresAt: tokenPayload.newSessionExpireTime ?? tokenRequest.newSessionExpireTime,
    });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    const message = error instanceof Error ? error.message : "No se pudo iniciar Gemini Live.";
    console.error("AI_VOICE_SESSION_ERROR", { message });
    return NextResponse.json({ error: message }, { status });
  }
}
