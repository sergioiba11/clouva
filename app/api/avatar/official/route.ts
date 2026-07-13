import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "avatars";
const OBJECT_PATH = "official/clouva-official-v1.glb";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function publicModelUrl() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return url ? `${url}/storage/v1/object/public/${BUCKET}/${OBJECT_PATH}` : null;
}

export async function GET() {
  const baseUrl = publicModelUrl();
  if (!baseUrl) {
    return NextResponse.json({ modelUrl: null, objectPath: OBJECT_PATH }, { headers: { "Cache-Control": "no-store" } });
  }

  let version = Date.now();
  try {
    const supabase = getAdminClient();
    const { data } = await supabase.storage.from(BUCKET).list("official", {
      search: "clouva-official-v1.glb",
      limit: 10,
    });
    const file = data?.find((entry) => entry.name === "clouva-official-v1.glb");
    const stamp = file?.updated_at || file?.created_at;
    if (stamp) version = new Date(stamp).getTime();
  } catch (error) {
    console.warn("Could not resolve official avatar version", error);
  }

  return NextResponse.json(
    { modelUrl: `${baseUrl}?v=${version}`, objectPath: OBJECT_PATH },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest) {
  try {
    const expectedSecret = process.env.CLOUVA_ADMIN_UPLOAD_SECRET;
    const receivedSecret = request.headers.get("x-clouva-admin-secret");
    if (!expectedSecret || receivedSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing GLB file" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".glb")) {
      return NextResponse.json({ error: "The official avatar must be a .glb file" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "GLB exceeds the 25 MB mobile limit" }, { status: 413 });
    }

    const supabase = getAdminClient();
    const { data: bucket } = await supabase.storage.getBucket(BUCKET);
    if (!bucket) {
      const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 25 * 1024 * 1024,
        allowedMimeTypes: ["model/gltf-binary", "application/octet-stream"],
      });
      if (bucketError && !bucketError.message.toLowerCase().includes("already exists")) throw bucketError;
    }

    const bytes = await file.arrayBuffer();
    const { error } = await supabase.storage.from(BUCKET).upload(OBJECT_PATH, bytes, {
      upsert: true,
      contentType: "model/gltf-binary",
      cacheControl: "60",
    });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      modelUrl: `${publicModelUrl()}?v=${Date.now()}`,
      objectPath: OBJECT_PATH,
      size: file.size,
      name: file.name,
    });
  } catch (error) {
    console.error("Official avatar upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown upload error" },
      { status: 500 },
    );
  }
}
