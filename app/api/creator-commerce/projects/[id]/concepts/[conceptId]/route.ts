import { NextRequest, NextResponse } from "next/server";
import { asRecord, short } from "@/lib/creator-commerce/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["draft", "pending", "generating", "review", "approved", "commerce_ready", "published", "failed"]);
const ROLES = new Set(["primary", "secondary"]);
const PRODUCTION_STATUSES = new Set(["not_started", "preparing", "ready"]);
const TEXT_FIELDS = new Set(["name", "product_template", "clothing_item_id", "creator_3d_asset_id"]);
const JSON_ARRAY_FIELDS = new Set(["reference_assets", "generated_assets", "approved_assets", "variants_draft"]);
const JSON_OBJECT_FIELDS = new Set(["creative_config", "design_overrides", "commerce_draft", "listing_copy", "production_data", "metadata"]);

async function fetchConcept(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], projectId: string, conceptId: string) {
  return supabase
    .from("commerce_creator_product_concepts")
    .select("*")
    .eq("id", conceptId)
    .eq("project_id", projectId)
    .maybeSingle();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; conceptId: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id, conceptId } = await params;
    const result = await fetchConcept(supabase, id, conceptId);
    if (result.error) throw new Error(result.error.message);
    if (!result.data) return NextResponse.json({ error: "El producto creativo no existe." }, { status: 404 });
    const product = await supabase
      .from("commerce_products")
      .select("id,slug,status,name,price,currency,stock,cover_url")
      .eq("creator_concept_id", conceptId)
      .maybeSingle();
    if (product.error) throw new Error(product.error.message);
    return NextResponse.json({ concept: { ...result.data, commerce_product: product.data ?? null } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el producto creativo." }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; conceptId: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id, conceptId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };

    for (const field of TEXT_FIELDS) {
      if (!(field in body)) continue;
      if (field === "clothing_item_id" || field === "creator_3d_asset_id") changes[field] = body[field] == null ? null : short(body[field], 80) || null;
      else changes[field] = short(body[field], field === "name" ? 180 : 120) || null;
    }
    for (const field of JSON_ARRAY_FIELDS) {
      if (field in body) changes[field] = Array.isArray(body[field]) ? body[field] : [];
    }
    for (const field of JSON_OBJECT_FIELDS) {
      if (field in body) changes[field] = asRecord(body[field]);
    }
    if (typeof body.status === "string" && STATUSES.has(body.status)) changes.status = body.status;
    if (typeof body.role === "string" && ROLES.has(body.role)) changes.role = body.role;
    if (typeof body.production_status === "string" && PRODUCTION_STATUSES.has(body.production_status)) changes.production_status = body.production_status;
    if ("position" in body) {
      const position = Math.floor(Number(body.position));
      if (Number.isFinite(position) && position >= 0) changes.position = position;
    }

    const { data, error } = await supabase
      .from("commerce_creator_product_concepts")
      .update(changes)
      .eq("id", conceptId)
      .eq("project_id", id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos ese producto creativo o no tenés permiso." }, { status: 404 });
    return NextResponse.json({ concept: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el producto creativo." }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; conceptId: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id, conceptId } = await params;
    const product = await supabase.from("commerce_products").select("id").eq("creator_concept_id", conceptId).maybeSingle();
    if (product.error) throw new Error(product.error.message);
    if (product.data) {
      return NextResponse.json({ error: "Este concepto ya tiene un producto Commerce. Pausá o gestioná ese producto; no lo eliminamos desde Creator." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("commerce_creator_product_concepts")
      .delete()
      .eq("id", conceptId)
      .eq("project_id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos ese producto creativo o no tenés permiso." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el producto creativo." }, { status });
  }
}
