import { NextRequest, NextResponse } from "next/server";
import {
  prepareCreatorConceptProduct,
  type CreatorConceptRow,
  type CreatorProjectRow,
  type PrepareConceptBody,
} from "@/lib/creator-commerce/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PrepareConceptBody;

    const projectResult = await supabase
      .from("commerce_creator_projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (projectResult.error) throw new Error(projectResult.error.message);
    if (!projectResult.data) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });
    const project = projectResult.data as CreatorProjectRow & {
      product_template?: string | null;
      reference_assets?: unknown[];
      generated_assets?: unknown[];
      approved_assets?: unknown[];
      commerce_draft?: Record<string, unknown>;
      variants_draft?: unknown[];
      clothing_item_id?: string | null;
      creator_3d_asset_id?: string | null;
      status?: string;
    };

    let conceptResult = await supabase
      .from("commerce_creator_product_concepts")
      .select("*")
      .eq("project_id", id)
      .eq("role", "primary")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (conceptResult.error) throw new Error(conceptResult.error.message);

    if (!conceptResult.data) {
      const inserted = await supabase
        .from("commerce_creator_product_concepts")
        .insert({
          project_id: id,
          user_id: user.id,
          name: project.name,
          product_template: project.product_template || "custom",
          role: "primary",
          position: 0,
          status: project.status === "commerce_ready" ? "commerce_ready" : project.status === "approved" ? "approved" : "draft",
          creative_config: { description: null, legacy_project_product: true },
          reference_assets: Array.isArray(project.reference_assets) ? project.reference_assets : [],
          generated_assets: Array.isArray(project.generated_assets) ? project.generated_assets : [],
          approved_assets: Array.isArray(project.approved_assets) ? project.approved_assets : [],
          commerce_draft: project.commerce_draft ?? {},
          variants_draft: Array.isArray(project.variants_draft) ? project.variants_draft : [],
          clothing_item_id: project.clothing_item_id ?? null,
          creator_3d_asset_id: project.creator_3d_asset_id ?? null,
          metadata: { legacy_project_product: true },
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      conceptResult = inserted;
    }

    const prepared = await prepareCreatorConceptProduct({
      supabase,
      userId: user.id,
      project,
      concept: conceptResult.data as CreatorConceptRow,
      body,
    });

    const { data: savedProject, error: savedProjectError } = await supabase
      .from("commerce_creator_projects")
      .update({
        status: "commerce_ready",
        commerce_draft: prepared.concept.commerce_draft,
        variants_draft: prepared.concept.variants_draft,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (savedProjectError) throw new Error(savedProjectError.message);

    return NextResponse.json({ project: savedProject, product: prepared.product, variants: prepared.variants, concept: prepared.concept });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo preparar el producto." }, { status });
  }
}
