import { NextResponse } from "next/server";
import { buildBlenderJob, type BlenderRequest } from "@/lib/creator-studio/blender-job";
import {
  getRigPersistenceAdmin,
  RigPersistenceError,
} from "@/lib/creator-studio/rig-persistence";

export const runtime = "nodejs";
export const maxDuration = 60;

type ResolvedUserAvatar = {
  userId: string;
  avatarId: string;
  avatarUrl: string;
  avatarSource: "user_avatars" | "profiles";
};

function workerErrorMessage(data: Record<string, unknown>, status: number) {
  const detail = data.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const object = detail as Record<string, unknown>;
    if (typeof object.message === "string" && object.message.trim()) return object.message;
    try { return JSON.stringify(object); } catch { /* ignore */ }
  }
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return `El Garment/Blender Worker rechazó el trabajo (HTTP ${status}).`;
}

function normalizeAvatarUrl(value: unknown, request: Request) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  try {
    const url = new URL(raw, new URL(request.url).origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function resolveAvatarForReference(
  payload: BlenderRequest,
  request: Request,
): Promise<ResolvedUserAvatar> {
  const referenceAssetId = payload.templateId?.trim();
  if (!referenceAssetId) {
    throw new RigPersistenceError(
      "No se recibió el identificador del GLB seleccionado. Volvé a elegirlo desde la biblioteca.",
      400,
    );
  }

  const admin = getRigPersistenceAdmin();
  const { data: reference, error: referenceError } = await admin
    .from("creator_reference_assets")
    .select("id,user_id")
    .eq("id", referenceAssetId)
    .maybeSingle();

  if (referenceError) {
    throw new RigPersistenceError(
      `No se pudo identificar al dueño del GLB: ${referenceError.message}`,
      500,
    );
  }
  if (!reference?.user_id) {
    throw new RigPersistenceError(
      "El GLB seleccionado no pertenece a una biblioteca de usuario válida.",
      404,
    );
  }

  const userId = String(reference.user_id);
  const avatarColumns = "id,source,model_url,updated_at";
  const { data: activeAvatar, error: activeError } = await admin
    .from("user_avatars")
    .select(avatarColumns)
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .not("model_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) {
    throw new RigPersistenceError(
      `No se pudo consultar el avatar activo del usuario: ${activeError.message}`,
      500,
    );
  }

  const activeUrl = normalizeAvatarUrl(activeAvatar?.model_url, request);
  if (activeAvatar?.id && activeUrl) {
    return {
      userId,
      avatarId: String(activeAvatar.id),
      avatarUrl: activeUrl,
      avatarSource: "user_avatars",
    };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new RigPersistenceError(
      `No se pudo consultar el avatar del perfil: ${profileError.message}`,
      500,
    );
  }

  const profileUrl = normalizeAvatarUrl(profile?.avatar_3d_url, request);
  if (profileUrl) {
    return {
      userId,
      avatarId: `profile-${userId}`,
      avatarUrl: profileUrl,
      avatarSource: "profiles",
    };
  }

  const { data: readyAvatar, error: readyError } = await admin
    .from("user_avatars")
    .select(avatarColumns)
    .eq("user_id", userId)
    .eq("status", "ready")
    .not("model_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readyError) {
    throw new RigPersistenceError(
      `No se pudo buscar otro avatar listo del usuario: ${readyError.message}`,
      500,
    );
  }

  const readyUrl = normalizeAvatarUrl(readyAvatar?.model_url, request);
  if (readyAvatar?.id && readyUrl) {
    return {
      userId,
      avatarId: String(readyAvatar.id),
      avatarUrl: readyUrl,
      avatarSource: "user_avatars",
    };
  }

  throw new RigPersistenceError(
    "Tu usuario no tiene un avatar 3D activo y riggeado. Crealo o seleccionalo en Avatar/Admin antes de procesar la prenda.",
    409,
  );
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let payload: BlenderRequest;
    let sourceFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const rawPayload = form.get("payload");
      payload = rawPayload ? JSON.parse(String(rawPayload)) as BlenderRequest : {};
      const candidate = form.get("file");
      sourceFile = candidate instanceof File ? candidate : null;
      if (!sourceFile || sourceFile.size === 0) {
        return NextResponse.json({ error: "Falta el GLB real de referencia." }, { status: 400 });
      }
      if (!sourceFile.name.toLowerCase().endsWith(".glb")) {
        return NextResponse.json({ error: "El archivo debe ser .glb." }, { status: 400 });
      }
      if (sourceFile.size > 80 * 1024 * 1024) {
        return NextResponse.json({ error: "El GLB supera 80 MB." }, { status: 413 });
      }

      const bytes = new Uint8Array(await sourceFile.slice(0, 4).arrayBuffer());
      const magic = String.fromCharCode(...bytes);
      if (magic !== "glTF") {
        return NextResponse.json({ error: "El archivo no contiene un encabezado GLB válido." }, { status: 400 });
      }
    } else {
      payload = (await request.json()) as BlenderRequest;
    }

    const resolvedAvatar = await resolveAvatarForReference(payload, request);
    const workerUrl = process.env.GARMENT_WORKER_URL ?? process.env.BLENDER_WORKER_URL ?? "https://rig.clouva.com.ar";
    const workerToken = process.env.GARMENT_WORKER_TOKEN ?? process.env.BLENDER_WORKER_TOKEN;
    const job = buildBlenderJob({
      ...payload,
      userId: resolvedAvatar.userId,
      avatarId: resolvedAvatar.avatarId,
      avatarUrl: resolvedAvatar.avatarUrl,
      avatarSource: resolvedAvatar.avatarSource,
    });

    let response: Response;
    if (sourceFile) {
      const workerForm = new FormData();
      workerForm.set("file", sourceFile, sourceFile.name);
      workerForm.set("job", JSON.stringify(job));
      response = await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : undefined,
        body: workerForm,
        cache: "no-store",
      });
    } else {
      response = await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
        },
        body: JSON.stringify(job),
        cache: "no-store",
      });
    }

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      data = { message: rawText };
    }

    if (!response.ok) {
      const message = workerErrorMessage(data, response.status);
      return NextResponse.json({
        error: message,
        summary: "El Garment/Blender Worker rechazó el trabajo.",
        status: response.status,
        workerUrl,
        avatarId: resolvedAvatar.avatarId,
        avatarSource: resolvedAvatar.avatarSource,
        riggingStrategy: job.riggingStrategy,
        details: data,
      }, { status: response.status });
    }

    const returnedJobId = data.jobId ?? data.id;
    const workerReturnedResult = data.resultUrl ?? data.outputUrl;
    const proxiedResultUrl = workerReturnedResult && returnedJobId
      ? `/api/creator-studio/blender/result?jobId=${encodeURIComponent(String(returnedJobId))}`
      : workerReturnedResult ?? null;

    return NextResponse.json({
      ok: true,
      mock: false,
      workerUrl,
      avatarId: resolvedAvatar.avatarId,
      avatarSource: resolvedAvatar.avatarSource,
      riggingStrategy: job.riggingStrategy,
      templateMode: job.templateMode,
      jobId: returnedJobId,
      status: data.status ?? "queued",
      resultUrl: proxiedResultUrl,
      message: data.message ?? "El trabajo fue enviado al Garment Worker con el avatar activo del usuario.",
      raw: data,
    });
  } catch (error) {
    const status = error instanceof RigPersistenceError ? error.statusCode : 500;
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Error inesperado al conectar con Garment/Blender Worker.",
      workerUrl: process.env.GARMENT_WORKER_URL ?? process.env.BLENDER_WORKER_URL ?? "https://rig.clouva.com.ar",
    }, { status });
  }
}
