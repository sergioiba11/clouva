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
  unitCount: number;
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

type BatchSourceItem = {
  id: string;
  source_index: number;
  file_name: string | null;
  source_url: string;
  mime_type: string;
  status: string;
  group_key: string | null;
  listing_id: string | null;
  error: string | null;
};

type BatchStatus = {
  id: string;
  status: string;
  total_images: number;
  detected_products: number;
  processed_products: number;
  failed_products: number;
  error: string | null;
  metadata: {
    groups?: BatchGroup[];
    [key: string]: unknown;
  } | null;
  items?: BatchSourceItem[];
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

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mimeType || "application/octet-stream"};base64,${btoa(binary)}`;
}

async function readFileAsDataUrl(file: File) {
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("FILE_READER_FAILED"));
      reader.onload = () => {
        const value = String(reader.result || "");
        if (!value.startsWith("data:")) reject(new Error("FILE_READER_EMPTY"));
        else resolve(value);
      };
      reader.readAsDataURL(file);
    });
  } catch {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length) throw new Error("FILE_EMPTY");
      return bytesToDataUrl(bytes, file.type);
    } catch {
      const objectUrl = URL.createObjectURL(file);
      try {
        const response = await fetch(objectUrl);
        if (!response.ok) throw new Error("OBJECT_URL_READ_FAILED");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length) throw new Error("FILE_EMPTY");
        return bytesToDataUrl(bytes, file.type || response.headers.get("content-type") || "application/octet-stream");
      } catch {
        throw new Error(`${file.name}: no se pudo leer el archivo.`);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }
}


async function prepareImage(file: File, previewUrl?: string): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: no es una imagen.`);

  // En Android algunos archivos del selector quedan visibles en el preview pero
  // fallan al reabrirse desde FileReader/createImageBitmap. Reutilizamos primero
  // el object URL que YA está renderizando correctamente en la grilla.
  if (previewUrl) {
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const candidate = new Image();
        candidate.decoding = "async";
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error("PREVIEW_DECODE_FAILED"));
        candidate.src = previewUrl;
        if (candidate.complete && candidate.naturalWidth > 0) resolve(candidate);
      });
      return {
        file,
        dataUrl: imageToJpegDataUrl(image, image.naturalWidth, image.naturalHeight),
      };
    } catch {
      try {
        const response = await fetch(previewUrl);
        if (response.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length) return { file, dataUrl: bytesToDataUrl(bytes, file.type || response.headers.get("content-type") || "image/jpeg") };
        }
      } catch {}
    }
  }

  // Android/Chrome también puede fallar con createImageBitmap en fotos
  // perfectamente visualizables. Probamos los caminos de archivo después.
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return {
        file,
        dataUrl: imageToJpegDataUrl(bitmap, bitmap.width, bitmap.height),
      };
    } finally {
      bitmap.close();
    }
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return {
        file,
        dataUrl: imageToJpegDataUrl(image, image.naturalWidth, image.naturalHeight),
      };
    } catch {
      // Último fallback: si ya es un formato aceptado y entra en el límite
      // del endpoint, se envía el original sin recodificar en el navegador.
      const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (supported.has(file.type) && file.size <= 5 * 1024 * 1024) {
        return { file, dataUrl: await readFileAsDataUrl(file) };
      }
      throw new Error(`${file.name}: el teléfono no pudo decodificar esta imagen. Probá compartirla o guardarla nuevamente como JPG/PNG.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function prepareDocumentDataUrl(file: File) {
  if (file.type === "application/pdf") {
    if (file.size > 12 * 1024 * 1024) throw new Error("La factura PDF debe pesar hasta 12 MB.");
    return readFileAsDataUrl(file);
  }
  if (file.type.startsWith("image/")) {
    if (file.size > 12 * 1024 * 1024) throw new Error("La imagen de la factura debe pesar hasta 12 MB.");
    // Para facturas no necesitamos recodificar en el navegador. Enviar el
    // archivo original evita el error de Android: "The source image could not be decoded".
    return readFileAsDataUrl(file);
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


async function getJson<T>(url: string) {
  const response = await authenticatedFetch(url);
  return readApiJson<T>(response);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function batchGroups(batch: BatchStatus) {
  return Array.isArray(batch.metadata?.groups) ? batch.metadata.groups : [];
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
  const [stage, setStage] = useState<"idle" | "preparing" | "uploading" | "analyzing" | "invoice" | "review" | "creating" | "done" | "error">("idle");
  const [uploaded, setUploaded] = useState(0);
  const [batchId, setBatchId] = useState("");
  const [groups, setGroups] = useState<BatchGroup[]>([]);
  const [processed, setProcessed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [processResults, setProcessResults] = useState<ProcessResponse["results"]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoicePayload | null>(null);
  const [checkingInvoiceItem, setCheckingInvoiceItem] = useState("");
  const [recoverableBatch, setRecoverableBatch] = useState<BatchStatus | null>(null);
  const [batchSources, setBatchSources] = useState<Record<number, BatchSourceItem>>({});
  const [printingCodeGroup, setPrintingCodeGroup] = useState("");
  const [generatedCodeGroups, setGeneratedCodeGroups] = useState<Record<string, boolean>>({});
  const [updatingUnitGroup, setUpdatingUnitGroup] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);


  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await getJson<{ batches: BatchStatus[] }>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches`,
        );
        if (cancelled) return;
        const candidate = payload.batches.find((batch) => {
          const groups = batchGroups(batch);
          return groups.length > 0
            && ["review", "processing", "completed_with_errors", "failed"].includes(batch.status)
            && batch.processed_products < Math.max(batch.detected_products, groups.length);
        }) ?? null;
        if (!candidate) {
          setRecoverableBatch(null);
          return;
        }
        try {
          const detail = await getJson<{ batch: BatchStatus }>(
            `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(candidate.id)}`,
          );
          if (!cancelled) setRecoverableBatch(detail.batch);
        } catch {
          if (!cancelled) setRecoverableBatch(candidate);
        }
      } catch {
        // La recuperación es auxiliar; no debe bloquear la carga normal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studioId]);

  const busy = ["preparing", "uploading", "analyzing", "invoice", "creating"].includes(stage);
  const progressText = useMemo(() => {
    if (stage === "preparing") return `Preparando ${files.length} imágenes…`;
    if (stage === "uploading") return `Subiendo ${uploaded}/${files.length}…`;
    if (stage === "analyzing") return "Google Cloud está separando las fotos por producto…";
    if (stage === "invoice") return "Leyendo factura y armando el checklist…";
    if (stage === "review") return "Revisá la compra antes de ingresarla al stock";
    if (stage === "creating") return `Ingresando compra ${processed}/${groups.length}…`;
    if (stage === "done") return failed
      ? `${processed} productos creados · ${failed} necesitan reintento`
      : `${processed} productos creados en SIZ`;
    return "";
  }, [failed, files.length, groups.length, processed, stage, uploaded]);

  const receivingSummary = useMemo(() => {
    if (!groups.length) return null;
    const groupByKey = new Map(groups.map((group) => [group.groupKey, group]));
    const matchedKeys = new Set<string>();
    for (const item of invoiceData?.items ?? []) {
      for (const key of item.matched_group_keys ?? []) matchedKeys.add(key);
    }
    const unitCount = (group: BatchGroup) => Math.max(1, Math.floor(Number(group.unitCount) || 1));
    const hasExternalCode = (group: BatchGroup) => Boolean(
      group.identifier && !["sku", "clouva_barcode", "clouva_qr"].includes(group.identifier.type),
    );
    const detectedUnits = groups.reduce((sum, group) => sum + unitCount(group), 0);
    const codedUnits = groups.reduce((sum, group) => sum + (hasExternalCode(group) ? unitCount(group) : 0), 0);
    const noCodeUnits = Math.max(0, detectedUnits - codedUnits);
    const expectedUnits = (invoiceData?.items ?? []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const matchedInvoiceUnits = (invoiceData?.items ?? []).reduce(
      (sum, item) => sum + Math.min(Number(item.quantity || 0), Number(item.matched_quantity || 0)),
      0,
    );
    const missingUnits = (invoiceData?.items ?? []).reduce(
      (sum, item) => sum + Math.max(0, Number(item.quantity || 0) - Number(item.matched_quantity || 0)),
      0,
    );
    const matchedPhysicalUnits = Array.from(matchedKeys).reduce(
      (sum, key) => sum + (groupByKey.get(key) ? unitCount(groupByKey.get(key)!) : 0),
      0,
    );
    const extraUnits = Math.max(0, detectedUnits - matchedPhysicalUnits);
    const complete = Boolean(invoiceData?.invoice) && missingUnits === 0;
    return {
      detectedUnits,
      codedUnits,
      noCodeUnits,
      expectedUnits,
      matchedInvoiceUnits,
      missingUnits,
      extraUnits,
      complete,
      matchedKeys,
    };
  }, [groups, invoiceData]);

  const productSummary = useMemo(() => {
    const rows = new Map<string, {
      key: string;
      name: string;
      brand: string;
      model: string;
      code: string;
      codeType: string;
      quantity: number;
      groupKeys: string[];
      needsReview: boolean;
    }>();
    const normalize = (value: string) => value.toLowerCase().trim().replace(/\s+/g, " ");
    for (const group of groups) {
      const external = group.identifier && !["sku", "clouva_barcode", "clouva_qr"].includes(group.identifier.type)
        ? group.identifier
        : null;
      const fallbackIdentity = [group.brand, group.model, group.name]
        .map(normalize)
        .filter(Boolean)
        .join("|");
      const key = external
        ? `code:${external.type}:${external.value.replace(/\s/g, "").toUpperCase()}`
        : `visual:${fallbackIdentity || group.groupKey}`;
      const existing = rows.get(key);
      const quantity = Math.max(1, Math.floor(Number(group.unitCount) || 1));
      if (existing) {
        existing.quantity += quantity;
        existing.groupKeys.push(group.groupKey);
        existing.needsReview = existing.needsReview || group.needsReview;
      } else {
        rows.set(key, {
          key,
          name: group.name || "Producto detectado",
          brand: group.brand || "",
          model: group.model || "",
          code: external?.value || "",
          codeType: external?.type || "",
          quantity,
          groupKeys: [group.groupKey],
          needsReview: group.needsReview,
        });
      }
    }
    return Array.from(rows.values()).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  }, [groups]);

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
    setBatchSources({});
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
    setBatchSources({});
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

  async function fetchBatchStatus(batch: string) {
    const payload = await getJson<{ batch: BatchStatus }>(
      `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}`,
    );
    return payload.batch;
  }

  async function waitForAnalyzedBatch(batch: string) {
    let lastStatus = "";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await fetchBatchStatus(batch);
      lastStatus = current.status;
      const recoveredGroups = batchGroups(current);
      if (recoveredGroups.length && ["review", "processing", "completed", "completed_with_errors"].includes(current.status)) {
        return {
          batchId: current.id,
          status: current.status,
          totalImages: current.total_images,
          detectedProducts: current.detected_products || recoveredGroups.length,
          groups: recoveredGroups,
        } satisfies AnalyzeResponse;
      }
      if (current.status === "failed") {
        throw new Error(current.error || "El análisis del lote falló.");
      }
      await wait(3000);
    }
    throw new Error(`El análisis sigue en estado ${lastStatus || "desconocido"}. Podés reanudar el lote sin volver a subir las fotos.`);
  }

  async function analyzeWithRecovery(batch: string) {
    try {
      return await postJson<AnalyzeResponse>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}/analyze`,
        {},
      );
    } catch (cause) {
      // En móviles la conexión puede cerrarse aunque Cloud Run haya terminado.
      // Recuperamos el resultado persistido en Supabase en vez de crear otro lote.
      const message = cause instanceof Error ? cause.message : "";
      if (!/Failed to fetch|network|fetch/i.test(message)) throw cause;
      return waitForAnalyzedBatch(batch);
    }
  }

  async function processUntilFinished(batch: string, retryFailed = false) {
    let first = true;
    let transientFailures = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      let result: ProcessResponse;
      try {
        result = await postJson<ProcessResponse>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}/process`,
          { retryFailed: retryFailed && first },
        );
        transientFailures = 0;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        const networkDrop = /Failed to fetch|network|fetch/i.test(message);
        const providerBusy = /RESOURCE_EXHAUSTED|resource exhausted|quota|429/i.test(message);
        if ((!networkDrop && !providerBusy) || transientFailures >= 10) throw cause;
        transientFailures += 1;
        await wait(providerBusy ? Math.min(30000, 5000 * transientFailures) : 2500);
        continue;
      }
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
      const unreadable: string[] = [];
      for (const [index, file] of files.entries()) {
        try {
          prepared.push(await prepareImage(file, previews[index]));
        } catch (prepareError) {
          unreadable.push(
            prepareError instanceof Error
              ? prepareError.message.replace(/: no se pudo leer el archivo\.$/, "")
              : file.name,
          );
        }
      }

      if (!prepared.length) {
        throw new Error("El teléfono no pudo leer ninguna de las fotos seleccionadas.");
      }

      if (unreadable.length) {
        const readableFiles = prepared.map((image) => image.file);
        setFiles(readableFiles);
        setError(
          `Se omitieron ${unreadable.length} foto${unreadable.length === 1 ? "" : "s"} que Android no pudo abrir: ${unreadable.slice(0, 3).join(", ")}${unreadable.length > 3 ? ` +${unreadable.length - 3}` : ""}. El resto del lote continúa.`,
        );
      }

      const created = await postJson<{ batch: { id: string } }>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches`,
        { imageCount: prepared.length },
      );
      const id = created.batch.id;
      setBatchId(id);

      setStage("uploading");
      await uploadPrepared(id, prepared);

      setStage("analyzing");
      const analyzed = await analyzeWithRecovery(id);
      setGroups(analyzed.groups);
      setBatchSources({});
      setRecoverableBatch(null);

      if (invoiceFile) {
        try {
          await uploadAndAnalyzeInvoice(id, invoiceFile);
        } catch (invoiceError) {
          setInvoiceData(null);
          setError(invoiceError instanceof Error
            ? `Las fotos quedaron clasificadas; la factura quedó pendiente: ${invoiceError.message}`
            : "Las fotos quedaron clasificadas; la factura quedó pendiente.");
        }
      }

      setStage("review");
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo completar la carga masiva.");
    }
  }

  async function resumeBatch(batch: BatchStatus) {
    if (busy) return;
    const recoveredGroups = batchGroups(batch);
    if (!recoveredGroups.length) {
      setError("Ese lote todavía no tiene productos agrupados para reanudar.");
      return;
    }
    setError("");
    setBatchId(batch.id);
    setGroups(recoveredGroups);
    setBatchSources(Object.fromEntries((batch.items ?? []).map((item) => [item.source_index, item])));
    setProcessed(batch.processed_products || 0);
    setFailed(batch.failed_products || 0);
    try {
      try {
        const existingInvoice = await getJson<InvoicePayload>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch.id)}/invoice`,
        );
        if (existingInvoice.invoice) setInvoiceData(existingInvoice);
      } catch {}

      if (invoiceFile && !invoiceData) {
        try {
          await uploadAndAnalyzeInvoice(batch.id, invoiceFile);
        } catch (invoiceError) {
          setError(invoiceError instanceof Error
            ? `El lote está recuperado; la factura quedó pendiente: ${invoiceError.message}`
            : "El lote está recuperado; la factura quedó pendiente.");
        }
      }
      setStage("review");
      setRecoverableBatch(null);
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo reanudar el lote.");
    }
  }

  async function analyzeLateInvoice() {
    if (!batchId || !invoiceFile || busy) return;
    setError("");
    try {
      await uploadAndAnalyzeInvoice(batchId, invoiceFile);
      setStage("review");
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo analizar la factura.");
    }
  }

  async function confirmPurchaseImport() {
    if (!batchId || busy || !groups.length) return;
    setError("");
    setStage("creating");
    try {
      await processUntilFinished(batchId, failed > 0);
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo ingresar la compra.");
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


  async function updateGroupUnitCount(groupKey: string, unitCount: number) {
    if (!batchId || updatingUnitGroup) return;
    const next = Math.max(1, Math.min(100, Math.floor(unitCount)));
    setUpdatingUnitGroup(groupKey);
    setError("");
    try {
      await authenticatedFetch(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batchId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ groupKey, unitCount: next }),
        },
      ).then((response) => readApiJson(response));
      setGroups((current) => current.map((group) =>
        group.groupKey === groupKey ? { ...group, unitCount: next } : group,
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la cantidad.");
    } finally {
      setUpdatingUnitGroup("");
    }
  }

  async function generateAndPrintInternalCode(groupKey: string, listingId: string) {
    if (!listingId || printingCodeGroup) return;
    setPrintingCodeGroup(groupKey);
    setError("");
    const popup = window.open("about:blank", "_blank");
    try {
      await postJson(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/codes`,
        {
          action: "generate",
          listingId,
          identifierTypes: ["code_128"],
        },
      );
      const params = new URLSearchParams({
        listingId,
        format: "pdf",
        page: "label",
        layout: "full",
        size: "40x30",
        showPrice: "false",
        showSku: "true",
        showQr: "false",
        print: "true",
      });
      const response = await authenticatedFetch(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/labels?${params.toString()}`,
      );
      if (!response.ok) {
        const payload = await readApiJson<{ error?: string }>(response);
        throw new Error(payload.error || "No se pudo generar la etiqueta.");
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      if (popup) popup.location.href = blobUrl;
      else window.location.href = blobUrl;
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      setGeneratedCodeGroups((current) => ({ ...current, [groupKey]: true }));
    } catch (cause) {
      if (popup) popup.close();
      setError(cause instanceof Error ? cause.message : "No se pudo generar el código.");
    } finally {
      setPrintingCodeGroup("");
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

      {recoverableBatch && !busy ? (
        <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <strong className="text-xs text-cyan-100">Lote listo para reanudar</strong>
              <p className="mt-1 text-[10px] leading-4 text-white/45">
                {batchGroups(recoverableBatch).length} productos detectados · {recoverableBatch.total_images} fotos. No hace falta volver a subirlas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void resumeBatch(recoverableBatch)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs font-semibold text-cyan-100"
            >
              <RefreshCw className="h-4 w-4" /> Reanudar lote
            </button>
          </div>
        </div>
      ) : null}

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

      {groups.length && receivingSummary ? (
        <div className="mt-4 rounded-2xl border border-violet-300/15 bg-black/20 p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-200">Control de compra</p>
              <h3 className="mt-1 text-base font-semibold">
                {invoiceData?.invoice
                  ? receivingSummary.complete
                    ? "La factura está cubierta por lo fotografiado"
                    : `Faltan ${receivingSummary.missingUnits} unidad${receivingSummary.missingUnits === 1 ? "" : "es"} por encontrar`
                  : "Adjuntá la factura para chequear la compra"}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-white/42">
                CLOUVA compara cantidades, costo unitario, códigos y los productos físicos que aparecen en las fotos.
              </p>
            </div>
            {invoiceData?.invoice ? (
              <span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold ${receivingSummary.complete ? "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-100" : "border-amber-300/25 bg-amber-300/[0.07] text-amber-100"}`}>
                {receivingSummary.complete ? "CHECK FACTURA OK" : "REVISIÓN PENDIENTE"}
              </span>
            ) : null}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Factura</p>
              <strong className="mt-1 block text-lg">{invoiceData?.invoice ? receivingSummary.expectedUnits : "—"}</strong>
              <span className="text-[9px] text-white/35">unidades esperadas</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Fotos</p>
              <strong className="mt-1 block text-lg">{receivingSummary.detectedUnits}</strong>
              <span className="text-[9px] text-white/35">unidades detectadas</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Faltan</p>
              <strong className={`mt-1 block text-lg ${receivingSummary.missingUnits ? "text-amber-200" : "text-emerald-200"}`}>
                {invoiceData?.invoice ? receivingSummary.missingUnits : "—"}
              </strong>
              <span className="text-[9px] text-white/35">vs. factura</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Sin código</p>
              <strong className={`mt-1 block text-lg ${receivingSummary.noCodeUnits ? "text-amber-200" : "text-emerald-200"}`}>
                {receivingSummary.noCodeUnits}
              </strong>
              <span className="text-[9px] text-white/35">para etiquetar</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Extra</p>
              <strong className="mt-1 block text-lg">{invoiceData?.invoice ? receivingSummary.extraUnits : "—"}</strong>
              <span className="text-[9px] text-white/35">sin línea asignada</span>
            </div>
          </div>

          {productSummary.length ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.07]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
                <strong className="text-[10px] uppercase tracking-[.14em] text-white/45">Resumen por producto</strong>
                <span className="text-[10px] text-white/35">{productSummary.length} tipos</span>
              </div>
              <div className="max-h-72 divide-y divide-white/[0.05] overflow-y-auto">
                {productSummary.map((row) => (
                  <div key={row.key} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.025] text-xs font-bold">
                      ×{row.quantity}
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block truncate text-xs">{row.name}</strong>
                      <p className="mt-0.5 truncate text-[9px] text-white/38">
                        {[row.brand, row.model].filter(Boolean).join(" · ") || `${row.groupKeys.length} grupo${row.groupKeys.length === 1 ? "" : "s"} visual${row.groupKeys.length === 1 ? "" : "es"}`}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] ${row.code ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/20 text-amber-200"}`}>
                      {row.code ? `${row.codeType.toUpperCase()} · ${row.code}` : "SIN CÓDIGO"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {!invoiceData?.invoice ? (
            <div className="mt-3 rounded-xl border border-dashed border-white/10 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <strong className="block text-xs">Factura / comprobante de esta compra</strong>
                  <p className="mt-1 truncate text-[10px] text-white/38">
                    {invoiceFile ? invoiceFile.name : "JPG, PNG, WEBP o PDF"}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-white/10 px-3 text-xs font-semibold hover:bg-white/[0.04]">
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
                  {batchId && invoiceFile ? (
                    <button
                      type="button"
                      onClick={() => void analyzeLateInvoice()}
                      disabled={busy}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 text-xs font-semibold hover:bg-violet-500 disabled:opacity-45"
                    >
                      <FileText className="h-4 w-4" /> Chequear factura
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {batchId ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              {!invoiceData?.invoice ? (
                <span className="mr-auto text-[10px] leading-4 text-white/35">
                  Podés ingresar sin factura, pero no habrá control automático de cantidades ni costos.
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void confirmPurchaseImport()}
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500/90 px-4 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-45"
              >
                <CheckCircle2 className="h-4 w-4" />
                {invoiceData?.invoice ? "Confirmar ingreso de compra" : "Ingresar sin factura"}
              </button>
            </div>
          ) : null}
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
              const photos = group.images.map((image) => ({
                ...image,
                url: batchSources[image.sourceIndex]?.source_url || previews[image.sourceIndex] || "",
                fileName: batchSources[image.sourceIndex]?.file_name || files[image.sourceIndex]?.name || "",
              }));
              const listingId = result?.listingId
                || photos.map((photo) => batchSources[photo.sourceIndex]?.listing_id).find((value): value is string => Boolean(value))
                || "";
              const hasExternalCode = Boolean(
                group.identifier && !["sku", "clouva_barcode", "clouva_qr"].includes(group.identifier.type),
              );
              return (
                <div key={group.groupKey} className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                  {photos.some((photo) => photo.url) ? (
                    <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                      {photos.map((photo) => photo.url ? (
                        <div key={photo.sourceIndex} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={photo.fileName || `${group.name || "Producto"} · ${photo.role}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 text-[8px] font-semibold text-white/80">
                            {photo.role}
                          </span>
                          <span className="absolute right-1 top-1 rounded bg-black/75 px-1 py-0.5 text-[8px] text-white/70">
                            #{photo.sourceIndex + 1}
                          </span>
                        </div>
                      ) : null)}
                    </div>
                  ) : null}
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
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] font-medium text-white/55">Unidades físicas</span>
                        <div className="inline-flex items-center overflow-hidden rounded-lg border border-white/10 bg-black/20">
                          <button
                            type="button"
                            disabled={!batchId || updatingUnitGroup === group.groupKey || Math.max(1, Math.floor(Number(group.unitCount) || 1)) <= 1}
                            onClick={() => void updateGroupUnitCount(group.groupKey, Math.max(1, Math.floor(Number(group.unitCount) || 1)) - 1)}
                            className="grid h-7 w-7 place-items-center text-xs text-white/60 hover:bg-white/[0.05] disabled:opacity-30"
                            aria-label="Restar unidad"
                          >
                            −
                          </button>
                          <span className="min-w-8 border-x border-white/10 px-2 text-center text-[11px] font-semibold">
                            {Math.max(1, Math.floor(Number(group.unitCount) || 1))}
                          </span>
                          <button
                            type="button"
                            disabled={!batchId || updatingUnitGroup === group.groupKey}
                            onClick={() => void updateGroupUnitCount(group.groupKey, Math.max(1, Math.floor(Number(group.unitCount) || 1)) + 1)}
                            className="grid h-7 w-7 place-items-center text-xs text-white/60 hover:bg-white/[0.05] disabled:opacity-30"
                            aria-label="Sumar unidad"
                          >
                            +
                          </button>
                        </div>
                      </div>
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
                  {!hasExternalCode ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {listingId ? (
                        <button
                          type="button"
                          disabled={printingCodeGroup === group.groupKey}
                          onClick={() => void generateAndPrintInternalCode(group.groupKey, listingId)}
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 text-[10px] font-semibold text-amber-100 disabled:opacity-45"
                        >
                          {printingCodeGroup === group.groupKey ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                          {generatedCodeGroups[group.groupKey] ? "Imprimir etiqueta otra vez" : "Crear código + imprimir sticker"}
                        </button>
                      ) : (
                        <span className="text-[10px] text-amber-100/60">Sin código: CLOUVA lo genera al ingresar el producto.</span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
