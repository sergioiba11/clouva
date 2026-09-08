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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; conceptId: string }> },
) {
  try {
    const { user, supabase } = await requireUser(request);
    const { id, conceptId } = await params;
    const body = (await request.json().catch(() => ({}))) as PrepareConceptBody;

    const [projectResult, conceptResult] = await Promise.all([
      supabase.from("commerce_creator_projects").select("*").eq("id", id).maybeSingle(),
      supabase.from("commerce_creator_product_concepts").select("*").eq("id", conceptId).eq("project_id", id).maybeSingle(),
    ]);
    if (projectResult.error) throw new Error(projectResult.error.message);
    if (conceptResult.error) throw new Error(conceptResult.error.message);
    if (!projectResult.data) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });
    if (!conceptResult.data) return NextResponse.json({ error: "El producto creativo no existe." }, { status: 404 });
    if (conceptResult.data.status !== "approved" && conceptResult.data.status !== "commerce_ready" && conceptResult.data.status !== "published") {
      return NextResponse.json({ error: "Aprobá el producto creativo antes de prepararlo para Commerce." }, { status: 409 });
    }

    const prepared = await prepareCreatorConceptProduct({
      supabase,
      userId: user.id,
      project: projectResult.data as CreatorProjectRow,
      concept: conceptResult.data as CreatorConceptRow,
      body,
    });
    return NextResponse.json(prepared);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo preparar el producto." }, { status });
  }
}
