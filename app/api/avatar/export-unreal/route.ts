import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TARGET_HEIGHT_CM = 175;
const COMPLETE_RIG_FILENAME = /clouva-complete-rigged\.glb/i;

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

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause && typeof cause === "object") {
    const value = cause as Record<string, unknown>;
    for (const key of ["message", "error_description", "details", "detail", "error"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    try {
      const serialized = JSON.stringify(cause);
      if (serialized && serialized !== "{}") return serialized.slice(0, 600);
    } catch {
      // Keep the user-facing fallback below.
    }
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const workerBaseUrl = process.env.BLENDER_WORKER_URL;
    if (!workerBaseUrl) return NextResponse.json({ error: "Falta configurar BLENDER_WORKER_URL" }, { status: 503 });

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

    if (avatarError) throw new Error(errorMessage(avatarError, "No se pudo consultar el avatar activo"));
    if (!active?.id || !active.model_url) {
      return NextResponse.json({ error: "No encontramos el avatar activo procesado del usuario" }, { status: 404 });
    }

    const sourceUrl = String(active.processed_glb_url || active.rigged_url || active.model_url || "");
    if (!sourceUrl || !COMPLETE_RIG_FILENAME.test(sourceUrl)) {
      return NextResponse.json({
        error: "El avatar todavía no tiene el rig completo validado con dedos y orejas",
      }, { status: 409 });
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

    const exportedAt = new Date().toISOString();
    const exportRevision = exportedAt.replace(/\D/g, "").slice(0, 14);
    const filename = `clouva-avatar-${String(active.id).slice(0, 8)}-unreal.fbx`;
    const storedFilename = `clouva-avatar-${String(active.id).slice(0, 8)}-unreal-${exportRevision}.fbx`;
    const storagePath = `${user.id}/${active.id}/unreal/${storedFilename}`;
    const exportMetadata = {
      ...metadata,
      avatarId: active.id,
      userId: user.id,
      sourceUrl,
      completeRigRequired: true,
      fingersAndEarsValidated: true,
      storagePath,
      exportedAt,
    };

    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "application/octet-stream",
      cacheControl: "0",
      upsert: false,
    });
    if (uploadError) throw new Error(errorMessage(uploadError, "No se pudo guardar el FBX validado"));

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    const downloadUrl = `${publicData.publicUrl}?v=${encodeURIComponent(exportRevision)}`;

    const { error: updateError } = await supabase
      .from("user_avatars")
      .update({
        unreal_model_url: downloadUrl,
        unreal_export_metadata: exportMetadata,
        unreal_exported_at: exportedAt,
      })
      .eq("id", active.id)
      .eq("user_id", user.id);

    const metadataWarning = updateError
      ? `El FBX se generó, pero no se pudo guardar su metadata: ${errorMessage(updateError, "error de base de datos")}`
      : null;
    if (updateError) console.warn("Unreal avatar metadata persistence failed", updateError);

    return NextResponse.json({
      ok: true,
      avatarId: active.id,
      filename,
      path: storagePath,
      url: downloadUrl,
      format: "fbx",
      target: "unreal",
      scale: "Import Uniform Scale = 1.0",
      validation: exportMetadata,
      warning: metadataWarning,
    });
  } catch (cause) {
    console.error("Unreal avatar export failed", cause);
    const message = errorMessage(cause, "No se pudo exportar el avatar para Unreal");
    const status = /sesión/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
