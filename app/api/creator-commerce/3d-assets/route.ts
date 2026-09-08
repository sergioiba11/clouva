import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const [clothing, objects] = await Promise.all([
      supabase
        .from("clothing_items")
        .select("id,name,category,color,model_url,thumbnail_url,status,fit_status,rigged,wearable,updated_at")
        .eq("user_id", user.id)
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("creator_3d_assets")
        .select("id,name,kind,category,status,model_url,preview_image_url,updated_at")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(100),
    ]);
    if (clothing.error) throw new Error(clothing.error.message);
    if (objects.error) throw new Error(objects.error.message);
    return NextResponse.json({ clothing: clothing.data ?? [], objects: objects.data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus assets 3D." }, { status });
  }
}
