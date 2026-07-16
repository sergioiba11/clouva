import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getRepositoryStatus,
  readRepositoryFile,
  writeRepositoryFile,
} from "@/lib/clouva-ai/github";

export const runtime = "nodejs";
export const maxDuration = 60;

type GitHubRequest = {
  action?: "status" | "read" | "write";
  path?: string;
  content?: string;
  message?: string;
  confirm?: boolean;
};

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan variables públicas de Supabase.");

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

  const allowedEmails = (process.env.CLOUVA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  const email = data.user.email?.toLowerCase();
  if (!email || !allowedEmails.includes(email)) {
    throw new Error("Tu usuario no está autorizado para modificar el repositorio.");
  }

  return { user: data.user, supabase };
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const status = await getRepositoryStatus();
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error de GitHub." },
      { status: 403 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user, supabase } = await requireAdmin(request);
    const body = (await request.json()) as GitHubRequest;

    if (body.action === "status") {
      return NextResponse.json({ ok: true, status: await getRepositoryStatus() });
    }

    if (body.action === "read") {
      if (!body.path?.trim()) {
        return NextResponse.json({ error: "Falta la ruta del archivo." }, { status: 400 });
      }
      const file = await readRepositoryFile(body.path);
      return NextResponse.json({ ok: true, file });
    }

    if (body.action === "write") {
      if (!body.confirm) {
        return NextResponse.json(
          { error: "La escritura requiere confirmación explícita." },
          { status: 409 },
        );
      }
      if (!body.path?.trim() || typeof body.content !== "string") {
        return NextResponse.json(
          { error: "Faltan ruta o contenido del archivo." },
          { status: 400 },
        );
      }

      const result = await writeRepositoryFile({
        path: body.path,
        content: body.content,
        message: body.message?.trim() || `chore: actualizar ${body.path}`,
      });

      await supabase.from("project_events").insert({
        user_id: user.id,
        project_key: "clouva",
        event_type: "github_write",
        component: body.path,
        summary: body.message?.trim() || `Actualización de ${body.path}`,
        payload: {
          commitSha: result.commitSha,
          branch: result.branch,
          path: result.path,
        },
      });

      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error de GitHub." },
      { status: 500 },
    );
  }
}
