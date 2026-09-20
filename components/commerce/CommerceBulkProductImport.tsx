"use client";

import { Boxes, CheckCircle2, ImagePlus, LoaderCircle, RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type BatchGroup = {
  groupKey: string;
  name: string;
  brand: string;
  model: string;
  identifier: { value: string; type: string } | null;
  confidence: number;
  needsReview: boolean;
  images: Array<{ sourceIndex: number; role: "Frente" | "Atrás" | "Detalle" }>;
};

type AnalyzeResponse = {
  batchId: string;
  status: string;
  totalImages: number;
  detectedProducts: number;
  groups: BatchGroup[];
};

type ProcessResponse = {
  batchId: string;
  status: "processing" | "completed" | "completed_with_errors";
  processed: number;
  failed: number;
  remaining: number;
  results: Array<{
    groupKey: string;
    ok: boolean;
    listingId?: string;
    name?: string;
    identifier?: { value: string; type: string };
    error?: string;
  }>;
};

type PreparedImage = {
  file: File;
  dataUrl: string;
};

const MAX_BATCH_IMAGES = 80;

function imageToJpegDataUrl(source: CanvasImageSource, width: number, height: number) {
  const maxSide = 1440;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: no es una imagen.`);
  const bitmap = await createImageBitmap(file);
  try {
    return {
      file,
      dataUrl: imageToJpegDataUrl(bitmap, bitmap.width, bitmap.height),
    };
  } finally {
    bitmap.close();
  }
}

async function postJson<T>(url: string, body: unknown) {
  const response = await authenticatedFetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return readApiJson<T>(response);
}

export function CommerceBulkProductImport({
  studioId,
  onCompleted,
}: {
  studioId: string;
  onCompleted?: () => void | Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "analyzing" | "creating" | "done" | "error">("idle");
  const [uploaded, setUploaded] = useState(0);
  const [batchId, setBatchId] = useState("");
  const [groups, setGroups] = useState<BatchGroup[]>([]);
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [processResults, setProcessResults] = useState<ProcessResponse["results"]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const busy = ["preparing", "uploading", "analyzing", "creating"].includes(stage);
  const progressText = useMemo(() => {
    if (stage === "preparing") return `Preparando ${files.length} imágenes…`;
    if (stage === "uploading") return `Subiendo ${uploaded}/${files.length}…`;
    if (stage === "analyzing") return "Google Cloud está separando las fotos por producto…";
    if (stage === "creating") return `Creando borradores ${processed}/${groups.length}…`;
    if (stage === "done") return failed
      ? `${processed} productos creados · ${failed} necesitan reintento`
      : `${processed} productos creados en SIZ`;
    return "";
  }, [failed, files.length, groups.length, processed, stage, uploaded]);

  function chooseFiles(list: FileList | null) {
    if (busy) return;
    const incoming = Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
    if (!incoming.length) return;
    setFiles(incoming.slice(0, MAX_BATCH_IMAGES));
    setGroups([]);
    setBatchId("");
    setUploaded(0);
    setProcessed(0);
    setFailed(0);
    setProcessResults([]);
    setError(incoming.length > MAX_BATCH_IMAGES
      ? `Se tomaron las primeras ${MAX_BATCH_IMAGES} imágenes del lote.`
      : "");
    setStage("idle");
  }

  function removeFile(index: number) {
    if (busy) return;
    setFiles((current) => current.filter((_, candidate) => candidate !== index));
  }

  function reset() {
    if (busy) return;
    setFiles([]);
    setGroups([]);
    setBatchId("");
    setUploaded(0);
    setProcessed(0);
    setFailed(0);
    setProcessResults([]);
    setError("");
    setStage("idle");
  }

  async function uploadPrepared(batch: string, prepared: PreparedImage[]) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < prepared.length) {
        const index = cursor++;
        const image = prepared[index];
        await postJson(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}/items`,
          {
            sourceIndex: index,
            fileName: image.file.name,
            dataUrl: image.dataUrl,
          },
        );
        setUploaded((value) => value + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, prepared.length) }, () => worker()));
  }

  async function processUntilFinished(batch: string, retryFailed = false) {
    let first = true;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await postJson<ProcessResponse>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}/process`,
        { retryFailed: retryFailed && first },
      );
      first = false;
      setProcessed(result.processed);
      setFailed(result.failed);
      setProcessResults((current) => {
        const merged = new Map(current.map((item) => [item.groupKey, item]));
        for (const item of result.results) merged.set(item.groupKey, item);
        return Array.from(merged.values());
      });
      if (result.remaining <= 0) {
        setStage("done");
        await onCompleted?.();
        return result;
      }
    }
    throw new Error("El lote superó el número esperado de ciclos de procesamiento.");
  }

  async function start() {
    if (!files.length || busy) return;
    setError("");
    setGroups([]);
    setUploaded(0);
    setProcessed(0);
    setFailed(0);
    setProcessResults([]);
    try {
      setStage("preparing");
      const prepared: PreparedImage[] = [];
      for (const file of files) prepared.push(await prepareImage(file));

      const created = await postJson<{ batch: { id: string } }>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches`,
        { imageCount: prepared.length },
      );
      const id = created.batch.id;
      setBatchId(id);

      setStage("uploading");
      await uploadPrepared(id, prepared);

      setStage("analyzing");
      const analyzed = await postJson<AnalyzeResponse>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(id)}/analyze`,
        {},
      );
      setGroups(analyzed.groups);

      setStage("creating");
      await processUntilFinished(id);
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo completar la carga masiva.");
    }
  }

  async function retryFailed() {
    if (!batchId || busy || !failed) return;
    setError("");
    setStage("creating");
    try {
      await processUntilFinished(batchId, true);
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudieron reintentar los productos.");
    }
  }

  return (
    <section className="rounded-2xl border border-violet-400/15 bg-violet-500/[0.045] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-violet-200">
            <Boxes className="h-4 w-4" />
            <p className="text-xs font-semibold uppercase tracking-[.18em]">Carga masiva</p>
          </div>
          <h2 className="mt-2 text-lg font-semibold">Fotos → productos separados</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">
            Seleccioná fotos de varios productos juntas. Google Cloud agrupa las vistas del mismo artículo y CLOUVA crea un borrador independiente por producto.
          </p>
        </div>
        {files.length && !busy ? (
          <button type="button" onClick={reset} className="rounded-lg border border-white/10 p-2 text-white/45 transition hover:text-white" aria-label="Limpiar lote">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {!files.length ? (
        <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-400/25 bg-black/15 px-4 text-center transition hover:border-violet-400/45">
          <ImagePlus className="h-7 w-7 text-violet-300" />
          <strong className="mt-2 text-sm">Seleccionar todas las fotos</strong>
          <span className="mt-1 text-[11px] text-white/35">Hasta {MAX_BATCH_IMAGES} imágenes por lote</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => {
              chooseFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {files.map((file, index) => (
              <div key={`${file.name}:${file.lastModified}:${index}`} className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/25">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[index]} alt="" className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] text-white/75">{index + 1}</span>
                {!busy ? (
                  <button type="button" onClick={() => removeFile(index)} className="absolute right-1 top-1 rounded-md bg-black/75 p-1 text-white/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? progressText : `Cargar y crear productos (${files.length})`}
            </button>
            {stage === "done" && failed > 0 ? (
              <button type="button" onClick={() => void retryFailed()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-4 text-sm font-semibold text-amber-100">
                <RefreshCw className="h-4 w-4" /> Reintentar {failed}
              </button>
            ) : null}
          </div>
        </>
      )}

      {progressText && !busy ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] px-3 py-2 text-xs text-emerald-100">
          <CheckCircle2 className="h-4 w-4" /> {progressText}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-300/15 bg-rose-300/[0.05] px-3 py-2 text-xs leading-5 text-rose-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      ) : null}

      {groups.length ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Productos detectados</p>
            <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">{groups.length}</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {groups.map((group) => {
              const result = processResults.find((candidate) => candidate.groupKey === group.groupKey);
              return (
                <div key={group.groupKey} className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-sm">{result?.name || group.name || "Producto detectado"}</strong>
                      <p className="mt-1 truncate text-[10px] text-white/38">
                        {[group.brand, group.model, group.identifier?.value].filter(Boolean).join(" · ") || `${group.images.length} fotos`}
                      </p>
                    </div>
                    {result?.ok ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                    ) : result?.ok === false ? (
                      <TriangleAlert className="h-4 w-4 shrink-0 text-rose-300" />
                    ) : group.needsReview ? (
                      <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" />
                    ) : (
                      <span className="text-[10px] text-white/35">{Math.round(group.confidence * 100)}%</span>
                    )}
                  </div>
                  <p className="mt-2 text-[10px] text-white/35">
                    {group.images.map((image) => `#${image.sourceIndex + 1} ${image.role}`).join(" · ")}
                  </p>
                  {result?.error ? <p className="mt-2 text-[10px] leading-4 text-rose-200">{result.error}</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
