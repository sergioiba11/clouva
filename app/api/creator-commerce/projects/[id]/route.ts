import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_FIELDS = new Set([
  "name", "collection_name", "category", "product_template", "brief", "source_type", "source_ref",
  "clothing_item_id", "creator_3d_asset_id",
]);
const JSON_FIELDS = new Set([
  "design_system", "reference_assets", "generated_assets", "approved_assets", "commerce_draft", "variants_draft", "metadata",
]);
const OWNER_TYPES = new Set(["player", "studio", "user", "clouva"]);
const CREATIVE_MODES = new Set(["from_scratch", "exact_design", "reference"]);
const STATUSES = new Set(["draft", "generating", "review", "approved", "commerce_ready"]);

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const { data, error } = await supabase.from("commerce_creator_projects").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });
    return NextResponse.json({ project: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el proyecto." }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };

    for (const field of TEXT_FIELDS) {
      if (!(field in body)) continue;
      const max = field === "brief" ? 4000 : field === "source_ref" ? 500 : 180;
      changes[field] = body[field] == null ? null : short(body[field], max) || null;
    }
    for (const field of JSON_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];
      if (field.endsWith("_assets") || field === "variants_draft") changes[field] = Array.isArray(value) ? value : [];
      else changes[field] = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    if (typeof body.owner_type === "string" && OWNER_TYPES.has(body.owner_type)) {
      const ownerType = body.owner_type;
      changes.owner_type = ownerType;
      changes.player_id = ownerType === "player" ? short(body.player_id, 80) || null : null;
      changes.studio_id = ownerType === "studio" ? short(body.studio_id, 80) || null : null;
      if (ownerType === "player" && !changes.player_id) return NextResponse.json({ error: "Falta el Player vendedor." }, { status: 400 });
      if (ownerType === "studio" && !changes.studio_id) return NextResponse.json({ error: "Falta el Studio vendedor." }, { status: 400 });
    }
    if ("spot_id" in body) changes.spot_id = short(body.spot_id, 80) || null;
    if (typeof body.creative_mode === "string" && CREATIVE_MODES.has(body.creative_mode)) changes.creative_mode = body.creative_mode;
    if (typeof body.status === "string" && STATUSES.has(body.status)) changes.status = body.status;

    const { data, error } = await supabase
      .from("commerce_creator_projects")
      .update(changes)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos ese proyecto o no tenés permiso." }, { status: 404 });
    return NextResponse.json({ project: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el proyecto." }, { status });
  }
}
