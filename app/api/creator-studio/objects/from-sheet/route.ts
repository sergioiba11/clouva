import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CREATOR_OBJECT_REFERENCE_ORDER,
  getCreatorObjectPreset,
} from "@/lib/creator-objects";
import {
  MAX_OBJECT_REFERENCE_SHEET_BYTES,
  splitObjectReferenceSheet,
  validateObjectReferenceSheetFile,
} from "@/lib/object-reference-sheet";
import {
  OBJECT_MULTI_IMAGE_TASK_CONFIG,
  createObjectMultiImageTask,
  getMultiImageTask,
  type MeshyTask,
} from "@/lib/meshy";
import { avatarStorage } from "@/lib/storage-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OBJECT_GLB_BYTES = 50 * 1024 * 1024;
const TERMINAL_MESHY_STATUSES = new Set(["FAILED", "EXPIRED", "CANCELED"]);

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticate(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) return null;
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}

function extensionFor(file: File) {
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

function taskError(task: MeshyTask) {
  if (typeof task.error === "string") return task.error;
  return task.task_error?.message || task.error?.message || `Meshy terminó con estado ${task.status}`;
}

async function downloadGlb(remoteUrl: string) {
  const parsed = new URL(remoteUrl);
  if (parsed.protocol !== "https:") throw new Error("Meshy devolvió una URL de GLB no segura");
  const response = await fetch(parsed, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`No se pudo descargar el GLB de Meshy (${response.status})`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_OBJECT_GLB_BYTES) throw new Error("El GLB supera el límite de 50 MB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_OBJECT_GLB_BYTES) throw new Error("El GLB supera el límite de 50 MB");
  if (bytes.byteLength < 12 || bytes.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Meshy no devolvió un GLB válido");
  }
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const form = await request.formData();
  const sheetValue = form.get("sheet");
  const presetKey = String(form.get("presetKey") ?? "fllows").trim();
  const preset = getCreatorObjectPreset(presetKey);
  if (!preset) return NextResponse.json({ error: "Preset de objeto desconocido" }, { status: 400 });
  if (!(sheetValue instanceof File)) {
    return NextResponse.json({ error: "Subí una única lámina 3:1 con Frente | Espalda | Costado" }, { status: 400 });
  }

  const fileError = validateObjectReferenceSheetFile(sheetValue);
  if (fileError) {
    const status = sheetValue.size > MAX_OBJECT_REFERENCE_SHEET_BYTES ? 413 : 415;
    return NextResponse.json({ error: fileError }, { status });
  }

  const assetId = crypto.randomUUID();
  const executionId = crypto.randomUUID();
  const uploadedPaths: string[] = [];

  try {
    const sourceBytes = Buffer.from(await sheetValue.arrayBuffer());
    const split = await splitObjectReferenceSheet(sourceBytes);
    const basePath = `${auth.user.id}/objects/${assetId}/references/${executionId}`;
    const sourceSheetPath = `${basePath}/source-sheet.${extensionFor(sheetValue)}`;

    const { error: sourceUploadError } = await avatarStorage.upload(sourceSheetPath, sourceBytes, {
      contentType: sheetValue.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (sourceUploadError) throw new Error(sourceUploadError.message);
    uploadedPaths.push(sourceSheetPath);

    const sourceSheetUrl = avatarStorage.getPublicUrl(sourceSheetPath).data.publicUrl;
    const uploads: Array<{ role: string; path: string; url: string; width: number; height: number }> = [];

    for (const reference of split.references) {
      const storagePath = `${basePath}/${preset.slug}-${reference.role}.webp`;
      const { error: uploadError } = await avatarStorage.upload(storagePath, reference.bytes, {
        contentType: reference.mimeType,
        cacheControl: "31536000",
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      uploadedPaths.push(storagePath);
      uploads.push({
        role: reference.role,
        path: storagePath,
        url: avatarStorage.getPublicUrl(storagePath).data.publicUrl,
        width: reference.width,
        height: reference.height,
      });
    }

    const imageUrls = CREATOR_OBJECT_REFERENCE_ORDER.map(
      (role) => uploads.find((entry) => entry.role === role)?.url ?? "",
    );
    if (imageUrls.some((url) => !url)) throw new Error("No se pudo conservar el orden Frente | Espalda | Costado");

    const taskId = await createObjectMultiImageTask(imageUrls, preset.texturePrompt);
    const referencePaths = Object.fromEntries(uploads.map((entry) => [entry.role, entry.path]));
    const referenceUrls = Object.fromEntries(uploads.map((entry) => [entry.role, entry.url]));
    const now = new Date().toISOString();

    const { data: asset, error: insertError } = await auth.supabase
      .from("creator_3d_assets")
      .insert({
        id: assetId,
        user_id: auth.user.id,
        name: preset.name,
        slug: preset.slug,
        kind: preset.kind,
        category: preset.category,
        preset_key: preset.key,
        status: "generating",
        source_sheet_storage_path: sourceSheetPath,
        source_sheet_url: sourceSheetUrl,
        reference_order: [...CREATOR_OBJECT_REFERENCE_ORDER],
        reference_paths: referencePaths,
        reference_urls: referenceUrls,
        split_metadata: {
          strategy: "server-sharp-exact-thirds",
          version: 1,
          source_width: split.sourceWidth,
          source_height: split.sourceHeight,
          panels: uploads.map(({ role, width, height }) => ({ role, width, height })),
        },
        meshy_task_id: taskId,
        meshy_config: {
          image_urls: imageUrls,
          texture_prompt: preset.texturePrompt ?? null,
          ...OBJECT_MULTI_IMAGE_TASK_CONFIG,
        },
        preview_image_url: referenceUrls.front,
        attachment_profile: preset.attachmentProfile,
        metadata: {
          generation_kind: "object-triptych-multi-image",
          reference_execution_id: executionId,
          source_sheet_is_canonical: true,
          created_at: now,
        },
      })
      .select("id,name,slug,kind,category,preset_key,status,source_sheet_url,reference_urls,preview_image_url,meshy_task_id,attachment_profile,created_at,updated_at")
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ asset, taskId });
  } catch (error) {
    if (uploadedPaths.length) await avatarStorage.remove(uploadedPaths);
    console.error("Object sheet generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo iniciar la generación 3D" },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const assetId = request.nextUrl.searchParams.get("assetId")?.trim();
  if (!assetId) return NextResponse.json({ error: "Falta assetId" }, { status: 400 });

  const { data: asset, error: assetError } = await auth.supabase
    .from("creator_3d_assets")
    .select("id,user_id,name,slug,kind,category,preset_key,status,meshy_task_id,model_url,storage_path,preview_image_url,metadata,error_message,created_at,updated_at")
    .eq("id", assetId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (assetError) return NextResponse.json({ error: "No se pudo leer el objeto" }, { status: 500 });
  if (!asset) return NextResponse.json({ error: "Objeto no encontrado" }, { status: 404 });
  if (asset.status === "ready" && asset.model_url) return NextResponse.json({ asset, progress: 100 });
  if (asset.status === "failed") return NextResponse.json({ asset, error: asset.error_message || "La generación falló" }, { status: 422 });
  if (!asset.meshy_task_id) return NextResponse.json({ error: "El objeto no tiene tarea de Meshy" }, { status: 409 });

  try {
    const task = await getMultiImageTask(asset.meshy_task_id);
    if (TERMINAL_MESHY_STATUSES.has(task.status)) {
      const message = taskError(task);
      await auth.supabase
        .from("creator_3d_assets")
        .update({ status: "failed", error_message: message })
        .eq("id", asset.id)
        .eq("user_id", auth.user.id);
      return NextResponse.json({ error: message, status: task.status, progress: task.progress ?? 0 }, { status: 422 });
    }

    if (task.status !== "SUCCEEDED") {
      return NextResponse.json({ asset, status: task.status, progress: task.progress ?? 0 });
    }
    if (!task.model_urls?.glb) throw new Error("Meshy terminó pero no devolvió model_urls.glb");

    const glb = await downloadGlb(task.model_urls.glb);
    const storagePath = `${auth.user.id}/objects/${asset.id}/source/${asset.slug}-meshy.glb`;
    const { error: uploadError } = await avatarStorage.upload(storagePath, glb.bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "31536000",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const modelUrl = avatarStorage.getPublicUrl(storagePath).data.publicUrl;
    const now = new Date().toISOString();
    const previousMetadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
      ? asset.metadata as Record<string, unknown>
      : {};
    const metadata = {
      ...previousMetadata,
      completed_at: now,
      glb_sha256: glb.sha256,
      glb_size_bytes: glb.sizeBytes,
      permanent_glb_path: storagePath,
      permanent_glb_url: modelUrl,
      source_immutable: true,
      meshy_remote_urls: {
        temporary: true,
        glb: task.model_urls.glb,
        pre_remeshed_glb: task.model_urls.pre_remeshed_glb ?? null,
        thumbnail_url: task.thumbnail_url ?? null,
        thumbnail_urls: task.thumbnail_urls ?? null,
      },
    };

    const { data: readyAsset, error: updateError } = await auth.supabase
      .from("creator_3d_assets")
      .update({
        status: "ready",
        model_url: modelUrl,
        storage_path: storagePath,
        preview_image_url: task.thumbnail_url ?? asset.preview_image_url,
        metadata,
        error_message: null,
      })
      .eq("id", asset.id)
      .eq("user_id", auth.user.id)
      .select("id,name,slug,kind,category,preset_key,status,model_url,storage_path,preview_image_url,meshy_task_id,metadata,created_at,updated_at")
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ asset: readyAsset, status: "SUCCEEDED", progress: 100 });
  } catch (error) {
    console.error("Object generation status failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo completar el objeto 3D" },
      { status: 500 },
    );
  }
}
