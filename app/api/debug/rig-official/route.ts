import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRiggingTask, getRiggingTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const step = searchParams.get("step");
  const supabase = getAdminClient();

  try {
    if (step === "create") {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, avatar_3d_url")
        .eq("role", "admin")
        .not("avatar_3d_url", "is", null)
        .limit(1)
        .maybeSingle();
      if (error || !data?.avatar_3d_url) throw new Error("No hay avatar oficial activo");
      const taskId = await createRiggingTask(data.avatar_3d_url, 1.8);
      return NextResponse.json({ taskId, sourceUrl: data.avatar_3d_url, adminId: data.id });
    }

    if (step === "status") {
      const taskId = searchParams.get("taskId");
      if (!taskId) return NextResponse.json({ error: "Falta taskId" }, { status: 400 });
      const task = await getRiggingTask(taskId);
      return NextResponse.json(task);
    }

    if (step === "finalize") {
      const taskId = searchParams.get("taskId");
      const adminId = searchParams.get("adminId");
      if (!taskId || !adminId) return NextResponse.json({ error: "Falta taskId o adminId" }, { status: 400 });
      const task = await getRiggingTask(taskId);
      if (task.status !== "SUCCEEDED" || !task.model_urls?.glb) {
        return NextResponse.json({ error: "Rigging todavía no terminó", task }, { status: 409 });
      }
      const remote = await fetch(task.model_urls.glb, { cache: "no-store" });
      if (!remote.ok) throw new Error(`No se pudo descargar el GLB riggeado (${remote.status})`);
      const bytes = await remote.arrayBuffer();
      if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") throw new Error("Meshy no devolvió un GLB válido");

      const storagePath = `${adminId}/official/clouva-official-rigged.glb`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
        contentType: "model/gltf-binary",
        cacheControl: "3600",
        upsert: true,
      });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_3d_url: publicData.publicUrl })
        .eq("id", adminId);
      if (updateError) throw updateError;

      return NextResponse.json({ ok: true, newAvatarUrl: publicData.publicUrl });
    }

    return NextResponse.json({ error: "step debe ser create, status o finalize" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
