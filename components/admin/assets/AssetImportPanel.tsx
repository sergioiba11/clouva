"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, PackageOpen, XCircle } from "lucide-react";
import { useAssetImport } from "@/components/admin/assets/AssetImportProvider";
import { uploadOverallPercent, type AssetImportItem } from "@/lib/admin-assets/import-types";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function phaseLabel(status: string) {
  if (status === "created") return "PREPARANDO";
  if (status === "uploading_archive") return "SUBIENDO ZIP";
  if (status === "archive_uploaded" || status === "queued" || status === "extracting") return "ANALIZANDO ZIP";
  if (status === "importing") return "IMPORTANDO ASSETS";
  if (status === "completed" || status === "completed_with_errors") return "COMPLETADO";
  if (status === "failed") return "ERROR";
  if (status === "cancelled") return "CANCELADO";
  return status.toUpperCase();
}

export function AssetImportPanel() {
  const {
    activeJob,
    localUploadedBytes,
    localUploadPercent,
    uploadError,
    recoveryWarning,
    loadItems,
  } = useAssetImport();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [items, setItems] = useState<AssetImportItem[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    setDetailsOpen(false);
    setItems([]);
  }, [activeJob?.id]);

  useEffect(() => {
    if (!detailsOpen || !activeJob) return;
    let cancelled = false;
    setDetailsLoading(true);
    void loadItems(activeJob.id)
      .then((next) => { if (!cancelled) setItems(next); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [detailsOpen, activeJob, loadItems, activeJob?.processedFiles]);

  const displayedUploadPercent = activeJob?.status === "uploading_archive" && localUploadPercent != null
    ? localUploadPercent
    : activeJob?.uploadPercent ?? 0;
  const displayedUploadedBytes = activeJob?.status === "uploading_archive" && localUploadedBytes != null
    ? localUploadedBytes
    : activeJob?.uploadedBytes ?? 0;
  const overallPercent = activeJob?.status === "uploading_archive" && localUploadPercent != null
    ? uploadOverallPercent(localUploadPercent)
    : activeJob?.overallPercent ?? 0;
  const finished = activeJob ? ["completed", "completed_with_errors"].includes(activeJob.status) : false;
  const failed = activeJob?.status === "failed";

  const visibleItems = useMemo(() => items.slice(-12).reverse(), [items]);

  if (!activeJob && !uploadError && !recoveryWarning) return null;

  return (
    <section className="overflow-hidden rounded-[1.4rem] border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.14),transparent_35%),rgba(11,9,17,.9)]">
      {activeJob ? (
        <div className="p-4 md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                <PackageOpen className="h-3.5 w-3.5" /> Importación de assets
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-white">{activeJob.sourceFilename}</p>
              <p className="mt-0.5 text-xs text-white/35">{formatBytes(activeJob.sourceSize)} · {phaseLabel(activeJob.status)}</p>
            </div>
            <div className="flex items-center gap-2">
              {finished ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : failed ? <XCircle className="h-5 w-5 text-red-300" /> : <Loader2 className="h-5 w-5 animate-spin text-violet-300" />}
              <span className="text-2xl font-semibold tabular-nums">{Math.round(overallPercent)}%</span>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-violet-400 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, overallPercent))}%` }} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.13em] text-white/30">Subida</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{displayedUploadPercent.toFixed(1)}%</p>
              <p className="mt-1 text-[11px] text-white/35">{formatBytes(displayedUploadedBytes)} / {formatBytes(activeJob.totalBytes)}</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.13em] text-white/30">Importación</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{activeJob.processedFiles} / {activeJob.totalFiles || "—"}</p>
              <p className="mt-1 text-[11px] text-white/35">{activeJob.importPercent.toFixed(1)}%</p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.13em] text-white/30">Completados</p>
              <p className="mt-1 text-sm font-semibold text-emerald-200">{activeJob.successFiles}</p>
              <p className="mt-1 text-[11px] text-white/35">Errores: {activeJob.failedFiles}</p>
            </div>
            <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-[0.13em] text-white/30">Ahora</p>
              <p className="mt-1 truncate text-sm font-medium text-white/75">{activeJob.currentFile ?? (finished ? "Importación terminada" : "Preparando…")}</p>
            </div>
          </div>

          {activeJob.errorMessage ? <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-xs text-amber-100/75">{activeJob.errorMessage}</p> : null}

          <button type="button" onClick={() => setDetailsOpen((value) => !value)} className="mt-3 inline-flex items-center gap-2 text-xs text-violet-200/80 hover:text-violet-100">
            {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {detailsOpen ? "Ocultar detalle" : "Ver detalle"}
          </button>

          {detailsOpen ? (
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/25 p-3">
              {detailsLoading && !items.length ? <p className="text-xs text-white/35">Cargando archivos…</p> : null}
              {!detailsLoading && !items.length ? <p className="text-xs text-white/35">Todavía no hay entradas procesadas.</p> : null}
              <div className="space-y-1.5">
                {visibleItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    {item.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : item.status === "failed" ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red-300" /> : item.status === "processing" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-300" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20" />}
                    <span className="min-w-0 flex-1 truncate text-white/60">{item.filename}</span>
                    <span className="shrink-0 text-[10px] uppercase text-white/25">{item.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {uploadError || recoveryWarning ? (
        <div className="border-t border-white/[0.06] px-4 py-3 text-xs md:px-5">
          {uploadError ? <p className="flex items-start gap-2 text-red-200/80"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{uploadError}</p> : null}
          {recoveryWarning ? <p className="mt-1 flex items-start gap-2 text-amber-100/70"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{recoveryWarning}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
