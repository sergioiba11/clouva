import { NextRequest, NextResponse } from "next/server";
import { WorkspaceExecutor } from "@/lib/clouva-ai/workspace-executor";
import { isAdminEmail, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type NetworkAction = "snapshot" | "discover" | "inspect" | "trace";

type Body = {
  action?: NetworkAction;
  subnet?: string;
  target?: string;
};

function requireAdmin(email: string | null | undefined) {
  if (!isAdminEmail(email)) {
    const error = new Error("Tu usuario no está autorizado para abrir el mapa de red.") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

function normalize(value: string | undefined, max = 255) {
  return value?.trim().slice(0, max) || undefined;
}

async function runWorkspaceTool(
  executor: WorkspaceExecutor,
  name: string,
  args: Record<string, unknown>,
) {
  const tool = executor.getTool(name);
  if (!tool) throw new Error(`La herramienta '${name}' no está registrada en Workspace.`);
  return tool.execute(args);
}

async function execute(request: NextRequest, body: Body) {
  const { user } = await requireUser(request);
  requireAdmin(user.email);

  const action = body.action ?? "snapshot";
  const executor = new WorkspaceExecutor(user.id);

  try {
    if (action === "snapshot") {
      return await runWorkspaceTool(executor, "workspace.network.snapshot", {});
    }

    if (action === "discover") {
      const subnet = normalize(body.subnet, 64);
      return await runWorkspaceTool(executor, "workspace.network.discover", subnet ? { subnet } : {});
    }

    if (action === "inspect") {
      const target = normalize(body.target, 253);
      if (!target) {
        const error = new Error("Falta el host local a inspeccionar.") as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      return await runWorkspaceTool(executor, "workspace.network.inspect", { target });
    }

    if (action === "trace") {
      const target = normalize(body.target, 253);
      if (!target) {
        const error = new Error("Falta el destino para trazar la ruta.") as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      return await runWorkspaceTool(executor, "workspace.network.trace", { target });
    }

    const error = new Error("Acción de red no soportada.") as Error & { status?: number };
    error.status = 400;
    throw error;
  } finally {
    await executor.close();
  }
}

export async function GET(request: NextRequest) {
  try {
    const result = await execute(request, { action: "snapshot" });
    return NextResponse.json({ ok: true, action: "snapshot", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer la red desde Workspace.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 502);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const result = await execute(request, body);
    return NextResponse.json({ ok: true, action: body.action ?? "snapshot", result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo ejecutar la herramienta de red.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 502);
    return NextResponse.json({ error: message }, { status });
  }
}
