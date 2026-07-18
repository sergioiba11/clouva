import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TARGET_HEIGHT_CM = 175;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Sesión requerida");
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida");
  return { supabase, user: data.user };
}

function normalizeWorkerUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function numericHeight(row: Record<string, unknown>) {
  for (const key of ["height_cm", "target_height_cm", "avatar_height_cm", "user_height_cm"]) {
    const raw = row[key];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(value) && value >= 80 && value <= 260) return value;
  }
  return DEFAULT_TARGET_HEIGHT_CM;
}

function parseWorkerMetadata(response: Response) {
  const raw = response.headers.get("x-clouva-metadata");
  if (!raw) throw new Error("El Blender Worker no devolvió la validación del avatar");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("La metadata Unreal devuelta por Blender es inválida");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const workerBaseUrl = process.env.BLENDER_WORKER_URL;
    if (!workerBaseUrl) return NextResponse.json({ error: "Falta configurar BLENDER_WORKER_URL en el deploy" }, { status: 503 });

    const { data: active, error: avatarError } = await supabase
      .from("user_avatars")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("status", "ready")
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (avatarError) throw avatarError;
    if (!active?.id || !active.model_url) {
      return NextResponse.json({ error: "No encontramos el avatar activo procesado del usuario" }, { status: 404 });
    }

    const sourceUrl = String(active.processed_glb_url || active.rigged_url || active.model_url || "");
    if (!sourceUrl || !/rigged|processed|final/i.test(sourceUrl)) {
      return NextResponse.json({ error: "El avatar activo todavía no tiene una versión autoriggeada procesada" }, { status: 409 });
    }

    const targetHeightCm = numericHeight(active as Record<string, unknown>);
    const workerResponse = await fetch(`${normalizeWorkerUrl(workerBaseUrl)}/export/unreal-v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BLENDER_WORKER_TOKEN ? { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        avatar_id: active.id,
        user_id: user.id,
        source_url: sourceUrl,
        target_height_cm: targetHeightCm,
      }),
      cache: "no-store",
    });

    if (!workerResponse.ok) {
      const details = await workerResponse.text().catch(() => "");
      throw new Error(`El Blender Worker rechazó la exportación (${workerResponse.status})${details ? `: ${details.slice(0, 500)}` : ""}`);
    }

    const metadata = parseWorkerMetadata(workerResponse);
    if (metadata.readyForUnreal !== true) throw new Error("El avatar no superó la validación para Unreal");
    const bytes = await workerResponse.arrayBuffer();
    if (bytes.byteLength < 1024) throw new Error("El FBX validado está vacío o incompleto");

    const filename = `clouva-avatar-${String(active.id).slice(0, 8)}-unreal.fbx`;
    const storagePath = `${user.id}/${active.id}/unreal/${filename}`;
    const exportedAt = new Date().toISOString();
    const exportMetadata = {
      ...metadata,
      avatarId: active.id,
      userId: user.id,
      sourceUrl,
      storagePath,
      exportedAt,
    };

    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "application/octet-stream",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    // El bucket `avatars` está restringido a formatos 3D y rechaza application/json.
    // La validación se conserva completa en `user_avatars.unreal_export_metadata`, sin
    // crear un archivo JSON separado que pueda bloquear una exportación FBX válida.
    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);

    const { error: updateError } = await supabase
      .from("user_avatars")
      .update({
        unreal_model_url: publicData.publicUrl,
        unreal_export_metadata: exportMetadata,
        unreal_exported_at: exportedAt,
      })
      .eq("id", active.id)
      .eq("user_id", user.id);
    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      avatarId: active.id,
      filename,
      path: storagePath,
      url: publicData.publicUrl,
      format: "fbx",
      target: "unreal",
      scale: "Import Uniform Scale = 1.0",
      validation: exportMetadata,
    });
  } catch (cause) {
    console.error("Unreal avatar export failed", cause);
    const message = cause instanceof Error ? cause.message : "No se pudo exportar el avatar para Unreal";
    const status = /sesión/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
