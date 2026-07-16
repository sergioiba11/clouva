import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readRepositoryFile } from "@/lib/clouva-ai/github";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = { message?: string; path?: string };

function getClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Faltan variables de Supabase.");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readWithRetry(path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await readRepositoryFile(path);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await wait(attempt === 0 ? 700 : 1600);
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });

    const supabase = getClient(token);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });

    const body = (await request.json()) as Body;
    const path = body.path?.trim();
    const message = body.message?.trim();
    if (!path || !message) return NextResponse.json({ error: "Falta el archivo o el mensaje." }, { status: 400 });

    const file = await readWithRetry(path);
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en Railway.");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "Sos CLOUVA AI. Analizá el archivo real recibido y respondé en español rioplatense, claro y práctico. No inventes datos ni propongas cambios si el usuario pidió solo lectura." }],
          },
          contents: [{
            role: "user",
            parts: [{ text: `${message}\n\nARCHIVO REAL: ${file.path}\n\n${file.content.slice(0, 60000)}` }],
          }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
        cache: "no-store",
      },
    );

    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message ?? `Gemini respondió HTTP ${response.status}`);

    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();

    return NextResponse.json({
      ok: true,
      message: text || `Leí ${file.path}, pero Gemini no generó una explicación.`,
      path: file.path,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo leer el archivo." },
      { status: 500 },
    );
  }
}
