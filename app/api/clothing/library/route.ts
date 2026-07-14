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
  processing_started_at: string | null;
  metadata: Record<string, unknown> | null;
  fit_status?: string;
  rigged?: boolean;
  wearable?: boolean;
  hood_supported?: boolean;
  hood_state?: string;
  hood_up_model_url?: string | null;
  hood_down_model_url?: string | null;
  processing_error?: string | null;
};

const MAX_PROCESSING_MS = 15 * 60 * 1000;

function isTimedOut(item: ClothingRow) {
  const startedAt = item.processing_started_at ?? item.created_at;
  return Date.now() - new Date(startedAt).getTime() > MAX_PROCESSING_MS;
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function getMeshyModel(item: ClothingRow) {
  if (!item.meshy_task_id) return null;
  const metadata = item.metadata ?? {};
  const generationKind = metadata.generation_kind;
  const task = generationKind === "multi-image"
    ? await getMultiImageTask(item.meshy_task_id)
    : await getTask(item.meshy_task_id);
  return task;
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

  const supabase = getAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const select = "id,name,category,fit,color,status,model_url,thumbnail_url,front_reference_url,meshy_task_id,created_at,processing_started_at,metadata";
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
    .filter((item) => (item.status === "generating" || item.status === "rigging") && item.meshy_task_id)
    .slice(0, 8);

  await Promise.allSettled(
    active.map(async (item) => {
      const metadata = item.metadata ?? {};

      if (isTimedOut(item)) {
        await supabase
          .from("clothing_items")
          .update({
            status: "failed",
            fit_status: "failed",
            wearable: false,
            processing_error: "Se superó el tiempo máximo de generación (15 min).",
            updated_at: new Date().toISOString(),
            metadata: { ...metadata, generation_stage: "timeout" },
          })
          .eq("id", item.id)
          .eq("user_id", userData.user.id);
        return;
      }

      try {
        let modelUrl = typeof metadata.meshy_model_url === "string" ? metadata.meshy_model_url : null;
        let taskStatus = item.status === "rigging" ? "SUCCEEDED" : undefined;

        if (!modelUrl) {
          const task = await getMeshyModel(item);
          if (!task) return;

          taskStatus = task.status;
          meshyStatusById[item.id] = task.status;
          if (typeof task.progress === "number") {
            progressById[item.id] = Math.max(0, Math.min(task.status === "SUCCEEDED" ? 100 : 99, Math.round(task.progress)));
          }

          if (task.status === "FAILED" || task.status === "EXPIRED") {
            await supabase
              .from("clothing_items")
              .update({
                status: "failed",
                fit_status: "failed",
                wearable: false,
                processing_error: `Meshy: ${task.status}`,
                updated_at: new Date().toISOString(),
                metadata: {
                  ...metadata,
                  generation_stage: "failed",
                  generation_progress: progressById[item.id] ?? 0,
                },
              })
              .eq("id", item.id)
              .eq("user_id", userData.user.id);
            return;
          }

          if (task.status !== "SUCCEEDED" || !task.model_urls?.glb) return;
          modelUrl = task.model_urls.glb;
        }

        if (taskStatus === "SUCCEEDED" || modelUrl) {
          const rigMetadata = {
            ...metadata,
            meshy_model_url: modelUrl,
            generation_stage: "rigging",
            generation_progress: 99,
            rigging_last_error: null,
          };

          await supabase
            .from("clothing_items")
            .update({
              status: "rigging",
              updated_at: new Date().toISOString(),
              metadata: rigMetadata,
            })
            .eq("id", item.id)
            .eq("user_id", userData.user.id);

          try {
            await finalizeClothingItem({
              supabase,
              userId: userData.user.id,
              itemId: item.id,
              modelUrl,
              category: item.category,
              color: item.color,
              metadata: rigMetadata,
            });
            progressById[item.id] = 100;
          } catch (finalizeError) {
            const message = finalizeError instanceof Error ? finalizeError.message : "Rigging failed";
            console.error(`Could not finalize clothing item ${item.id}`, finalizeError);
            await supabase
              .from("clothing_items")
              .update({
                status: "rigging",
                processing_error: message.slice(0, 500),
                updated_at: new Date().toISOString(),
                metadata: {
                  ...rigMetadata,
                  rigging_last_error: message.slice(0, 500),
                  rigging_retry_at: new Date().toISOString(),
                },
              })
              .eq("id", item.id)
              .eq("user_id", userData.user.id);
          }
        }
      } catch (taskError) {
        console.error(`Could not synchronize clothing item ${item.id}`, taskError);
      }
    }),
  );

  const finalSelect =
    "id,name,category,fit,color,status,model_url,thumbnail_url,front_reference_url,meshy_task_id,created_at,processing_started_at,metadata,fit_status,rigged,wearable,hood_supported,hood_state,hood_up_model_url,hood_down_model_url,processing_error";
  const { data: refreshed, error: refreshedError } = await supabase
    .from("clothing_items")
    .select(finalSelect)
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
