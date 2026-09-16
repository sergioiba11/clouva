import { NextRequest, NextResponse } from "next/server";
import { deleteGeneratedMedia } from "@/lib/gcs-media";
import { getContextPack } from "@/lib/clouva-ai/media/context-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 24);
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const pack = await getContextPack(admin, user.id, id);
    if (!pack) return NextResponse.json({ error: "El contexto no existe.", code: "context_not_found" }, { status: 404 });
    return NextResponse.json(pack);
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), summary_state: "stale" };
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name || name.length > 120) return NextResponse.json({ error: "Nombre inválido.", code: "invalid_name" }, { status: 400 });
      updates.name = name;
    }
    if (typeof body.description === "string") updates.description = body.description.trim().slice(0, 4000);
    if (typeof body.instructions === "string") updates.instructions = body.instructions.trim().slice(0, 8000);
    const tags = cleanTags(body.tags);
    if (tags) updates.tags = tags;

    const { data, error } = await admin.from("clouai_contexts").update(updates).eq("id", id).eq("user_id", user.id)
      .select("id,name,description,instructions,tags,summary_json,summary_state,summary_model,summary_updated_at,created_at,updated_at").maybeSingle();
    if (error) throw new Error("No se pudo actualizar el contexto.");
    if (!data) return NextResponse.json({ error: "El contexto no existe.", code: "context_not_found" }, { status: 404 });
    return NextResponse.json({ context: data });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const pack = await getContextPack(admin, user.id, id);
    if (!pack) return NextResponse.json({ error: "El contexto no existe.", code: "context_not_found" }, { status: 404 });

    const { error } = await admin.from("clouai_contexts").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw new Error("No se pudo eliminar el contexto.");
    await Promise.allSettled(pack.assets.map((asset) => deleteGeneratedMedia(asset.storagePath)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
