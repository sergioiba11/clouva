export type AssetImportStatus =
  | "created"
  | "uploading_archive"
  | "archive_uploaded"
  | "queued"
  | "extracting"
  | "importing"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

export type AssetImportPhase =
  | "preparing"
  | "uploading"
  | "analyzing"
  | "importing"
  | "completed"
  | "failed"
  | "cancelled";

export type AssetImportItemStatus = "pending" | "processing" | "completed" | "failed" | "skipped";

export type AssetImportJob = {
  id: string;
  createdBy: string | null;
  sourceFilename: string;
  sourceSize: number;
  sourceContentType: string;
  stagingBucket: string;
  stagingPath: string;
  destinationFolder: string;
  status: AssetImportStatus;
  phase: AssetImportPhase;
  totalFiles: number;
  processedFiles: number;
  successFiles: number;
  failedFiles: number;
  currentFile: string | null;
  uploadedBytes: number;
  totalBytes: number;
  uploadPercent: number;
  importPercent: number;
  overallPercent: number;
  workerTaskName: string | null;
  workerAttempts: number;
  errorMessage: string | null;
  startedAt: string | null;
  uploadedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AssetImportItem = {
  id: string;
  jobId: string;
  originalPath: string;
  filename: string;
  destinationPath: string;
  contentType: string;
  size: number;
  status: AssetImportItemStatus;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const ACTIVE_ASSET_IMPORT_STATUSES = new Set<AssetImportStatus>([
  "created",
  "uploading_archive",
  "archive_uploaded",
  "queued",
  "extracting",
  "importing",
]);

export const TERMINAL_ASSET_IMPORT_STATUSES = new Set<AssetImportStatus>([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
]);

export function isAssetImportActive(status: AssetImportStatus) {
  return ACTIVE_ASSET_IMPORT_STATUSES.has(status);
}

export function uploadOverallPercent(uploadPercent: number) {
  return Math.max(0, Math.min(30, uploadPercent * 0.3));
}

export function importOverallPercent(importPercent: number) {
  return Math.max(30, Math.min(100, 30 + importPercent * 0.7));
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function normalizeAssetImportJob(row: Record<string, unknown>): AssetImportJob {
  return {
    id: String(row.id ?? ""),
    createdBy: text(row.created_by),
    sourceFilename: String(row.source_filename ?? ""),
    sourceSize: num(row.source_size),
    sourceContentType: String(row.source_content_type ?? "application/zip"),
    stagingBucket: String(row.staging_bucket ?? ""),
    stagingPath: String(row.staging_path ?? ""),
    destinationFolder: String(row.destination_folder ?? "uploads"),
    status: String(row.status ?? "failed") as AssetImportStatus,
    phase: String(row.phase ?? "failed") as AssetImportPhase,
    totalFiles: num(row.total_files),
    processedFiles: num(row.processed_files),
    successFiles: num(row.success_files),
    failedFiles: num(row.failed_files),
    currentFile: text(row.current_file),
    uploadedBytes: num(row.uploaded_bytes),
    totalBytes: num(row.total_bytes),
    uploadPercent: num(row.upload_percent),
    importPercent: num(row.import_percent),
    overallPercent: num(row.overall_percent),
    workerTaskName: text(row.worker_task_name),
    workerAttempts: num(row.worker_attempts),
    errorMessage: text(row.error_message),
    startedAt: text(row.started_at),
    uploadedAt: text(row.uploaded_at),
    lastHeartbeatAt: text(row.last_heartbeat_at),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    updatedAt: String(row.updated_at ?? new Date(0).toISOString()),
    completedAt: text(row.completed_at),
  };
}

export function normalizeAssetImportItem(row: Record<string, unknown>): AssetImportItem {
  return {
    id: String(row.id ?? ""),
    jobId: String(row.job_id ?? ""),
    originalPath: String(row.original_path ?? ""),
    filename: String(row.filename ?? ""),
    destinationPath: String(row.destination_path ?? ""),
    contentType: String(row.content_type ?? "application/octet-stream"),
    size: num(row.size),
    status: String(row.status ?? "pending") as AssetImportItemStatus,
    errorMessage: text(row.error_message),
    startedAt: text(row.started_at),
    completedAt: text(row.completed_at),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    updatedAt: String(row.updated_at ?? new Date(0).toISOString()),
  };
}
