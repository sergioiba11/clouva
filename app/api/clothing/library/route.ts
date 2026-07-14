import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMultiImageTask, getTask } from "@/lib/meshy";
import { finalizeClothingItem } from "@/lib/clothing-finalization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  metadata: Record<string, unknown> | null;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const select = "id,name,category,fit,color,status,model_url,thumbnail_url,front_reference_url,meshy_task_id,created_at,metadata";
  const { data, error } = await supabase
    .from("clothing_items")
    .select(select)
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as ClothingRow[];
  const progressById: Record<string, number> = {};
  const meshyStatusById: Record<string, string> = {};
  const active = rows
    .filter((item) => item.status === "generating" && item.meshy_task_id)
    .slice(0, 8);

  await Promise.allSettled(
    active.map(async (item) => {
      try {
        const metadata = item.metadata ?? {};
        const generationKind = metadata.generation_kind;
        const task = generationKind === "multi-image"
          ? await getMultiImageTask(item.meshy_task_id as string)
          : await getTask(item.meshy_task_id as string);

        meshyStatusById[item.id] = task.status;
        if (typeof task.progress === "number") {
          progressById[item.id] = Math.max(0, Math.min(task.status === "SUCCEEDED" ? 100 : 99, Math.round(task.progress)));
        }

        if (task.status === "SUCCEEDED" && task.model_urls?.glb) {
          const { data: claimed } = await supabase
            .from("clothing_items")
            .update({
              status: "rigging",
              updated_at: new Date().toISOString(),
              metadata: {
                ...metadata,
                generation_stage: "rigging",
                generation_progress: 99,
              },
            })
            .eq("id", item.id)
            .eq("user_id", userData.user.id)
            .eq("status", "generating")
            .select("id")
            .maybeSingle();

          if (claimed) {
            await finalizeClothingItem({
              supabase,
              userId: userData.user.id,
              itemId: item.id,
              modelUrl: task.model_urls.glb,
              category: item.category,
              color: item.color,
              metadata,
            });
          }
          progressById[item.id] = 100;
          return;
        }

        if (task.status === "FAILED" || task.status === "EXPIRED") {
          await supabase
            .from("clothing_items")
            .update({
              status: "failed",
              updated_at: new Date().toISOString(),
              metadata: {
                ...metadata,
                generation_stage: "failed",
                generation_progress: progressById[item.id] ?? 0,
              },
            })
            .eq("id", item.id)
            .eq("user_id", userData.user.id);
        }
      } catch (taskError) {
        console.error(`Could not synchronize clothing item ${item.id}`, taskError);
      }
    }),
  );

  const { data: refreshed, error: refreshedError } = await supabase
    .from("clothing_items")
    .select(select)
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });

  if (refreshedError) return NextResponse.json({ error: refreshedError.message }, { status: 500 });

  const items = ((refreshed ?? []) as ClothingRow[]).map((item) => ({
    ...item,
    thumbnail_url: item.thumbnail_url || item.front_reference_url,
    meshy_progress:
      item.status === "ready"
        ? 100
        : item.status === "rigging"
          ? 99
          : progressById[item.id],
    meshy_status: meshyStatusById[item.id],
  }));

  return NextResponse.json({ items });
}
