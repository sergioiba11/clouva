import { NextResponse } from "next/server";
import { authenticateAgentRequest, agentHttpStatus } from "@/lib/clouva-ai/agent/orchestrator";
import {
  getClouvaContext,
  type ClouvaKnowledgeScope,
} from "@/lib/clouva-ai/knowledge/context-service";
import { isAdminEmail } from "@/lib/server/supabase";

export const runtime = "nodejs";

const ALLOWED_SCOPES = new Set<ClouvaKnowledgeScope>([
  "core",
  "player",
  "project",
  "entities",
  "relations",
  "decisions",
  "recent_events",
  "procedures",
  "live_data",
]);

type Body = {
  query?: string;
  conversationId?: string | null;
  studioId?: string | null;
  projectId?: string | null;
  scopes?: string[];
};

export async function POST(request: Request) {
  try {
    const { user, supabase } = await authenticateAgentRequest(request);
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const body = (await request.json()) as Body;
    const query = body.query?.trim();
    if (!query) return NextResponse.json({ error: "Escribí una consulta de contexto." }, { status: 400 });
    if (query.length > 2_000) return NextResponse.json({ error: "La consulta es demasiado larga." }, { status: 413 });

    const scopes = Array.isArray(body.scopes)
      ? body.scopes.filter((scope): scope is ClouvaKnowledgeScope => ALLOWED_SCOPES.has(scope as ClouvaKnowledgeScope))
      : undefined;

    const context = await getClouvaContext({
      supabase,
      userId: user.id,
      conversationId: body.conversationId?.trim() || null,
      studioId: body.studioId?.trim() || null,
      projectId: body.projectId?.trim() || null,
      query,
      requiredScopes: scopes?.length ? scopes : undefined,
      limit: 8,
    });

    return NextResponse.json({ ok: true, context });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo inspeccionar el contexto." },
      { status: agentHttpStatus(error) },
    );
  }
}
