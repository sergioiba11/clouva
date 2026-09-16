import { NextRequest, NextResponse } from "next/server";
import { compilePromptWithContext } from "@/lib/clouva-ai/media/context-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "Escribí un prompt primero.", code: "prompt_required" }, { status: 400 });
    const mode = body.mode === "video" ? "video" : "image";
    const contextIds = Array.isArray(body.contextIds) ? body.contextIds.filter((value): value is string => typeof value === "string").slice(0, 12) : [];
    const result = await compilePromptWithContext(admin, user.id, { mode, prompt: prompt.slice(0, 4000), contextIds });
    return NextResponse.json({
      enrichedPrompt: result.enrichedPrompt,
      activeReferences: result.bundle.activeReferences.map((asset) => ({ id: asset.id, name: asset.name, contextId: asset.contextId })),
      contexts: result.bundle.contexts.map((context) => ({ id: context.id, name: context.name, summaryState: context.summaryState })),
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
