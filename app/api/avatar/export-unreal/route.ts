import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

async function downloadWorkerResult(response: Response): Promise<ArrayBuffer> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as Record<string, unknown>;
    const remoteUrl = [payload.download_url, payload.file_url, payload.url, payload.fbx_url].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (!remoteUrl) {
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : "El Blender Worker no devolvió la URL del FBX",
      );
    }

    const remote = await fetch(remoteUrl, { cache: "no-store" });
    if (!remote.ok) throw new Error(`No se pudo descargar el FBX generado (${remote.status})`);
    return remote.arrayBuffer();
  }

  return response.arrayBuffer();
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const workerBaseUrl = process.env.BLENDER_WORKER_URL;
    if (!workerBaseUrl) {
      return NextResponse.json(
        { error: "Falta configurar BLENDER_WORKER_URL en el deploy" },
        { status: 503 },
      );
    }

    const { data: active, error: avatarError } = await supabase
      .from("user_avatars")
      .select("id, model_url, status")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (avatarError) throw avatarError;
    if (!active?.id || !active.model_url) {
      return NextResponse.json(
        { error: "No encontramos un avatar activo listo para exportar" },
        { status: 404 },
      );
    }

    const workerResponse = await fetch(`${normalizeWorkerUrl(workerBaseUrl)}/export/unreal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BLENDER_WORKER_TOKEN
          ? { Authorization: `Bearer ${process.env.BLENDER_WORKER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        avatar_id: active.id,
        user_id: user.id,
        source_url: active.model_url,
        output_format: "fbx",
        target: "unreal",
        unit_system: "centimeters",
        centimeters_per_unit: 1,
        apply_transforms: true,
        preserve_armature: true,
        pose: "A",
      }),
      cache: "no-store",
    });

    if (!workerResponse.ok) {
      const details = await workerResponse.text().catch(() => "");
      throw new Error(
        `El Blender Worker rechazó la exportación (${workerResponse.status})${details ? `: ${details.slice(0, 240)}` : ""}`,
      );
    }

    const bytes = await downloadWorkerResult(workerResponse);
    if (bytes.byteLength < 128) throw new Error("El FBX generado está vacío o incompleto");

    const filename = `clouva-avatar-${String(active.id).slice(0, 8)}-unreal.fbx`;
    const storagePath = `${user.id}/${active.id}/unreal/${filename}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "application/octet-stream",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);

    return NextResponse.json({
      ok: true,
      avatarId: active.id,
      filename,
      path: storagePath,
      url: publicData.publicUrl,
      format: "fbx",
      target: "unreal",
      scale: "1 Unreal Unit = 1 cm",
    });
  } catch (cause) {
    console.error("Unreal avatar export failed", cause);
    const message = cause instanceof Error ? cause.message : "No se pudo exportar el avatar para Unreal";
    const status = /sesión/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
