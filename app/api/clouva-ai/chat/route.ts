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

type ChatItem = {
  role: "user" | "assistant";
  content: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
};

const PROJECT_CORE = `
Sos CLOUVA AI, el centro de comando técnico, creativo y operativo del proyecto CLOUVA.

CLOUVA es una plataforma avatar-first que integra:
- avatar 3D modular;
- creación y prueba de ropa, accesorios y merch;
- música, perfiles de artistas y comunidad;
- marketplace de estilos y productos;
- mundos digitales conectados;
- automatizaciones y workers para Blender, rigging y generación 3D;
- integración futura con Unreal Engine 5.

Stack confirmado: Next.js, React, TypeScript, Supabase, Railway, GitHub, Three.js, Blender Worker, Garment Rig Worker y Meshy.

Tu función es ayudar al usuario a manejar y desarrollar todo el proyecto como un copiloto permanente. Debés:
1. diagnosticar errores usando el mensaje, la pantalla actual, la memoria y los eventos disponibles;
2. explicar la causa probable antes de proponer cambios;
3. dar soluciones concretas, ordenadas y aplicables;
4. ayudar a diseñar e implementar funciones nuevas sin romper lo existente;
5. tener en cuenta arquitectura, usuarios, avatares, prendas, workers, APIs, base de datos, costos y experiencia móvil;
6. recordar decisiones, soluciones, incidentes y preferencias durables mediante la memoria del proyecto;
7. diferenciar claramente hechos confirmados, inferencias y datos faltantes;
8. nunca afirmar que viste archivos, logs, Railway, Supabase, GitHub o una pantalla si ese contenido no fue realmente incluido en el contexto;
9. nunca afirmar que ejecutaste, publicaste o corregiste algo si solamente propusiste instrucciones;
10. pedir confirmación antes de borrar datos, publicar, gastar créditos, rotar claves o hacer acciones irreversibles.

No expongas claves, tokens ni secretos. No sugieras poner secretos en variables NEXT_PUBLIC_.
Respondé en español rioplatense, directo, claro y práctico.
`.trim();

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan las variables públicas de Supabase.");

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function extractGeminiText(data: GeminiResponse) {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

async function callGemini(input: ChatItem[], instructions: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

  if (!apiKey) throw new Error("Falta GEMINI_API_KEY en Railway.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: instructions }],
          },
          contents: input.map((item) => ({
            role: item.role === "assistant" ? "model" : "user",
            parts: [{ text: item.content }],
          })),
          generationConfig: {
            temperature: 0.65,
            maxOutputTokens: 4096,
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    let data: GeminiResponse = {};

    try {
      data = raw ? (JSON.parse(raw) as GeminiResponse) : {};
    } catch {
      // Conservamos el texto crudo para mostrar un error útil.
    }

    if (!response.ok) {
      throw new Error(
        data.error?.message || raw || `Gemini respondió HTTP ${response.status}`,
      );
    }

    return extractGeminiText(data);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini tardó demasiado en responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function captureMemory(args: {
  supabase: ReturnType<typeof getSupabase>;
  userId: string;
  projectKey: string;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
}) {
  const memoryPrompt = `
Analizá el intercambio y devolvé únicamente JSON válido, sin markdown.
Guardá solo información durable y confirmada del proyecto: decisiones, arquitectura,
procedimientos, incidentes, soluciones, objetivos o preferencias importantes.
No guardes saludos, hipótesis, secretos, claves, tokens ni datos casuales.

Formato exacto:
{"save":boolean,"memory_type":"decision|fact|procedure|incident|solution|preference|architecture|goal","title":"...","content":"...","importance":1}

Si no hay nada durable:
{"save":false,"memory_type":"fact","title":"","content":"","importance":1}
`.trim();

  try {
    const raw = await callGemini(
      [
        {
          role: "user",
          content: `USUARIO:\n${args.userMessage}\n\nASISTENTE:\n${args.assistantMessage}`,
        },
      ],
      memoryPrompt,
    );

    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "")
      .trim();

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
      metadata: { captured_by: "clouva-ai", provider: "gemini" },
    });
  } catch (error) {
    console.error("CLOUVA AI memory capture failed", error);
  }
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!accessToken) {
      return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
    }

    const body = (await request.json()) as ChatRequest;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });
    }

    if (message.length > 20_000) {
      return NextResponse.json(
        { error: "El mensaje es demasiado largo." },
        { status: 413 },
      );
    }

    const projectKey = body.projectKey?.trim() || "clouva";
    const supabase = getSupabase(accessToken);
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
    }

    const userId = authData.user.id;
    let conversationId = body.conversationId ?? null;

    if (conversationId) {
      const { data } = await supabase
        .from("ai_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!data) conversationId = null;
    }

    if (!conversationId) {
      const { data, error } = await supabase
        .from("ai_conversations")
        .insert({
          user_id: userId,
          project_key: projectKey,
          title: message.slice(0, 72),
        })
        .select("id")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "No se pudo crear la conversación.");
      }

      conversationId = data.id;
    }

    if (!conversationId) {
      throw new Error("No se pudo resolver la conversación activa.");
    }

    const activeConversationId: string = conversationId;

    await supabase.from("ai_messages").insert({
      conversation_id: activeConversationId,
      user_id: userId,
      role: "user",
      content: message,
      metadata: { screenContext: body.screenContext ?? {} },
    });

    const [
      { data: recentMessages },
      { data: memories },
      { data: recentEvents },
    ] = await Promise.all([
      supabase
        .from("ai_messages")
        .select("role,content,created_at")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: false })
        .limit(24),
      supabase
        .from("project_memory")
        .select("memory_type,title,content,importance,updated_at")
        .eq("user_id", userId)
        .eq("project_key", projectKey)
        .eq("status", "active")
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(40),
      supabase
        .from("project_events")
        .select("event_type,component,summary,payload,created_at")
        .eq("user_id", userId)
        .eq("project_key", projectKey)
        .order("created_at", { ascending: false })
        .limit(24),
    ]);

    const memoryContext = (memories ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");

    const eventContext = (recentEvents ?? [])
      .map(
        (item) =>
          `[${item.created_at}] ${item.event_type}/${item.component ?? "general"}: ${item.summary}`,
      )
      .join("\n");

    const screenContext = JSON.stringify(body.screenContext ?? {}, null, 2);

    const instructions = `${PROJECT_CORE}

CONTEXTO REAL DE LA PANTALLA ACTUAL:
${screenContext}

MEMORIA CONFIRMADA DEL PROYECTO:
${memoryContext || "Todavía no hay memoria guardada."}

EVENTOS RECIENTES DEL PROYECTO:
${eventContext || "No hay eventos recientes registrados."}

Usá primero los hechos confirmados. Para diagnosticar un problema, indicá: qué entendiste,
causa probable, comprobación recomendada y solución. Para funciones nuevas, indicá impacto,
archivos o componentes probables, datos necesarios y criterios para validar que quedó bien.
Cuando no tengas acceso real a un archivo, log, servicio o repositorio, pedilo o explicá cómo obtenerlo.`;

    const input: ChatItem[] = (recentMessages ?? [])
      .reverse()
      .map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.content,
      }));

    const assistantMessage = await callGemini(input, instructions);

    if (!assistantMessage) {
      throw new Error("Gemini no devolvió texto.");
    }

    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

    await Promise.all([
      supabase.from("ai_messages").insert({
        conversation_id: activeConversationId,
        user_id: userId,
        role: "assistant",
        content: assistantMessage,
        metadata: { model, provider: "gemini" },
      }),
      supabase
        .from("ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", activeConversationId),
      supabase.from("project_events").insert({
        user_id: userId,
        project_key: projectKey,
        event_type: "ai_interaction",
        component:
          typeof body.screenContext?.page === "string"
            ? body.screenContext.page
            : "clouva-ai",
        summary: message.slice(0, 240),
        payload: {
          conversationId: activeConversationId,
          provider: "gemini",
          model,
        },
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
      provider: "gemini",
      model,
    });
  } catch (error) {
    console.error("CLOUVA AI chat error", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error inesperado en CLOUVA AI.",
      },
      { status: 500 },
    );
  }
}
