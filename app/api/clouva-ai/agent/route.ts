import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { buildRepositoryContext, deterministicRepositoryFallback } from "@/lib/clouva-ai/repository-context";
import { generateWithFallback, selectedModelFromRequest } from "@/lib/clouva-ai/gemini-text";
import { isAdminEmail } from "@/lib/server/supabase";
import {
  CLOUVA_PRODUCT_CONTEXT,
  CLOUVA_REPOSITORY_AGENT_PROMPT,
} from "@/lib/clouva-ai/vision";

// LEGACY — kept working (per the approved migration plan) while
// app/api/clouva-ai/chat/route.ts becomes the canonical Orchestrator.
// components/clouva-ai/ClouvaAIChat.tsx no longer calls this route; nothing
// else does either as of this change. Repository-context gathering lives in
// lib/clouva-ai/repository-context.ts now, shared with the Orchestrator's
// own "project" mode — this file no longer keeps its own copy.

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };
type RequestBody = {
  message?: string;
  history?: ChatMessage[];
  screenContext?: Record<string, unknown>;
};
type PendingAction = {
  type: "write_file";
  path: string;
  content: string;
  message: string;
  summary: string;
};

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Faltan variables públicas de Supabase.");
  }

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!accessToken) throw new Error("Sesión requerida.");

  const supabase = getSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida.");

  if (!isAdminEmail(data.user.email)) {
    throw new Error("Usuario no autorizado para el modo Proyecto.");
  }

  return { supabase, user: data.user };
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const body = (await request.json()) as RequestBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en el servicio de Cloud Run.");

    const selectedModel = selectedModelFromRequest(request);

    const [{ data: memories }, repositoryContext] = await Promise.all([
      supabase
        .from("project_memory")
        .select("memory_type,title,content,importance")
        .eq("user_id", user.id)
        .eq("project_key", "clouva")
        .eq("status", "active")
        .order("importance", { ascending: false })
        .limit(12),
      buildRepositoryContext(message),
    ]);

    const memoryText = (memories ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");

    const instruction = `${CLOUVA_REPOSITORY_AGENT_PROMPT}\n\nMEMORIA PERSISTENTE DEL PROYECTO\n${memoryText || "Sin memoria adicional guardada."}\n\nALCANCE OBTENIDO EN ESTA CONSULTA\n${JSON.stringify({
      scope: repositoryContext.scope,
      coverageAreas: repositoryContext.coverageAreas,
      repositoryStatus: repositoryContext.status,
      filesReviewed: repositoryContext.files.map((file) => file.path),
    })}\n\nCONTEXTO REAL DE GITHUB\n${JSON.stringify(repositoryContext)}\n\nCONTEXTO DE PANTALLA\n${JSON.stringify(body.screenContext ?? {})}\n\nRecordatorio de visión estable:\n${CLOUVA_PRODUCT_CONTEXT}`;

    const contents: Array<Record<string, unknown>> = [
      ...(body.history ?? []).slice(-6).map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 6000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    let result: {
      text: string;
      model: string;
      usage: Record<string, unknown> | null;
    } | null = null;

    try {
      result = await generateWithFallback({
        apiKey,
        selectedModel,
        instruction,
        contents,
        temperature: 0.25,
        maxOutputTokens: 6000,
      });
    } catch (error) {
      if (!repositoryContext.files.length) throw error;
    }

    const pendingAction: PendingAction | null = null;

    return NextResponse.json({
      ok: true,
      message: result?.text ?? deterministicRepositoryFallback(repositoryContext),
      pendingAction,
      model: result?.model ?? selectedModel,
      usage: result?.usage ?? null,
      analysisScope: repositoryContext.scope,
      coverageAreas: repositoryContext.coverageAreas,
      filesReviewed: repositoryContext.files.map((file) => file.path),
      assistant: "Trébol — CLOUVA AI",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error inesperado en el agente.",
      },
      { status: 500 },
    );
  }
}
