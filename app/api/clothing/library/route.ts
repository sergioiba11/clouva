import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMultiImageTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GLB_BYTES = 75 * 1024 * 1024;

type ClothingRow = {
  id: string;
  name: string;
  category: string;
  fit: string | null;
  color: string | null;
  status: string;
  model_url: string | null;
  thumbnail_url: string | null;
  front_reference_url: string | null;
  meshy_task_id: string | null;
  created_at: string;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function persistCompletedModel(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  itemId: string,
  modelUrl: string,
) {
  const remote = await fetch(modelUrl, { redirect: "follow", cache: "no-store" });
  if (!remote.ok) throw new Error(`Could not download Meshy GLB (${remote.status})`);

  const contentLength = Number(remote.headers.get("content-length") || 0);
  if (contentLength > MAX_GLB_BYTES) throw new Error("Generated GLB exceeds 75 MB");

  const bytes = await remote.arrayBuffer();
  if (bytes.byteLength > MAX_GLB_BYTES) throw new Error("Generated GLB exceeds 75 MB");
  if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Meshy did not return a valid GLB");
  }

  const storagePath = `${userId}/clothing/${itemId}/garment.glb`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const { error: updateError } = await supabase
    .from("clothing_items")
    .update({ status: "ready", model_url: publicData.publicUrl, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("user_id", userId);
  if (updateError) throw updateError;
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const select = "id,name,category,fit,color,status,model_url,thumbnail_url,front_reference_url,meshy_task_id,created_at";
  const { data: initialData, error: initialError } = await supabase
    .from("clothing_items")
    .select(select)
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (initialError) return NextResponse.json({ error: initialError.message }, { status: 500 });

  const rows = (initialData ?? []) as ClothingRow[];
  const progressById: Record<string, number> = {};
  const generating = rows.filter((item) => item.status === "generating" && item.meshy_task_id).slice(0, 6);

  await Promise.allSettled(
    generating.map(async (item) => {
      try {
        const task = await getMultiImageTask(item.meshy_task_id as string);
        if (typeof task.progress === "number") progressById[item.id] = Math.max(0, Math.min(99, Math.round(task.progress)));

        if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
          await persistCompletedModel(supabase, userData.user.id, item.id, task.model_urls.glb);
          progressById[item.id] = 100;
          return;
        }

        if (task.status === "FAILED" || task.status === "EXPIRED") {
          await supabase
            .from("clothing_items")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("user_id", userData.user.id);
        }
      } catch (error) {
        console.error(`Could not synchronize clothing item ${item.id}`, error);
      }
    }),
  );

  const { data, error } = await supabase
    .from("clothing_items")
    .select(select)
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = ((data ?? []) as ClothingRow[]).map((item) => ({
    ...item,
    thumbnail_url: item.thumbnail_url || item.front_reference_url,
    meshy_progress: item.status === "ready" ? 100 : progressById[item.id],
  }));

  return NextResponse.json({ items });
}
