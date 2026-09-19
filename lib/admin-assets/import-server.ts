import "server-only";

import { Storage } from "@google-cloud/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/server/supabase";
import {
  extractAssetPackEntry,
  inspectAssetPack,
  type AssetPackEntryDescriptor,
} from "@/lib/admin-assets/zip-pack";
import {
  importOverallPercent,
  normalizeAssetImportJob,
  uploadOverallPercent,
  type AssetImportJob,
} from "@/lib/admin-assets/import-types";

export const ASSET_IMPORT_BUCKET =
  process.env.CLOUVA_ADMIN_ASSETS_BUCKET ??
  process.env.CLOUVA_GENERATED_MEDIA_BUCKET ??
  "clouva-generated-media";
export const ASSET_IMPORT_STAGING_PREFIX = "admin-assets-imports";
export const ASSET_IMPORT_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const ASSET_IMPORT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

const ADMIN_ASSET_ROOT = "admin-assets";
const JOBS_TABLE = "admin_asset_import_jobs";
const ITEMS_TABLE = "admin_asset_import_items";
const TERMINAL = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function safeSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "asset";
}

export function normalizeImportFolder(value: string) {
  const folder = value
    .split("/")
    .map(safeSegment)
    .filter(Boolean)
    .join("/");
  return folder || "uploads";
}

export function isZipUpload(name: string, contentType: string) {
  const mime = contentType.toLowerCase();
  return name.toLowerCase().endsWith(".zip") || [
    "application/zip",
    "application/x-zip-compressed",
    "application/x-zip",
  ].includes(mime);
}

function jobSelect() {
  return "id,created_by,source_filename,source_size,source_content_type,staging_bucket,staging_path,destination_folder,status,phase,total_files,processed_files,success_files,failed_files,current_file,uploaded_bytes,total_bytes,upload_percent,import_percent,overall_percent,worker_task_name,worker_attempts,error_message,started_at,uploaded_at,last_heartbeat_at,created_at,updated_at,completed_at";
}

export async function getImportJob(admin: SupabaseClient, jobId: string) {
  const { data, error } = await admin.from(JOBS_TABLE).select(jobSelect()).eq("id", jobId).maybeSingle();
  if (error) throw new Error(`No se pudo leer el import job: ${error.message}`);
  if (!data) throw new Error("El import job no existe.");
  return normalizeAssetImportJob(data as unknown as Record<string, unknown>);
}

export async function listImportJobs(admin: SupabaseClient, userId: string, limit = 12) {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 12));
  const { data, error } = await admin
    .from(JOBS_TABLE)
    .select(jobSelect())
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(`No se pudieron leer las importaciones: ${error.message}`);
  return (data ?? []).map((row) => normalizeAssetImportJob(row as unknown as Record<string, unknown>));
}

export async function createImportJob(params: {
  admin: SupabaseClient;
  userId: string;
  filename: string;
  size: number;
  contentType: string;
  destinationFolder: string;
  origin?: string | null;
}) {
  const { admin, userId } = params;
  const filename = safeSegment(params.filename);
  const destinationFolder = normalizeImportFolder(params.destinationFolder);
  const contentType = params.contentType || "application/zip";
  if (!isZipUpload(filename, contentType)) throw new Error("El importador persistente acepta archivos ZIP.");
  if (!Number.isFinite(params.size) || params.size <= 0) throw new Error("El ZIP está vacío.");
  if (params.size > ASSET_IMPORT_MAX_ARCHIVE_BYTES) {
    throw new Error(`El ZIP supera el límite de ${Math.round(ASSET_IMPORT_MAX_ARCHIVE_BYTES / 1024 / 1024)} MB.`);
  }

  const id = crypto.randomUUID();
  const stagingPath = `${ASSET_IMPORT_STAGING_PREFIX}/${userId}/${id}/source.zip`;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from(JOBS_TABLE)
    .insert({
      id,
      created_by: userId,
      source_filename: filename,
      source_size: params.size,
      source_content_type: contentType,
      staging_bucket: ASSET_IMPORT_BUCKET,
      staging_path: stagingPath,
      destination_folder: destinationFolder,
      status: "created",
      phase: "preparing",
      total_bytes: params.size,
      updated_at: now,
    })
    .select(jobSelect())
    .single();
  if (error || !data) throw new Error(`No se pudo crear la importación: ${error?.message ?? "sin respuesta"}`);

  try {
    const [uploadUrl] = await getStorage().bucket(ASSET_IMPORT_BUCKET).file(stagingPath).createResumableUpload({
      metadata: {
        contentType,
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          clouvaAssetImportJobId: id,
          originalFilename: filename,
        },
      },
      ...(params.origin ? { origin: params.origin } : {}),
    });

    const { data: updated, error: updateError } = await admin
      .from(JOBS_TABLE)
      .update({
        status: "uploading_archive",
        phase: "uploading",
        started_at: now,
        updated_at: now,
        error_message: null,
      })
      .eq("id", id)
      .select(jobSelect())
      .single();
    if (updateError || !updated) throw new Error(updateError?.message ?? "No se pudo activar la subida.");

    return {
      job: normalizeAssetImportJob(updated as unknown as Record<string, unknown>),
      uploadUrl,
      chunkBytes: ASSET_IMPORT_UPLOAD_CHUNK_BYTES,
      maxArchiveBytes: ASSET_IMPORT_MAX_ARCHIVE_BYTES,
    };
  } catch (error) {
    await admin.from(JOBS_TABLE).update({
      status: "failed",
      phase: "failed",
      error_message: error instanceof Error ? error.message : "No se pudo iniciar la subida resumible.",
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq("id", id);
    throw error;
  }
}

export async function persistUploadProgress(admin: SupabaseClient, job: AssetImportJob, uploadedBytes: number) {
  const clampedBytes = Math.max(0, Math.min(job.totalBytes, Math.trunc(uploadedBytes)));
  const uploadPercent = job.totalBytes ? Number(((clampedBytes / job.totalBytes) * 100).toFixed(2)) : 0;
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from(JOBS_TABLE)
    .update({
      status: uploadPercent >= 100 ? "archive_uploaded" : "uploading_archive",
      phase: uploadPercent >= 100 ? "analyzing" : "uploading",
      uploaded_bytes: clampedBytes,
      upload_percent: uploadPercent,
      overall_percent: uploadPercent >= 100 ? 30 : Number(uploadOverallPercent(uploadPercent).toFixed(2)),
      uploaded_at: uploadPercent >= 100 ? now : job.uploadedAt,
      last_heartbeat_at: now,
      updated_at: now,
      error_message: null,
    })
    .eq("id", job.id)
    .select(jobSelect())
    .single();
  if (error || !data) throw new Error(`No se pudo guardar el progreso: ${error?.message ?? "sin respuesta"}`);
  return normalizeAssetImportJob(data as unknown as Record<string, unknown>);
}

async function metadataAccessToken() {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`No se pudo obtener credencial de Cloud Tasks (${response.status}).`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Cloud Run no devolvió un access token para Cloud Tasks.");
  return payload.access_token;
}

export async function enqueueImportJob(admin: SupabaseClient, job: AssetImportJob) {
  if (TERMINAL.has(job.status)) return job;

  const project = process.env.CLOUVA_ASSET_IMPORT_TASKS_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const location = process.env.CLOUVA_ASSET_IMPORT_TASKS_LOCATION ?? "us-central1";
  const queue = process.env.CLOUVA_ASSET_IMPORT_TASKS_QUEUE ?? "clouva-asset-imports";
  const appUrl = (process.env.CLOUVA_APP_URL ?? "https://clouva.com.ar").replace(/\/$/, "");
  const workerUrl = process.env.CLOUVA_ASSET_IMPORT_WORKER_URL ?? `${appUrl}/api/internal/admin/assets/imports/process`;
  const workerSecret = process.env.CLOUVA_ASSET_IMPORT_WORKER_SECRET ?? "";
  if (!project) throw new Error("Falta CLOUVA_ASSET_IMPORT_TASKS_PROJECT/GOOGLE_CLOUD_PROJECT.");
  if (!workerSecret) throw new Error("Falta CLOUVA_ASSET_IMPORT_WORKER_SECRET.");

  const now = new Date().toISOString();
  await admin.from(JOBS_TABLE).update({
    status: "queued",
    phase: "analyzing",
    updated_at: now,
    error_message: null,
  }).eq("id", job.id);

  try {
    const token = await metadataAccessToken();
    const parent = `projects/${project}/locations/${location}/queues/${queue}`;
    const taskResponse = await fetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: workerUrl,
            headers: {
              "Content-Type": "application/json",
              "X-Clouva-Worker-Secret": workerSecret,
            },
            body: Buffer.from(JSON.stringify({ jobId: job.id }), "utf8").toString("base64"),
          },
          dispatchDeadline: "1800s",
        },
      }),
    });
    const payload = await taskResponse.json().catch(() => ({})) as { name?: string; error?: { message?: string } };
    if (!taskResponse.ok) {
      const taskMessage = payload.error?.message ?? `Cloud Tasks respondió ${taskResponse.status}.`;
      if (taskResponse.status === 404 || /queue does not exist/i.test(taskMessage)) {
        console.warn("[admin-assets-import] Cloud Tasks queue unavailable; processing inline", {
          jobId: job.id,
          status: taskResponse.status,
          message: taskMessage,
        });
        return await processAssetImportJob(job.id);
      }
      throw new Error(taskMessage);
    }

    const { data, error } = await admin
      .from(JOBS_TABLE)
      .update({ worker_task_name: payload.name ?? null, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .select(jobSelect())
      .single();
    if (error || !data) throw new Error(error?.message ?? "No se pudo guardar el task id.");
    return normalizeAssetImportJob(data as unknown as Record<string, unknown>);
  } catch (error) {
    await admin.from(JOBS_TABLE).update({
      status: "archive_uploaded",
      phase: "analyzing",
      error_message: error instanceof Error ? error.message : "No se pudo encolar la importación.",
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw error;
  }
}

function entryDestinationPath(entry: AssetPackEntryDescriptor) {
  return `${ADMIN_ASSET_ROOT}/${entry.destinationFolder}/${entry.fileName}`;
}

async function ensureImportItems(admin: SupabaseClient, jobId: string, entries: AssetPackEntryDescriptor[]) {
  if (!entries.length) return;
  const now = new Date().toISOString();
  const payload = entries.map((entry) => ({
    job_id: jobId,
    original_path: entry.originalPath,
    filename: entry.fileName,
    destination_path: entryDestinationPath(entry),
    content_type: entry.contentType,
    size: entry.uncompressedSize,
    status: "pending",
    updated_at: now,
  }));
  for (let index = 0; index < payload.length; index += 100) {
    const { error } = await admin.from(ITEMS_TABLE).upsert(payload.slice(index, index + 100), {
      onConflict: "job_id,original_path",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`No se pudo preparar el detalle de assets: ${error.message}`);
  }
}

async function itemStatusMap(admin: SupabaseClient, jobId: string) {
  const { data, error } = await admin
    .from(ITEMS_TABLE)
    .select("id,original_path,status")
    .eq("job_id", jobId);
  if (error) throw new Error(`No se pudo leer el detalle del import: ${error.message}`);
  return new Map((data ?? []).map((row) => [String(row.original_path), {
    id: String(row.id),
    status: String(row.status),
  }]));
}

async function updateWorkerJob(admin: SupabaseClient, jobId: string, values: Record<string, unknown>) {
  const { error } = await admin.from(JOBS_TABLE).update({
    ...values,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
  if (error) throw new Error(`No se pudo persistir el worker: ${error.message}`);
}

export async function processAssetImportJob(jobId: string) {
  const admin = createAdminSupabase();
  let job = await getImportJob(admin, jobId);
  if (TERMINAL.has(job.status)) return job;
  if (job.uploadPercent < 100 && job.status !== "archive_uploaded" && job.status !== "queued") {
    throw new Error("El ZIP todavía no terminó de subir.");
  }

  const now = new Date().toISOString();
  await admin.from(JOBS_TABLE).update({
    status: "extracting",
    phase: "analyzing",
    worker_attempts: job.workerAttempts + 1,
    started_at: job.startedAt ?? now,
    last_heartbeat_at: now,
    updated_at: now,
    error_message: null,
  }).eq("id", job.id);

  try {
    const bucket = getStorage().bucket(job.stagingBucket);
    const source = bucket.file(job.stagingPath);
    const [exists] = await source.exists();
    if (!exists) throw new Error("El ZIP de staging ya no existe.");
    const [metadata] = await source.getMetadata();
    const storedSize = Number(metadata.size ?? 0);
    if (storedSize !== job.sourceSize) {
      throw new Error(`El ZIP de staging mide ${storedSize} bytes y se esperaban ${job.sourceSize}.`);
    }

    const [archive] = await source.download();
    const entries = inspectAssetPack(archive);
    await ensureImportItems(admin, job.id, entries);

    // A retry after a crashed worker can safely reclaim an entry that was left in processing.
    await admin.from(ITEMS_TABLE).update({
      status: "pending",
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("job_id", job.id).eq("status", "processing");

    const states = await itemStatusMap(admin, job.id);
    let successFiles = 0;
    let failedFiles = 0;
    for (const state of states.values()) {
      if (state.status === "completed" || state.status === "skipped") successFiles += 1;
      if (state.status === "failed") failedFiles += 1;
    }
    let processedFiles = successFiles + failedFiles;
    const totalFiles = entries.length;
    const initialImportPercent = totalFiles ? (processedFiles / totalFiles) * 100 : 100;
    await updateWorkerJob(admin, job.id, {
      status: "importing",
      phase: "importing",
      total_files: totalFiles,
      processed_files: processedFiles,
      success_files: successFiles,
      failed_files: failedFiles,
      import_percent: Number(initialImportPercent.toFixed(2)),
      overall_percent: Number(importOverallPercent(initialImportPercent).toFixed(2)),
    });

    const sourcePack = safeSegment(job.sourceFilename);
    for (const entry of entries) {
      const state = states.get(entry.originalPath);
      if (state?.status === "completed" || state?.status === "skipped" || state?.status === "failed") continue;
      if (!state?.id) throw new Error(`No existe metadata para ${entry.originalPath}.`);

      const itemStartedAt = new Date().toISOString();
      await admin.from(ITEMS_TABLE).update({
        status: "processing",
        error_message: null,
        started_at: itemStartedAt,
        updated_at: itemStartedAt,
      }).eq("id", state.id);
      await updateWorkerJob(admin, job.id, {
        status: "importing",
        phase: "importing",
        current_file: entry.fileName,
      });

      try {
        const extracted = extractAssetPackEntry(archive, entry);
        const objectPath = entryDestinationPath(entry);
        await bucket.file(objectPath).save(extracted.bytes, {
          resumable: false,
          contentType: entry.contentType,
          metadata: {
            cacheControl: "public, max-age=300",
            metadata: {
              importedFromAssetPack: "true",
              sourcePack,
              variant: entry.variant,
              platform: entry.platform,
              originalArchivePath: entry.originalPath.slice(0, 1024),
              importJobId: job.id,
            },
          },
        });
        successFiles += 1;
        await admin.from(ITEMS_TABLE).update({
          status: "completed",
          error_message: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", state.id);
      } catch (error) {
        failedFiles += 1;
        await admin.from(ITEMS_TABLE).update({
          status: "failed",
          error_message: (error instanceof Error ? error.message : "No se pudo importar el asset.").slice(0, 1000),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", state.id);
      }

      processedFiles += 1;
      const importPercent = totalFiles ? (processedFiles / totalFiles) * 100 : 100;
      await updateWorkerJob(admin, job.id, {
        processed_files: processedFiles,
        success_files: successFiles,
        failed_files: failedFiles,
        import_percent: Number(importPercent.toFixed(2)),
        overall_percent: Number(importOverallPercent(importPercent).toFixed(2)),
      });
    }

    const finalStatus = failedFiles > 0 ? "completed_with_errors" : "completed";
    const completedAt = new Date().toISOString();
    await updateWorkerJob(admin, job.id, {
      status: finalStatus,
      phase: "completed",
      processed_files: processedFiles,
      success_files: successFiles,
      failed_files: failedFiles,
      current_file: null,
      import_percent: 100,
      overall_percent: 100,
      completed_at: completedAt,
      error_message: failedFiles > 0 ? `${failedFiles} asset${failedFiles === 1 ? "" : "s"} no se pudieron importar.` : null,
    });

    await source.delete({ ignoreNotFound: true }).catch((error) => {
      console.error("[admin-assets-import] staging cleanup failed", error);
    });
    job = await getImportJob(admin, job.id);
    return job;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falló la importación del ZIP.";
    await admin.from(JOBS_TABLE).update({
      status: "failed",
      phase: "failed",
      current_file: null,
      error_message: message.slice(0, 1500),
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw error;
  }
}
