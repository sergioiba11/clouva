"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { registerAssetZipUploadHandler } from "@/lib/admin-assets/client-upload-interceptor";
import {
  isAssetImportActive,
  type AssetImportItem,
  type AssetImportJob,
} from "@/lib/admin-assets/import-types";

type PreparedImport = {
  job: AssetImportJob;
  uploadUrl: string;
  chunkBytes: number;
  maxArchiveBytes: number;
};

type StoredUpload = {
  id: "active";
  jobId: string;
  uploadUrl: string;
  file: File;
  chunkBytes: number;
  uploadedBytes: number;
  totalBytes: number;
  createdAt: number;
};

type AssetImportContextValue = {
  jobs: AssetImportJob[];
  activeJob: AssetImportJob | null;
  localUploadedBytes: number | null;
  localUploadPercent: number | null;
  starting: boolean;
  uploadError: string | null;
  recoveryWarning: string | null;
  completionVersion: number;
  startZipImport: (file: File, destinationFolder: string) => Promise<AssetImportJob>;
  refreshJobs: () => Promise<void>;
  loadItems: (jobId: string) => Promise<AssetImportItem[]>;
};

const AssetImportContext = createContext<AssetImportContextValue | null>(null);
const DB_NAME = "clouva-admin-asset-imports";
const DB_VERSION = 1;
const STORE_NAME = "resumable-uploads";
const TERMINAL_IMPORT_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

async function readStoredUpload() {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise<StoredUpload | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get("active");
    request.onsuccess = () => resolve((request.result as StoredUpload | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("No se pudo recuperar la subida."));
    tx.oncomplete = () => db.close();
  });
}

async function writeStoredUpload(record: StoredUpload) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo persistir la subida."));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB canceló la persistencia."));
  });
  db.close();
}

async function deleteStoredUpload() {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("active");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("No se pudo limpiar la sesión de subida."));
  });
  db.close();
}

function parseConfirmedOffset(rangeHeader: string | null, fallback: number) {
  const match = rangeHeader?.match(/bytes=0-(\d+)/i);
  if (!match) return fallback;
  const lastByte = Number(match[1]);
  return Number.isFinite(lastByte) ? lastByte + 1 : fallback;
}

function xhrRequest(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Blob | null;
  onProgress?: (loaded: number) => void;
}) {
  return new Promise<{ status: number; range: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(params.method ?? "PUT", params.url, true);
    for (const [key, value] of Object.entries(params.headers ?? {})) xhr.setRequestHeader(key, value);
    if (params.onProgress) xhr.upload.onprogress = (event) => params.onProgress?.(event.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    xhr.onerror = () => reject(new Error("Se cortó la conexión con Google Cloud Storage."));
    xhr.onabort = () => reject(new Error("La subida fue cancelada."));
    xhr.send(params.body ?? null);
  });
}

async function queryResumableOffset(record: StoredUpload) {
  const result = await xhrRequest({
    url: record.uploadUrl,
    headers: { "Content-Range": `bytes */${record.totalBytes}` },
  });
  if (result.status === 200 || result.status === 201) return record.totalBytes;
  if (result.status === 308) return parseConfirmedOffset(result.range, record.uploadedBytes);
  if (result.status === 404 || result.status === 410) {
    throw new Error("La sesión resumible de Google Cloud expiró. Volvé a seleccionar el ZIP para crear una sesión nueva.");
  }
  throw new Error(`Google Cloud no pudo recuperar el offset de la subida (${result.status}).`);
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function AssetImportProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<AssetImportJob[]>([]);
  const [localUploadedBytes, setLocalUploadedBytes] = useState<number | null>(null);
  const [localTotalBytes, setLocalTotalBytes] = useState<number | null>(null);
  const [localJobId, setLocalJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
  const [completionVersion, setCompletionVersion] = useState(0);
  const runningRef = useRef<string | null>(null);
  const recoveryAttemptsRef = useRef<Set<string>>(new Set());
  const previousStatusesRef = useRef<Map<string, string>>(new Map());

  const refreshJobs = useCallback(async () => {
    const response = await authenticatedFetch("/api/admin/assets/imports?limit=12", { cache: "no-store" });
    const payload = await readApiJson<{ jobs: AssetImportJob[] }>(response);
    setJobs(payload.jobs ?? []);

    const previous = previousStatusesRef.current;
    let completedNow = false;
    const next = new Map<string, string>();
    for (const job of payload.jobs ?? []) {
      const prior = previous.get(job.id);
      next.set(job.id, job.status);
      if (prior && prior !== job.status && ["completed", "completed_with_errors"].includes(job.status)) completedNow = true;
    }
    previousStatusesRef.current = next;
    if (completedNow) setCompletionVersion((value) => value + 1);
  }, []);

  const persistProgress = useCallback(async (jobId: string, uploadedBytes: number) => {
    const response = await authenticatedFetch("/api/admin/assets/imports/progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, uploadedBytes }),
    });
    await readApiJson(response);
  }, []);

  const completeUpload = useCallback(async (jobId: string) => {
    const response = await authenticatedFetch("/api/admin/assets/imports/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    await readApiJson(response);
  }, []);

  const runUpload = useCallback(async (initial: StoredUpload) => {
    if (runningRef.current) return;
    runningRef.current = initial.jobId;
    setUploadError(null);
    setLocalJobId(initial.jobId);
    setLocalTotalBytes(initial.totalBytes);

    try {
      let record = initial;
      let confirmed = await queryResumableOffset(record);
      setLocalUploadedBytes(confirmed);
      if (confirmed !== record.uploadedBytes) {
        record = { ...record, uploadedBytes: confirmed };
        await writeStoredUpload(record).catch(() => undefined);
        await persistProgress(record.jobId, confirmed);
      }

      while (confirmed < record.totalBytes) {
        const start = confirmed;
        const endExclusive = Math.min(record.totalBytes, start + record.chunkBytes);
        const chunk = record.file.slice(start, endExclusive);
        const endInclusive = endExclusive - 1;
        const result = await xhrRequest({
          url: record.uploadUrl,
          headers: {
            "Content-Type": record.file.type || "application/zip",
            "Content-Range": `bytes ${start}-${endInclusive}/${record.totalBytes}`,
          },
          body: chunk,
          onProgress: (loaded) => setLocalUploadedBytes(Math.min(record.totalBytes, start + loaded)),
        });

        if (![200, 201, 308].includes(result.status)) {
          throw new Error(`Google Cloud rechazó un bloque del ZIP (${result.status}).`);
        }
        confirmed = result.status === 308
          ? parseConfirmedOffset(result.range, endExclusive)
          : record.totalBytes;
        record = { ...record, uploadedBytes: confirmed };
        setLocalUploadedBytes(confirmed);
        await writeStoredUpload(record).catch((error) => {
          setRecoveryWarning(error instanceof Error ? error.message : "No se pudo actualizar la recuperación local.");
        });
        await persistProgress(record.jobId, confirmed);
      }

      await completeUpload(record.jobId);
      await deleteStoredUpload().catch(() => undefined);
      setLocalUploadedBytes(record.totalBytes);
      setLocalTotalBytes(record.totalBytes);
      await refreshJobs();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "No se pudo completar la subida resumible.");
      await refreshJobs().catch(() => undefined);
    } finally {
      runningRef.current = null;
    }
  }, [completeUpload, persistProgress, refreshJobs]);

  const startZipImport = useCallback(async (file: File, destinationFolder: string) => {
    setStarting(true);
    setUploadError(null);
    setRecoveryWarning(null);
    try {
      if (!file.name.toLowerCase().endsWith(".zip") && !/zip/i.test(file.type)) {
        throw new Error("Seleccioná un archivo ZIP para la importación persistente.");
      }
      if (navigator.storage?.persist) {
        await navigator.storage.persist().catch(() => false);
      }

      const response = await authenticatedFetch("/api/admin/assets/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          contentType: file.type || "application/zip",
          destinationFolder,
        }),
      });
      const prepared = await readApiJson<PreparedImport>(response);
      const record: StoredUpload = {
        id: "active",
        jobId: prepared.job.id,
        uploadUrl: prepared.uploadUrl,
        file,
        chunkBytes: prepared.chunkBytes,
        uploadedBytes: 0,
        totalBytes: file.size,
        createdAt: Date.now(),
      };

      try {
        await writeStoredUpload(record);
      } catch (error) {
        setRecoveryWarning("La subida empezó, pero este navegador no pudo guardar el ZIP en IndexedDB para recuperarlo después de un cierre completo.");
        console.error("[admin-assets-import] IndexedDB persistence failed", error);
      }
      setJobs((current) => [prepared.job, ...current.filter((job) => job.id !== prepared.job.id)]);
      setLocalJobId(prepared.job.id);
      setLocalUploadedBytes(0);
      setLocalTotalBytes(file.size);
      void runUpload(record);
      return prepared.job;
    } finally {
      setStarting(false);
    }
  }, [runUpload]);

  const waitForImport = useCallback(async (jobId: string) => {
    const deadline = Date.now() + 2 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const response = await authenticatedFetch("/api/admin/assets/imports?limit=50", { cache: "no-store" });
      const payload = await readApiJson<{ jobs: AssetImportJob[] }>(response);
      setJobs(payload.jobs ?? []);
      const job = (payload.jobs ?? []).find((candidate) => candidate.id === jobId);
      if (!job) throw new Error("La importación dejó de aparecer en el historial.");
      if (TERMINAL_IMPORT_STATUSES.has(job.status)) {
        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.errorMessage ?? "La importación no pudo completarse.");
        }
        return job;
      }
      await sleep(1500);
    }
    throw new Error("La importación sigue activa, pero la espera de esta pantalla superó dos horas. El job continúa registrado en CLOUVA.");
  }, []);

  useEffect(() => registerAssetZipUploadHandler(async ({ file, destinationFolder }) => {
    const job = await startZipImport(file, destinationFolder);
    const completed = await waitForImport(job.id);
    return {
      ok: true,
      kind: "asset-pack",
      imported: completed.successFiles,
      asset: null,
    };
  }), [startZipImport, waitForImport]);

  const loadItems = useCallback(async (jobId: string) => {
    const response = await authenticatedFetch(`/api/admin/assets/imports/items?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const payload = await readApiJson<{ items: AssetImportItem[] }>(response);
    return payload.items ?? [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshJobs().catch((error) => {
        if (!cancelled) setUploadError(error instanceof Error ? error.message : "No se pudieron cargar las importaciones.");
      });
      try {
        const stored = await readStoredUpload();
        if (!cancelled && stored) {
          setLocalJobId(stored.jobId);
          setLocalUploadedBytes(stored.uploadedBytes);
          setLocalTotalBytes(stored.totalBytes);
          void runUpload(stored);
        }
      } catch (error) {
        if (!cancelled) setRecoveryWarning(error instanceof Error ? error.message : "No se pudo recuperar la subida pendiente.");
      }
    })();
    return () => { cancelled = true; };
  }, [refreshJobs, runUpload]);

  useEffect(() => {
    const recoverable = jobs.find((job) =>
      job.status === "archive_uploaded"
      && job.uploadPercent >= 100
      && !recoveryAttemptsRef.current.has(job.id)
    );
    if (!recoverable || runningRef.current === recoverable.id) return;

    recoveryAttemptsRef.current.add(recoverable.id);
    void completeUpload(recoverable.id)
      .then(() => refreshJobs())
      .catch((error) => {
        setUploadError(error instanceof Error ? error.message : "No se pudo reanudar la importación.");
        void refreshJobs().catch(() => undefined);
      });
  }, [jobs, completeUpload, refreshJobs]);

  const hasActiveJob = jobs.some((job) => isAssetImportActive(job.status));
  useEffect(() => {
    if (!hasActiveJob && !runningRef.current) return;
    const timer = window.setInterval(() => { void refreshJobs().catch(() => undefined); }, 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, refreshJobs]);

  const activeJob = useMemo(() => {
    if (localJobId) {
      const local = jobs.find((job) => job.id === localJobId);
      if (local && isAssetImportActive(local.status)) return local;
    }
    return jobs.find((job) => isAssetImportActive(job.status)) ?? jobs[0] ?? null;
  }, [jobs, localJobId]);

  const localUploadPercent = localUploadedBytes != null && localTotalBytes
    ? Math.max(0, Math.min(100, (localUploadedBytes / localTotalBytes) * 100))
    : null;

  const value = useMemo<AssetImportContextValue>(() => ({
    jobs,
    activeJob,
    localUploadedBytes: activeJob?.id === localJobId ? localUploadedBytes : null,
    localUploadPercent: activeJob?.id === localJobId ? localUploadPercent : null,
    starting,
    uploadError,
    recoveryWarning,
    completionVersion,
    startZipImport,
    refreshJobs,
    loadItems,
  }), [
    jobs,
    activeJob,
    localJobId,
    localUploadedBytes,
    localUploadPercent,
    starting,
    uploadError,
    recoveryWarning,
    completionVersion,
    startZipImport,
    refreshJobs,
    loadItems,
  ]);

  return <AssetImportContext.Provider value={value}>{children}</AssetImportContext.Provider>;
}

export function useAssetImport() {
  const context = useContext(AssetImportContext);
  if (!context) throw new Error("useAssetImport debe usarse dentro de AssetImportProvider.");
  return context;
}
