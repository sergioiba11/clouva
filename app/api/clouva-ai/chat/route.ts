import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatRequest = {
  message?: string;
  conversationId?: string | null;
  projectKey?: string;
  screenContext?: Record<string, unknown>;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

const PROJECT_CORE = `
CLOUVA es una plataforma avatar-first que integra avatares 3D, música, merch, comunidad, marketplace y mundos.
Stack actual: Next.js, React, Supabase, Railway, GitHub, Blender Worker y una integración futura con Unreal Engine 5.
El asistente debe actuar como centro de comando técnico y creativo del proyecto: explicar con claridad, usar el contexto real disponible, registrar decisiones y soluciones útiles, y nunca inventar que una acción o deploy ocurrió.
Reglas críticas: no exponer claves ni tokens; pedir confirmación antes de borrar, publicar, gastar créditos o ejecutar acciones irreversibles; distinguir hechos confirmados de hipótesis.
`;

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan las variables públicas de Supabase.");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function extractOutputText(data: OpenAIResponse) {
  if (data.output_text?.trim()) return data.output_text.trim();
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function callOpenAI(input: unknown, instructions: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en Railway.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5",
      instructions,
      input,
      store: false,
    }),
    cache: "no-store",
  });

  const raw = await response.text();
  let data: OpenAIResponse & { error?: { message?: string } } = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* keep empty */ }
  if (!response.ok) throw new Error(data.error?.message ?? raw ?? `OpenAI respondió HTTP ${response.status}`);
  return extractOutputText(data);
}

async function captureMemory(args: {
  supabase: ReturnType<typeof getSupabase>;
  userId: string;
  projectKey: string;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
}) {
  const memoryPrompt = `Analizá este intercambio y devolvé SOLO JSON válido. Guardá únicamente información durable y confirmada del proyecto. No guardes saludos, hipótesis, secretos, tokens ni datos casuales.
Formato exacto:
{"save":boolean,"memory_type":"decision|fact|procedure|incident|solution|preference|architecture|goal","title":"...","content":"...","importance":1}
Si no hay nada durable: {"save":false,"memory_type":"fact","title":"","content":"","importance":1}`;

  try {
    const raw = await callOpenAI([
      { role: "user", content: `USUARIO:\n${args.userMessage}\n\nASISTENTE:\n${args.assistantMessage}` },
    ], memoryPrompt);
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const memory = JSON.parse(cleaned) as {
      save?: boolean;
      memory_type?: string;
      title?: string;
      content?: string;
      importance?: number;
    };
    if (!memory.save || !memory.title || !memory.content) return;

    await args.supabase.from("project_memory").insert({
      user_id: args.userId,
      project_key: args.projectKey,
      memory_type: memory.memory_type ?? "fact",
      title: memory.title.slice(0, 180),
      content: memory.content,
      importance: Math.max(1, Math.min(5, Number(memory.importance ?? 3))),
      source_conversation_id: args.conversationId,
      metadata: { captured_by: "clouva-ai" },
    });
  } catch (error) {
    console.error("CLOUVA AI memory capture failed", error);
  }
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!accessToken) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

    const body = await request.json() as ChatRequest;
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });
    if (message.length > 20_000) return NextResponse.json({ error: "El mensaje es demasiado largo." }, { status: 413 });

    const projectKey = body.projectKey?.trim() || "clouva";
    const supabase = getSupabase(accessToken);
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
    const userId = authData.user.id;

    let conversationId = body.conversationId ?? null;
    if (conversationId) {
      const { data } = await supabase.from("ai_conversations").select("id").eq("id", conversationId).eq("user_id", userId).maybeSingle();
      if (!data) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await supabase.from("ai_conversations").insert({
        user_id: userId,
        project_key: projectKey,
        title: message.slice(0, 72),
      }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "No se pudo crear la conversación.");
      conversationId = data.id;
    }
    if (!conversationId) throw new Error("No se pudo resolver la conversación activa.");

    const activeConversationId: string = conversationId;

    await supabase.from("ai_messages").insert({
      conversation_id: activeConversationId,
      user_id: userId,
      role: "user",
      content: message,
      metadata: { screenContext: body.screenContext ?? {} },
    });

    const [{ data: recentMessages }, { data: memories }, { data: recentEvents }] = await Promise.all([
      supabase.from("ai_messages").select("role,content,created_at").eq("conversation_id", activeConversationId).order("created_at", { ascending: false }).limit(16),
      supabase.from("project_memory").select("memory_type,title,content,importance,updated_at").eq("user_id", userId).eq("project_key", projectKey).eq("status", "active").order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(24),
      supabase.from("project_events").select("event_type,component,summary,payload,created_at").eq("user_id", userId).eq("project_key", projectKey).order("created_at", { ascending: false }).limit(12),
    ]);

    const memoryContext = (memories ?? []).map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`).join("\n");
    const eventContext = (recentEvents ?? []).map((item) => `[${item.created_at}] ${item.event_type}/${item.component ?? "general"}: ${item.summary}`).join("\n");
    const screenContext = JSON.stringify(body.screenContext ?? {});

    const instructions = `${PROJECT_CORE}
CONTEXTO DE PANTALLA ACTUAL:\n${screenContext}
MEMORIA CONFIRMADA DEL PROYECTO:\n${memoryContext || "Todavía no hay memoria guardada."}
EVENTOS RECIENTES:\n${eventContext || "No hay eventos recientes registrados."}
Respondé en español rioplatense, directo y accionable. Cuando no tengas acceso real a algo, decilo. No afirmes que ejecutaste una acción si no ocurrió.`;

    const input = (recentMessages ?? []).reverse().map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));

    const assistantMessage = await callOpenAI(input, instructions);
    if (!assistantMessage) throw new Error("OpenAI no devolvió texto.");

    await Promise.all([
      supabase.from("ai_messages").insert({
        conversation_id: activeConversationId,
        user_id: userId,
        role: "assistant",
        content: assistantMessage,
        metadata: { model: process.env.OPENAI_MODEL ?? "gpt-5" },
      }),
      supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", activeConversationId),
      supabase.from("project_events").insert({
        user_id: userId,
        project_key: projectKey,
        event_type: "ai_interaction",
        component: typeof body.screenContext?.page === "string" ? body.screenContext.page : "clouva-ai",
        summary: message.slice(0, 240),
        payload: { conversationId: activeConversationId },
      }),
    ]);

    void captureMemory({
      supabase,
      userId,
      projectKey,
      conversationId: activeConversationId,
      userMessage: message,
      assistantMessage,
    });

    return NextResponse.json({
      ok: true,
      conversationId: activeConversationId,
      message: assistantMessage,
    });
  } catch (error) {
    console.error("CLOUVA AI chat error", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Error inesperado en CLOUVA AI.",
    }, { status: 500 });
  }
}
