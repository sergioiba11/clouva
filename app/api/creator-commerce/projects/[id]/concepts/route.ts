import { NextRequest, NextResponse } from "next/server";
import { asRecord, short } from "@/lib/creator-commerce/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConceptInput = {
  name?: unknown;
  product_template?: unknown;
  role?: unknown;
  position?: unknown;
  creative_config?: unknown;
  design_overrides?: unknown;
};

function position(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const project = await supabase.from("commerce_creator_projects").select("id").eq("id", id).maybeSingle();
    if (project.error) throw new Error(project.error.message);
    if (!project.data) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });

    const conceptsResult = await supabase
      .from("commerce_creator_product_concepts")
      .select("*")
      .eq("project_id", id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (conceptsResult.error) throw new Error(conceptsResult.error.message);
    const concepts = conceptsResult.data ?? [];
    const conceptIds = concepts.map((concept) => concept.id);

    const productsResult = conceptIds.length
      ? await supabase
          .from("commerce_products")
          .select("id,creator_concept_id,slug,status,name,price,currency,stock,cover_url")
          .in("creator_concept_id", conceptIds)
      : { data: [], error: null };
    if (productsResult.error) throw new Error(productsResult.error.message);
    const products = new Map((productsResult.data ?? []).map((product) => [product.creator_concept_id, product]));

    return NextResponse.json({
      concepts: concepts.map((concept) => ({ ...concept, commerce_product: products.get(concept.id) ?? null })),
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los productos del drop." }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { concepts?: ConceptInput[] } & ConceptInput;
    const project = await supabase.from("commerce_creator_projects").select("id,user_id").eq("id", id).maybeSingle();
    if (project.error) throw new Error(project.error.message);
    if (!project.data) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });

    const existing = await supabase
      .from("commerce_creator_product_concepts")
      .select("id,role,position")
      .eq("project_id", id)
      .order("position", { ascending: false });
    if (existing.error) throw new Error(existing.error.message);

    const inputs = Array.isArray(body.concepts) && body.concepts.length ? body.concepts : [body];
    if (inputs.length > 20) return NextResponse.json({ error: "Podés agregar hasta 20 productos por vez." }, { status: 400 });
    const highestPosition = existing.data?.[0]?.position ?? -1;
    const hasPrimary = (existing.data ?? []).some((item) => item.role === "primary");

    const rows = inputs.map((input, index) => {
      const template = short(input.product_template, 120) || "custom";
      const name = short(input.name, 180) || `${template} ${index + 1}`;
      return {
        project_id: id,
        user_id: user.id,
        name,
        product_template: template,
        role: !hasPrimary && index === 0 ? "primary" : "secondary",
        position: position(input.position, highestPosition + index + 1),
        creative_config: asRecord(input.creative_config),
        design_overrides: asRecord(input.design_overrides),
        updated_at: new Date().toISOString(),
      };
    });

    const { data, error } = await supabase
      .from("commerce_creator_product_concepts")
      .insert(rows)
      .select("*");
    if (error) throw new Error(error.message);
    return NextResponse.json({ concepts: data ?? [] }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron agregar productos al drop." }, { status });
  }
}
