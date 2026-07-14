import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRefineTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const body = await request.json();
    const previewTaskId = typeof body?.previewTaskId === "string" ? body.previewTaskId : "";
    const itemId = typeof body?.itemId === "string" ? body.itemId : "";
    if (!previewTaskId || !itemId) return NextResponse.json({ error: "Faltan previewTaskId o itemId" }, { status: 400 });

    const { data: item, error: itemError } = await supabase
      .from("clothing_items")
      .select("id")
      .eq("id", itemId)
      .eq("user_id", userData.user.id)
      .single();
    if (itemError || !item) return NextResponse.json({ error: "Prenda no encontrada" }, { status: 404 });

    const taskId = await createRefineTask(previewTaskId);

    const { error: updateError } = await supabase
      .from("clothing_items")
      .update({
        meshy_task_id: taskId,
        status: "generating",
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId)
      .eq("user_id", userData.user.id);
    if (updateError) throw updateError;

    return NextResponse.json({ taskId, stage: "refine" });
  } catch (error) {
    console.error("Clothing refine failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo refinar la prenda" },
      { status: 500 },
    );
  }
}
