import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getRepositoryStatus } from "@/lib/clouva-ai/github";
import { isAdminEmail } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan variables públicas de Supabase.");

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireProjectAccess(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!accessToken) throw new Error("Sesión requerida.");

  const supabase = getSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida.");

  if (!isAdminEmail(data.user.email)) {
    throw new Error("Tu usuario no está autorizado para acceder al repositorio de CLOUVA.");
  }
}

/**
 * This legacy endpoint is intentionally read-only. Every GitHub mutation is
 * proposed by the Orchestrator and executed by GitHubExecutor only after the
 * persisted ToolConfirmationGate has resolved the proposal.
 */
export async function GET(request: Request) {
  try {
    await requireProjectAccess(request);
    const status = await getRepositoryStatus();
    return NextResponse.json(
      { ok: true, status },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error de GitHub." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
