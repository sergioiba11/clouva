"use client";

import { Boxes, CheckCircle2, FileText, ImagePlus, LoaderCircle, RefreshCw, Sparkles, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type BatchGroup = {
  groupKey: string;
  name: string;
  brand: string;
  model: string;
  packageKind: "box" | "retail_package" | "loose_product" | "unknown";
  identifier: { value: string; type: string } | null;
  visibleIdentifiers: Array<{
    value: string;
    type: string;
    source: "box" | "product" | "unknown";
    confidence: number;
  }>;
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
    packageKind?: BatchGroup["packageKind"];
    identifier?: { value: string; type: string };
    visibleIdentifiers?: BatchGroup["visibleIdentifiers"];
    error?: string;
  }>;
};

type InvoiceItem = {
  id: string;
  line_number: number;
  description: string;
  brand: string | null;
  model: string | null;
  supplier_sku: string | null;
  barcode_value: string | null;
  barcode_type: string | null;
  quantity: number;
  unit_price: number | null;
  tax_amount: number | null;
  line_total: number | null;
  matched_group_keys: string[];
  matched_quantity: number;
  match_status: "matched" | "partial" | "unmatched" | "ambiguous";
  checked: boolean;
  metadata: Record<string, unknown>;
};

type InvoicePayload = {
  invoice: {
    id: string;
    supplier_name: string | null;
    supplier_tax_id: string | null;
    document_type: string | null;
    document_number: string | null;
    issued_at: string | null;
    currency: string | null;
    subtotal: number | null;
    tax_amount: number | null;
    total_amount: number | null;
    file_name: string | null;
    source_url: string;
  } | null;
  items: InvoiceItem[];
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

async function prepareDocumentDataUrl(file: File) {
  if (file.type === "application/pdf") {
    if (file.size > 12 * 1024 * 1024) throw new Error("La factura PDF debe pesar hasta 12 MB.");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la factura."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    try {
      return imageToJpegDataUrl(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  throw new Error("La factura debe ser JPG, PNG, WEBP o PDF.");
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
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "analyzing" | "invoice" | "creating" | "done" | "error">("idle");
  const [uploaded, setUploaded] = useState(0);
  const [batchId, setBatchId] = useState("");
  const [groups, setGroups] = useState<BatchGroup[]>([]);
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [processResults, setProcessResults] = useState<ProcessResponse["results"]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoicePayload | null>(null);
  const [checkingInvoiceItem, setCheckingInvoiceItem] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const busy = ["preparing", "uploading", "analyzing", "invoice", "creating"].includes(stage);
  const progressText = useMemo(() => {
    if (stage === "preparing") return `Preparando ${files.length} imágenes…`;
    if (stage === "uploading") return `Subiendo ${uploaded}/${files.length}…`;
    if (stage === "analyzing") return "Google Cloud está separando las fotos por producto…";
    if (stage === "invoice") return "Leyendo factura y armando el checklist…";
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
    setInvoiceData(null);
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
    setInvoiceFile(null);
    setInvoiceData(null);
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

  async function uploadAndAnalyzeInvoice(batch: string, file: File) {
    setStage("invoice");
    const dataUrl = await prepareDocumentDataUrl(file);
    const payload = await postJson<InvoicePayload>(
      `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}/invoice`,
      { fileName: file.name, dataUrl },
    );
    setInvoiceData(payload);
    return payload;
  }

  async function toggleInvoiceItem(item: InvoiceItem, checked: boolean) {
    if (!batchId || checkingInvoiceItem) return;
    setCheckingInvoiceItem(item.id);
    try {
      const response = await authenticatedFetch(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batchId)}/invoice`,
        {
          method: "PATCH",
          body: JSON.stringify({ itemId: item.id, checked }),
        },
      );
      const payload = await readApiJson<{ item: InvoiceItem }>(response);
      setInvoiceData((current) => current
        ? { ...current, items: current.items.map((candidate) => candidate.id === item.id ? payload.item : candidate) }
        : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el check.");
    } finally {
      setCheckingInvoiceItem("");
    }
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

      if (invoiceFile) await uploadAndAnalyzeInvoice(id, invoiceFile);

      setStage("creating");
      await processUntilFinished(id);
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo completar la carga masiva.");
    }
  }

  async function analyzeLateInvoice() {
    if (!batchId || !invoiceFile || busy) return;
    setError("");
    try {
      await uploadAndAnalyzeInvoice(batchId, invoiceFile);
      setStage("done");
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo analizar la factura.");
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
            Seleccioná fotos de productos, cajas y packaging juntas. Google Cloud separa cada unidad, lee sus códigos y CLOUVA crea un borrador independiente por producto o caja.
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

          <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/15 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03]">
                  <FileText className="h-4 w-4 text-violet-200" />
                </div>
                <div className="min-w-0">
                  <strong className="block text-xs">Factura / comprobante</strong>
                  <p className="mt-0.5 truncate text-[10px] text-white/38">
                    {invoiceFile ? invoiceFile.name : "Opcional · JPG, PNG, WEBP o PDF"}
                  </p>
                </div>
              </div>
              <label className={`inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-white/10 px-3 text-xs font-semibold transition hover:bg-white/[0.04] ${busy ? "pointer-events-none opacity-40" : ""}`}>
                {invoiceFile ? "Cambiar factura" : "Adjuntar factura"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    setInvoiceFile(file);
                    setInvoiceData(null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
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
            {stage === "done" && batchId && invoiceFile && !invoiceData ? (
              <button type="button" onClick={() => void analyzeLateInvoice()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-300/25 bg-violet-300/[0.06] px-4 text-sm font-semibold text-violet-100">
                <FileText className="h-4 w-4" /> Procesar factura
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

      {invoiceData?.invoice ? (
        <div className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.035] p-3 sm:p-4">
          <div className="flex flex-col gap-3 border-b border-white/[0.07] pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-200" />
                <strong className="text-sm">Checklist de factura</strong>
              </div>
              <p className="mt-1 text-[10px] text-white/38">
                {[invoiceData.invoice.supplier_name, invoiceData.invoice.document_type, invoiceData.invoice.document_number].filter(Boolean).join(" · ") || "Factura analizada"}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs font-semibold">
                {invoiceData.invoice.total_amount != null
                  ? new Intl.NumberFormat("es-AR", { style: "currency", currency: invoiceData.invoice.currency || "ARS" }).format(invoiceData.invoice.total_amount)
                  : "Total sin detectar"}
              </p>
              <p className="mt-1 text-[10px] text-white/35">
                {invoiceData.items.filter((item) => item.checked).length}/{invoiceData.items.length} chequeados
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {invoiceData.items.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-violet-500"
                  checked={item.checked}
                  disabled={checkingInvoiceItem === item.id}
                  onChange={(event) => void toggleInvoiceItem(item, event.currentTarget.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <strong className="min-w-0 flex-1 text-xs leading-5">{item.description}</strong>
                    <span className={`rounded-md border px-1.5 py-0.5 text-[9px] ${item.match_status === "matched" ? "border-emerald-300/20 text-emerald-200" : item.match_status === "partial" ? "border-amber-300/20 text-amber-200" : item.match_status === "ambiguous" ? "border-violet-300/20 text-violet-200" : "border-white/10 text-white/40"}`}>
                      {item.match_status === "matched" ? "Coincide" : item.match_status === "partial" ? "Parcial" : item.match_status === "ambiguous" ? "Revisar" : "Sin match"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/38">
                    <span>Cant. {item.quantity}</span>
                    {item.unit_price != null ? <span>Unit. {new Intl.NumberFormat("es-AR", { style: "currency", currency: invoiceData.invoice?.currency || "ARS" }).format(item.unit_price)}</span> : null}
                    {item.line_total != null ? <span>Total {new Intl.NumberFormat("es-AR", { style: "currency", currency: invoiceData.invoice?.currency || "ARS" }).format(item.line_total)}</span> : null}
                    {item.supplier_sku ? <span>SKU proveedor {item.supplier_sku}</span> : null}
                    {item.barcode_value ? <span>{item.barcode_type?.toUpperCase()} {item.barcode_value}</span> : null}
                    <span>Detectados {item.matched_quantity}/{item.quantity}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>
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
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-white/50">
                          {group.packageKind === "box" ? "Caja" : group.packageKind === "retail_package" ? "Packaging" : group.packageKind === "loose_product" ? "Producto suelto" : "Tipo sin confirmar"}
                        </span>
                        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] ${group.identifier ? "border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-200" : "border-amber-300/20 bg-amber-300/[0.05] text-amber-200"}`}>
                          {group.identifier ? `${group.identifier.type.toUpperCase()} · ${group.identifier.value}` : "Sin código · SKU CLOUVA"}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-white/38">
                        {[group.brand, group.model].filter(Boolean).join(" · ") || `${group.images.length} fotos`}
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
                  {group.visibleIdentifiers.length > 1 ? (
                    <p className="mt-1 text-[10px] leading-4 text-white/35">
                      Códigos leídos: {group.visibleIdentifiers.map((code) => `${code.type.toUpperCase()} ${code.value}`).join(" · ")}
                    </p>
                  ) : null}
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
