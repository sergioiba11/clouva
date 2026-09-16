import { NextRequest, NextResponse } from "next/server";
import { listContextPacks } from "@/lib/clouva-ai/media/context-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 24);
}

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    return NextResponse.json({ contexts: await listContextPacks(admin, user.id) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) return NextResponse.json({ error: "Poné un nombre de contexto válido.", code: "invalid_name" }, { status: 400 });
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";
    const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 8000) : "";
    const now = new Date().toISOString();
    const { data, error } = await admin.from("clouai_contexts").insert({
      user_id: user.id,
      name,
      description,
      instructions,
      tags: cleanTags(body.tags),
      summary_state: "stale",
      updated_at: now,
    }).select("id,name,description,instructions,tags,summary_json,summary_state,summary_model,summary_updated_at,created_at,updated_at").single();
    if (error || !data) throw new Error("No se pudo crear el contexto.");
    return NextResponse.json({ context: data }, { status: 201 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
