import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { finalizeClothingItem } from "@/lib/clothing-finalization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SNAPSHOT_BYTES = 250_000;
type ItemMetadata = Record<string, unknown>;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function readUnrealSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error("El snapshot corporal de Unreal supera el tamaño permitido");
  }
  return value as Record<string, unknown>;
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
    const itemId = typeof body?.itemId === "string" ? body.itemId : "";
    const modelUrl = typeof body?.modelUrl === "string" ? body.modelUrl : "";
    if (!itemId || !modelUrl) return NextResponse.json({ error: "Faltan itemId o modelUrl" }, { status: 400 });

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(modelUrl);
    } catch {
      return NextResponse.json({ error: "Invalid model URL" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "https:") return NextResponse.json({ error: "Model URL must use HTTPS" }, { status: 400 });

    const unrealSnapshot = readUnrealSnapshot(body?.unrealSnapshot);
    const attemptId = typeof body?.attemptId === "string" ? body.attemptId.slice(0, 100) : null;
    if (body?.moldSource === "unreal-avatar-snapshot" && !unrealSnapshot) {
      return NextResponse.json({ error: "Unreal todavía no devolvió los datos corporales para crear el molde" }, { status: 409 });
    }

    const { data: sourceItem, error: sourceError } = await supabase
      .from("clothing_items")
      .select("id,category,color,metadata,status")
      .eq("id", itemId)
      .eq("user_id", userData.user.id)
      .single();
    if (sourceError || !sourceItem) return NextResponse.json({ error: "Clothing item not found" }, { status: 404 });

    const metadata = sourceItem.metadata && typeof sourceItem.metadata === "object"
      ? (sourceItem.metadata as ItemMetadata)
      : {};
    const processingMetadata: ItemMetadata = {
      ...metadata,
      ...(unrealSnapshot ? {
        unreal_snapshot: unrealSnapshot,
        unreal_attempt_id: attemptId,
        mold_source: "unreal-avatar-snapshot",
      } : {}),
    };

    await supabase
      .from("clothing_items")
      .update({
        status: "rigging",
        updated_at: new Date().toISOString(),
        metadata: {
          ...metadata,
          generation_stage: "rigging",
          generation_progress: 99,
          unreal_attempt_id: attemptId,
          mold_source: unrealSnapshot ? "unreal-avatar-snapshot" : "active-avatar-geometry",
        },
      })
      .eq("id", itemId)
      .eq("user_id", userData.user.id);

    const result = await finalizeClothingItem({
      supabase,
      userId: userData.user.id,
      itemId,
      modelUrl,
      category: sourceItem.category,
      color: typeof sourceItem.color === "string" ? sourceItem.color : null,
      metadata: processingMetadata,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Clothing finalization failed", error);
    const message = error instanceof Error ? error.message : "Unknown clothing finalization error";
    const status = /snapshot corporal.*tamaño/i.test(message) ? 413 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
