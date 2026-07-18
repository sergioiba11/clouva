import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_BUCKETS = new Set(["creator-assets"]);

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeName(value: string) {
  return value.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").slice(0, 70) || "objeto";
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const body = (await request.json()) as { bucket?: string; path?: string; name?: string };
    const bucket = String(body.bucket || "");
    const path = String(body.path || "");
    if (!ALLOWED_BUCKETS.has(bucket)) return NextResponse.json({ error: "Bucket no permitido" }, { status: 400 });
    if (!path.startsWith(`${authData.user.id}/`) || !/\.glb$/i.test(path)) {
      return NextResponse.json({ error: "El objeto no pertenece al usuario o no es GLB" }, { status: 400 });
    }

    const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 15);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("No se pudo firmar el GLB");

    const workerUrl = process.env.BLENDER_WORKER_URL?.replace(/\/+$/, "");
    if (!workerUrl) return NextResponse.json({ error: "Falta BLENDER_WORKER_URL" }, { status: 503 });

    const worker = await fetch(`${workerUrl}/export/unreal-object`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BLENDER_WORKER_TOKEN ? { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ source_url: signed.data.signedUrl, asset_name: body.name || path.split("/").pop() || "objeto.glb" }),
      cache: "no-store",
    });
    if (!worker.ok) {
      const detail = await worker.text().catch(() => "");
      throw new Error(`El Blender Worker rechazó el objeto (${worker.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }

    const bytes = await worker.arrayBuffer();
    if (bytes.byteLength < 128) throw new Error("El FBX del objeto está vacío");

    const base = safeName(body.name || path.split("/").pop() || "objeto");
    const filename = `${base}-unreal.fbx`;
    const storagePath = `${authData.user.id}/unreal/${filename}`;
    const upload = await supabase.storage.from("creator-assets").upload(storagePath, bytes, {
      contentType: "application/octet-stream",
      cacheControl: "3600",
      upsert: true,
    });
    if (upload.error) throw upload.error;

    const url = supabase.storage.from("creator-assets").getPublicUrl(storagePath).data.publicUrl;
    return NextResponse.json({ ok: true, url, filename, path: storagePath, scale: "escala original · centímetros Unreal" });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No se pudo exportar el objeto para Unreal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
