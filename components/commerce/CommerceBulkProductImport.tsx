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
    sourceIndex?: number;
  }>;
  confidence: number;
  needsReview: boolean;
  images: Array<{ sourceIndex: number; role: "Frente" | "Atrás" | "Detalle" }>;
  physicalUnits?: Array<{ sourceIndexes: number[]; confidence: number }>;
  contextReferences?: Array<{
    sourceIndex: number;
    label: string;
    confidence: number;
  }>;
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
  recognition: {
    context_only?: boolean;
    observed_products?: string[];
    matched_group_keys?: string[];
    matched_products?: Array<{
      group_key: string;
      label: string;
      confidence: number;
    }>;
    context_reason?: string;
    [key: string]: unknown;
  } | null;
  error: string | null;
};

type AnalysisProgress = {
  stage: "grouping" | "consolidating" | "refining" | "done";
  completed: number;
  total: number;
  provisionalProducts: number;
  message: string;
  updatedAt: string;
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
    analysis_progress?: AnalysisProgress;
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

function externalIdentifierForGroup(group: BatchGroup) {
  const internal = new Set(["sku", "clouva_barcode", "clouva_qr"]);
  if (group.identifier && !internal.has(group.identifier.type)) return group.identifier;
  return group.visibleIdentifiers.find((identifier) => !internal.has(identifier.type)) ?? null;
}

function normalizeReceiptText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const [mergingSource, setMergingSource] = useState("");
  const [mergingGroup, setMergingGroup] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [showAllInvoiceItems, setShowAllInvoiceItems] = useState(false);
  const [showAllDetectedGroups, setShowAllDetectedGroups] = useState(false);
  const [expandedPhotoGroup, setExpandedPhotoGroup] = useState("");
  const [expandedArticlePhotos, setExpandedArticlePhotos] = useState("");
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
          if (batch.status === "analyzing") return true;
          // Un reanálisis fallido (ej. cuota 429 de Vertex) borra los grupos
          // pero conserva las fotos en el lote: se puede reintentar sin
          // volver a subirlas.
          if (batch.status === "failed" && batch.total_images > 0) return true;
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

  useEffect(() => {
    if (stage !== "analyzing" || !batchId) {
      if (stage !== "analyzing") setAnalysisProgress(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const current = await fetchBatchStatus(batchId);
        if (cancelled) return;
        setAnalysisProgress(current.metadata?.analysis_progress ?? null);
      } catch {}
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [batchId, stage]);

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
    const consumedKeys = new Set<string>();
    const unitCount = (group: BatchGroup) => Math.max(1, Math.floor(Number(group.unitCount) || 1));
    const hasExternalCode = (group: BatchGroup) => Boolean(externalIdentifierForGroup(group));

    const invoiceItems = invoiceData?.items ?? [];
    const expectedUnits = invoiceItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0);
    const visualUnits = groups.reduce((sum, group) => sum + unitCount(group), 0);
    let matchedInvoiceUnits = 0;
    let missingUnits = 0;
    let extraMatchedUnits = 0;

    for (const item of invoiceItems) {
      const expected = Math.max(0, Number(item.quantity || 0));
      const keys = Array.from(new Set(
        (item.matched_group_keys ?? []).filter((key) => groupByKey.has(key)),
      ));
      const freshKeys = keys.filter((key) => !consumedKeys.has(key));
      for (const key of keys) matchedKeys.add(key);
      for (const key of freshKeys) consumedKeys.add(key);

      const physical = freshKeys.reduce(
        (sum, key) => sum + unitCount(groupByKey.get(key)!),
        0,
      );
      matchedInvoiceUnits += Math.min(expected, physical);
      missingUnits += Math.max(0, expected - physical);
      extraMatchedUnits += Math.max(0, physical - expected);
    }

    const unmatchedUnits = groups
      .filter((group) => !matchedKeys.has(group.groupKey))
      .reduce((sum, group) => sum + unitCount(group), 0);
    const extraUnits = invoiceData?.invoice ? extraMatchedUnits + unmatchedUnits : 0;
    const noCodeProducts = groups.filter((group) => !hasExternalCode(group)).length;
    const codedUnits = groups
      .filter((group) => hasExternalCode(group))
      .reduce((sum, group) => sum + unitCount(group), 0);
    const covered = Boolean(invoiceData?.invoice) && missingUnits === 0;
    const complete = covered && extraUnits === 0;

    return {
      detectedUnits: visualUnits,
      codedUnits,
      noCodeUnits: noCodeProducts,
      expectedUnits,
      matchedInvoiceUnits,
      missingUnits,
      extraUnits,
      covered,
      complete,
      matchedKeys,
    };
  }, [groups, invoiceData]);

  const productSummary = useMemo(() => {
    return groups
      .map((group) => {
        const external = externalIdentifierForGroup(group);
        return {
          key: group.groupKey,
          name: group.name || "Producto detectado",
          brand: group.brand || "",
          model: group.model || "",
          code: external?.value || "",
          codeType: external?.type || "",
          quantity: Math.max(1, Math.floor(Number(group.unitCount) || 1)),
          groupKeys: [group.groupKey],
          needsReview: group.needsReview,
        };
      })
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  }, [groups]);

  const reviewIssues = useMemo(() => {
    if (!invoiceData?.invoice) return [];
    const groupByKey = new Map(groups.map((group) => [group.groupKey, group]));
    const knownBrands = Array.from(new Set(
      groups.map((group) => normalizeReceiptText(group.brand)).filter(Boolean),
    ));

    return invoiceData.items.flatMap((item) => {
      const matchedGroups = (item.matched_group_keys ?? [])
        .map((key) => groupByKey.get(key))
        .filter((group): group is BatchGroup => Boolean(group));
      const physicalUnits = matchedGroups.reduce(
        (sum, group) => sum + Math.max(1, Math.floor(Number(group.unitCount) || 1)),
        0,
      );
      const expectedUnits = Math.max(0, Number(item.quantity || 0));
      const reasons: string[] = [];

      if (physicalUnits > expectedUnits) {
        reasons.push(`Factura ${expectedUnits} · físico ${physicalUnits} · sobra ${physicalUnits - expectedUnits}`);
      } else if (physicalUnits < expectedUnits) {
        reasons.push(`Factura ${expectedUnits} · físico ${physicalUnits} · faltan ${expectedUnits - physicalUnits}`);
      }

      if (item.match_status === "ambiguous") {
        reasons.push("La línea tiene más de una coincidencia posible");
      } else if (item.match_status === "unmatched") {
        reasons.push("Todavía no hay un producto físico confirmado para esta línea");
      }

      const invoiceBrand = normalizeReceiptText(item.brand || "");
      const descriptionText = ` ${normalizeReceiptText(item.description || "")} `;
      const conflictingBrands = matchedGroups
        .map((group) => group.brand)
        .filter(Boolean)
        .filter((brand) => invoiceBrand && normalizeReceiptText(brand) !== invoiceBrand);
      const descriptionBrandConflicts = matchedGroups.flatMap((group) => {
        const detectedBrand = normalizeReceiptText(group.brand || "");
        if (!detectedBrand) return [];
        return knownBrands
          .filter((brand) => brand !== detectedBrand && descriptionText.includes(` ${brand} `))
          .map((brand) => ({ invoiceBrand: brand, detectedBrand: group.brand }));
      });
      if (conflictingBrands.length) {
        reasons.push(`Marca en factura: ${item.brand} · producto: ${Array.from(new Set(conflictingBrands)).join(", ")}`);
      } else if (descriptionBrandConflicts.length) {
        const conflict = descriptionBrandConflicts[0];
        reasons.push(`La descripción de factura menciona ${conflict.invoiceBrand}; el producto visual es ${conflict.detectedBrand}`);
      }

      if (matchedGroups.some((group) => group.needsReview)) {
        reasons.push("CLOUVA encontró evidencia visual que conviene confirmar");
      }

      if (!reasons.length) return [];
      return [{
        key: item.id,
        item,
        matchedGroups,
        expectedUnits,
        physicalUnits,
        reasons: Array.from(new Set(reasons)),
        resolved: item.metadata?.manually_reviewed === true,
      }];
    });
  }, [groups, invoiceData]);

  const pendingReviewIssues = useMemo(
    () => reviewIssues.filter((issue) => !issue.resolved),
    [reviewIssues],
  );

  const visibleInvoiceItems = useMemo(
    () => showAllInvoiceItems ? (invoiceData?.items ?? []) : (invoiceData?.items ?? []).slice(0, 6),
    [invoiceData?.items, showAllInvoiceItems],
  );

  const visibleDetectedGroups = useMemo(
    () => showAllDetectedGroups ? groups : groups.slice(0, 8),
    [groups, showAllDetectedGroups],
  );

  const contextPhotos = useMemo(
    () => Object.values(batchSources)
      .filter((item) => item.recognition?.context_only === true)
      .sort((a, b) => a.source_index - b.source_index),
    [batchSources],
  );

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

  async function waitForAnalyzedBatch(batch: string, requireReanalysis = false) {
    let lastStatus = "";
    let transientFailures = 0;
    let lastNetworkError = "";
    for (let attempt = 0; attempt < 160; attempt += 1) {
      try {
        const current = await fetchBatchStatus(batch);
        transientFailures = 0;
        lastNetworkError = "";
        lastStatus = current.status;
        const recoveredGroups = batchGroups(current);
        const reanalysisReady = !requireReanalysis || current.metadata?.reanalyzed === true;
        if (reanalysisReady && recoveredGroups.length && ["review", "processing", "completed", "completed_with_errors"].includes(current.status)) {
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
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause ?? "");
        const recoverable = /Failed to fetch|network|fetch|HTTP (502|503|504|524)/i.test(message);
        if (!recoverable) throw cause;
        transientFailures += 1;
        lastNetworkError = message;
        if (transientFailures > 20) {
          throw new Error(`La conexión se cortó mientras CLOUVA seguía analizando. Último estado: ${lastStatus || "desconocido"}. ${lastNetworkError}`);
        }
      }
      await wait(3000);
    }
    throw new Error(`El análisis sigue en estado ${lastStatus || "desconocido"}. Podés seguir el lote sin volver a subir las fotos.`);
  }

  async function analyzeWithRecovery(batch: string, force = false) {
    try {
      return await postJson<AnalyzeResponse>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch)}/analyze`,
        { force },
      );
    } catch (cause) {
      // En móviles la conexión puede cerrarse aunque Cloud Run haya terminado.
      // Recuperamos el resultado persistido en Supabase en vez de crear otro lote.
      const message = cause instanceof Error ? cause.message : "";
      const recoverable = /Failed to fetch|network|fetch|HTTP (502|503|504|524)/i.test(message);
      if (!recoverable) throw cause;
      if (force) await wait(3000);
      return waitForAnalyzedBatch(batch, force);
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
    setAnalysisProgress(null);
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

      if (invoiceFile) {
        try {
          await uploadAndAnalyzeInvoice(id, invoiceFile);
        } catch (invoiceError) {
          setInvoiceData(null);
          setError(invoiceError instanceof Error
            ? `La factura quedó pendiente, pero las fotos continúan: ${invoiceError.message}`
            : "La factura quedó pendiente, pero las fotos continúan.");
        }
      }

      setStage("analyzing");
      const analyzed = await analyzeWithRecovery(id);
      setGroups(analyzed.groups);
      setBatchSources({});
      setRecoverableBatch(null);

      if (invoiceFile) {
        try {
          const refreshedInvoice = await getJson<InvoicePayload>(
            `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(id)}/invoice`,
          );
          setInvoiceData(refreshedInvoice.invoice ? refreshedInvoice : null);
        } catch {}
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
    const isAnalyzing = batch.status === "analyzing";
    // Lote fallido sin grupos (ej. 429 en pleno reanálisis): las fotos
    // siguen guardadas, se relanza el análisis directamente.
    if (!isAnalyzing && !recoveredGroups.length) {
      if (batch.status === "failed" && batch.total_images > 0) {
        await reanalyzeBatchById(batch.id);
        return;
      }
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
      if (isAnalyzing) {
        setRecoverableBatch(null);
        setAnalysisProgress(batch.metadata?.analysis_progress ?? null);
        setStage("analyzing");

        const startedAt = String(batch.metadata?.reanalysis_started_at ?? "");
        const finishedAt = String(batch.metadata?.reanalysis_finished_at ?? "");
        const startedTime = Date.parse(startedAt);
        const finishedTime = Date.parse(finishedAt);
        const requireReanalysis = Boolean(startedAt)
          && (!finishedAt || (Number.isFinite(startedTime) && Number.isFinite(finishedTime) && startedTime > finishedTime));

        const analyzed = await waitForAnalyzedBatch(batch.id, requireReanalysis);
        setGroups(analyzed.groups);

        try {
          const detail = await getJson<{ batch: BatchStatus }>(
            `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch.id)}`,
          );
          setBatchSources(Object.fromEntries((detail.batch.items ?? []).map((item) => [item.source_index, item])));
        } catch {}

        try {
          const existingInvoice = await getJson<InvoicePayload>(
            `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batch.id)}/invoice`,
          );
          if (existingInvoice.invoice) setInvoiceData(existingInvoice);
        } catch {}

        setStage("review");
        return;
      }

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

  async function reanalyzeBatchById(id: string) {
    if (busy) return;
    const confirmed = window.confirm(
      "CLOUVA va a reanalizar las mismas fotos sin volver a subirlas. La factura se conserva y los borradores incompletos creados por este lote se reconstruyen con el nuevo agrupamiento. ¿Continuar?",
    );
    if (!confirmed) return;

    setError("");
    setBatchId(id);
    setStage("analyzing");
    setProcessed(0);
    setFailed(0);
    setProcessResults([]);
    setAnalysisProgress(null);
    try {
      let analyzed: AnalyzeResponse;
      try {
        analyzed = await postJson<AnalyzeResponse>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(id)}/reanalyze`,
          {},
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        const recoverable = /Failed to fetch|network|fetch|HTTP (409|502|503|504|524)|reanálisis ya está en curso/i.test(message);
        if (!recoverable) throw cause;
        await wait(3000);
        analyzed = await waitForAnalyzedBatch(id, true);
      }

      setGroups(analyzed.groups);
      try {
        const detail = await getJson<{ batch: BatchStatus }>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(id)}`,
        );
        setBatchSources(Object.fromEntries((detail.batch.items ?? []).map((item) => [item.source_index, item])));
      } catch {}

      try {
        const refreshedInvoice = await getJson<InvoicePayload>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(id)}/invoice`,
        );
        setInvoiceData(refreshedInvoice.invoice ? refreshedInvoice : null);
      } catch {}
      setStage("review");
    } catch (cause) {
      setStage("error");
      setError(cause instanceof Error ? cause.message : "No se pudo reanalizar el lote.");
    }
  }

  async function reanalyzeCurrentBatch() {
    if (!batchId) return;
    await reanalyzeBatchById(batchId);
  }

  async function confirmPurchaseImport() {
    if (!batchId || busy || !groups.length) return;
    if (pendingReviewIssues.length) {
      setError(`CLOUVA necesita que confirmes ${pendingReviewIssues.length} diferencia${pendingReviewIssues.length === 1 ? "" : "s"} antes de ingresar el stock.`);
      return;
    }
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

  async function mergeGroupsInto(sourceKey: string, targetKey: string) {
    if (!batchId || busy || mergingGroup || !sourceKey || !targetKey || sourceKey === targetKey) return;
    const confirmed = window.confirm(
      "Fusionar en una sola ficha: se suman las fotos, se conserva el mejor código y la mayor cantidad (después ajustás unidades con +/−). ¿Continuar?",
    );
    if (!confirmed) return;
    setError("");
    setMergingGroup(targetKey);
    try {
      const data = await postJson<{ groups: BatchGroup[] }>(
        `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batchId)}/merge`,
        { sourceGroupKey: sourceKey, targetGroupKey: targetKey },
      );
      setGroups(data.groups);
      setMergingSource("");
      try {
        const refreshedInvoice = await getJson<InvoicePayload>(
          `/api/studios/${encodeURIComponent(studioId)}/commerce/import-batches/${encodeURIComponent(batchId)}/invoice`,
        );
        setInvoiceData(refreshedInvoice.invoice ? refreshedInvoice : null);
      } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo fusionar.");
    } finally {
      setMergingGroup("");
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
          <h2 className="mt-2 text-lg font-semibold">Fotos → productos agrupados</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-white/45">
            Subí frente, dorso, detalles, códigos y factura. CLOUVA reconstruye cada producto físico, junta sus vistas, lee EAN/UPC/QR y compara lo recibido contra la factura antes de tocar el stock.
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
              {busy ? progressText : `Cargar y analizar lote (${files.length})`}
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
              <strong className="text-xs text-cyan-100">
                {recoverableBatch.status === "analyzing"
                  ? "Análisis en curso"
                  : recoverableBatch.status === "failed" && batchGroups(recoverableBatch).length === 0
                    ? "El análisis falló — se puede reintentar"
                    : "Lote listo para reanudar"}
              </strong>
              <p className="mt-1 text-[10px] leading-4 text-white/45">
                {recoverableBatch.status === "analyzing"
                  ? `${recoverableBatch.metadata?.analysis_progress?.message || "CLOUVA sigue agrupando el lote"} · ${recoverableBatch.total_images} fotos. No vuelvas a subirlas.`
                  : recoverableBatch.status === "failed" && batchGroups(recoverableBatch).length === 0
                    ? `Falló (cuota de Google) pero tus ${recoverableBatch.total_images} fotos están guardadas. Reintenta sin volver a subirlas.`
                    : `${batchGroups(recoverableBatch).length} productos detectados · ${recoverableBatch.total_images} fotos. No hace falta volver a subirlas.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void resumeBatch(recoverableBatch)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.08] px-3 text-xs font-semibold text-cyan-100"
            >
              <RefreshCw className={`h-4 w-4 ${recoverableBatch.status === "analyzing" ? "animate-spin" : ""}`} />
              {recoverableBatch.status === "analyzing"
                ? "Seguir análisis"
                : recoverableBatch.status === "failed" && batchGroups(recoverableBatch).length === 0
                  ? "Reintentar análisis"
                  : "Reanudar lote"}
            </button>
          </div>
        </div>
      ) : null}

      {busy && progressText ? (
        <div className="mt-4 rounded-xl border border-violet-300/15 bg-violet-300/[0.05] px-3 py-3">
          <div className="flex items-center gap-2 text-xs text-violet-100">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            <span>{analysisProgress?.message || progressText}</span>
          </div>
          {stage === "analyzing" && analysisProgress ? (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-violet-400 transition-[width] duration-500"
                  style={{ width: `${Math.max(6, Math.min(100, analysisProgress.total ? (analysisProgress.completed / analysisProgress.total) * 100 : 6))}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[9px] text-white/35">
                <span>{analysisProgress.stage === "grouping" ? "Separando imágenes" : analysisProgress.stage === "consolidating" ? "Uniendo vistas/productos" : analysisProgress.stage === "refining" ? "Verificando unidades" : "Listo"}</span>
                <span>{analysisProgress.provisionalProducts} productos provisionales</span>
              </div>
              {groups.length ? (
                <p className="mt-1 text-[9px] text-white/30">Mientras termina, abajo seguís viendo el resultado anterior.</p>
              ) : null}
            </div>
          ) : null}
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
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-200">Recepción del lote</p>
              <h3 className="mt-1 text-base font-semibold">
                {invoiceData?.invoice
                  ? `${receivingSummary.detectedUnits} unidades físicas · ${receivingSummary.expectedUnits} esperadas por factura`
                  : `${receivingSummary.detectedUnits} unidades físicas detectadas`}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-white/42">
                El stock sale de lo que CLOUVA ve físicamente. La factura aporta cantidad esperada y costo; EAN/UPC/QR ayudan a identificar el producto.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {batchId ? (
                <button
                  type="button"
                  onClick={() => void reanalyzeCurrentBatch()}
                  disabled={busy}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-violet-300/20 bg-violet-300/[0.05] px-2.5 text-[10px] font-semibold text-violet-100 disabled:opacity-45"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Reanalizar fotos
                </button>
              ) : null}
              {invoiceData?.invoice ? (
                <span className={`w-fit rounded-full border px-2.5 py-1 text-[10px] font-semibold ${receivingSummary.complete ? "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-100" : "border-amber-300/25 bg-amber-300/[0.07] text-amber-100"}`}>
                  {pendingReviewIssues.length
                    ? `${pendingReviewIssues.length} CONFIRMACIÓN${pendingReviewIssues.length === 1 ? "" : "ES"}`
                    : receivingSummary.complete
                      ? "LISTO PARA INGRESAR"
                      : "REVISIÓN COMPLETA"}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Factura</p>
              <strong className="mt-1 block text-lg">{invoiceData?.invoice ? receivingSummary.expectedUnits : "—"}</strong>
              <span className="text-[9px] text-white/35">unidades esperadas</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Unidades</p>
              <strong className="mt-1 block text-lg">{receivingSummary.detectedUnits}</strong>
              <span className="text-[9px] text-white/35">físicas detectadas</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Faltan</p>
              <strong className={`mt-1 block text-lg ${receivingSummary.missingUnits ? "text-amber-200" : "text-emerald-200"}`}>
                {invoiceData?.invoice ? receivingSummary.missingUnits : "—"}
              </strong>
              <span className="text-[9px] text-white/35">vs. factura</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Sin código externo</p>
              <strong className={`mt-1 block text-lg ${receivingSummary.noCodeUnits ? "text-amber-200" : "text-emerald-200"}`}>
                {receivingSummary.noCodeUnits}
              </strong>
              <span className="text-[9px] text-white/35">tipos de producto</span>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
              <p className="text-[9px] uppercase tracking-[.12em] text-white/35">Extra</p>
              <strong className="mt-1 block text-lg">{invoiceData?.invoice ? receivingSummary.extraUnits : "—"}</strong>
              <span className="text-[9px] text-white/35">unidades vs. factura</span>
            </div>
          </div>

          {reviewIssues.length ? (
            <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-xs text-amber-100">
                    CLOUVA necesita tu confirmación ({pendingReviewIssues.length})
                  </strong>
                  <p className="mt-1 text-[10px] leading-4 text-white/40">
                    Solo aparecen diferencias reales de cantidad, identidad o evidencia visual. Confirmarlas no modifica la factura original.
                  </p>
                </div>
                {pendingReviewIssues.length === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : null}
              </div>
              <div className="mt-3 space-y-2">
                {reviewIssues.map((issue) => (
                  <div key={issue.key} className={`rounded-lg border p-2.5 ${issue.resolved ? "border-emerald-300/15 bg-emerald-300/[0.025]" : "border-amber-300/15 bg-black/20"}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <strong className="block text-xs">{issue.item.line_number}. {issue.item.description}</strong>
                        <div className="mt-1 space-y-0.5">
                          {issue.reasons.map((reason) => (
                            <p key={reason} className="text-[10px] leading-4 text-white/48">• {reason}</p>
                          ))}
                        </div>
                        {issue.item.unit_price != null ? (
                          <p className="mt-1 text-[9px] text-white/32">
                            Costo de factura conservado: {new Intl.NumberFormat("es-AR", { style: "currency", currency: invoiceData?.invoice?.currency || "ARS" }).format(issue.item.unit_price)}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={checkingInvoiceItem === issue.item.id}
                        onClick={() => void toggleInvoiceItem(issue.item, !issue.resolved)}
                        className={`shrink-0 rounded-lg border px-3 py-1.5 text-[10px] font-semibold disabled:opacity-45 ${issue.resolved ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/25 bg-amber-300/[0.06] text-amber-100"}`}
                      >
                        {issue.resolved ? "Confirmado" : "Confirmar recepción"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : invoiceData?.invoice ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.035] px-3 py-2 text-[10px] text-emerald-100">
              <CheckCircle2 className="h-4 w-4" /> CLOUVA no encontró diferencias que requieran tu intervención.
            </div>
          ) : null}

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
                      {row.code ? `${row.codeType.toUpperCase()} · ${row.code}` : "SIN CÓDIGO EXTERNO"}
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
              {invoiceData?.invoice && pendingReviewIssues.length ? (
                <span className="mr-auto text-[10px] leading-4 text-amber-100/70">
                  Confirmá las {pendingReviewIssues.length} diferencia{pendingReviewIssues.length === 1 ? "" : "s"} de arriba para habilitar el ingreso.
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void confirmPurchaseImport()}
                disabled={busy || Boolean(invoiceData?.invoice && pendingReviewIssues.length)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500/90 px-4 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <CheckCircle2 className="h-4 w-4" />
                {invoiceData?.invoice ? `Ingresar ${receivingSummary.detectedUnits} unidades al stock` : "Ingresar sin factura"}
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
            {visibleInvoiceItems.map((item) => (
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
          {invoiceData.items.length > 6 ? (
            <button
              type="button"
              onClick={() => setShowAllInvoiceItems((current) => !current)}
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-xs font-semibold text-white/60 transition hover:border-violet-300/25 hover:text-white"
            >
              {showAllInvoiceItems ? "Mostrar menos" : `Ver los ${invoiceData.items.length} renglones de la factura`}
            </button>
          ) : null}
        </div>
      ) : null}

      {invoiceData?.invoice && invoiceData.items.length && groups.length ? (
        <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/20 p-3 sm:p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/40">Artículos de factura</p>
          <p className="mt-1 text-[10px] leading-4 text-white/38">
            Cada renglón con sus fotos, sus códigos y su tilde. Lo que no está en factura va a Sobras.
          </p>
          <div className="mt-3 space-y-2">
            {invoiceData.items.map((item) => {
              const matched = groups
                .filter((group) => item.matched_group_keys.includes(group.groupKey))
                .map((group) => {
                  const photos = group.images.map((image) => ({
                    ...image,
                    url: batchSources[image.sourceIndex]?.source_url || previews[image.sourceIndex] || "",
                  }));
                  const cover = photos.find((photo) => photo.role === "Frente" && photo.url)?.url
                    ?? photos.find((photo) => photo.url)?.url
                    ?? "";
                  return { group, cover, photos };
                });
              const detectedUnits = matched.reduce(
                (total, entry) => total + Math.max(1, Math.floor(Number(entry.group.unitCount) || 1)),
                0,
              );
              return (
                <div key={item.id} className="rounded-xl border border-white/[0.07] bg-black/15 p-3">
                  <div className="flex items-start gap-2.5">
                    <button
                      type="button"
                      disabled={checkingInvoiceItem === item.id}
                      onClick={() => void toggleInvoiceItem(item, !item.checked)}
                      aria-label={item.checked ? "Desmarcar renglón" : "Chequear renglón"}
                      className="mt-0.5 shrink-0 disabled:opacity-45"
                    >
                      {item.checked ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <span className="grid h-4 w-4 place-items-center rounded-full border border-white/20" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <strong className="min-w-0 flex-1 text-xs leading-5">{item.line_number}. {item.description}</strong>
                        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${detectedUnits === item.quantity ? "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-200" : detectedUnits < item.quantity ? "border-amber-300/25 bg-amber-300/[0.07] text-amber-200" : "border-sky-300/25 bg-sky-300/[0.07] text-sky-200"}`}>
                          {detectedUnits === item.quantity ? "Coincide" : detectedUnits < item.quantity ? `Faltan ${item.quantity - detectedUnits}` : `Sobran ${detectedUnits - item.quantity}`} · {detectedUnits}/{item.quantity}
                        </span>
                      </div>
                      {matched.length ? (
                        <div className="mt-2 space-y-1.5">
                          {matched.map(({ group, cover, photos }) => {
                            const photoCount = photos.filter((photo) => photo.url).length;
                            const expanded = expandedArticlePhotos === group.groupKey;
                            return (
                              <div key={group.groupKey} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                                <div className="flex items-center gap-2.5">
                                  {cover ? (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img src={cover} alt={group.name || "Producto"} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover" loading="lazy" />
                                  ) : (
                                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-[8px] text-white/30">s/foto</span>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[11px] font-semibold">{group.name || "Producto detectado"}</p>
                                    <p className="mt-0.5 truncate text-[9px] text-white/40">
                                      {group.images.length} foto{group.images.length === 1 ? "" : "s"} · {group.identifier ? `${group.identifier.type.toUpperCase()} ${group.identifier.value}` : "sin código"} · {Math.max(1, Math.floor(Number(group.unitCount) || 1))} un.
                                    </p>
                                  </div>
                                  {photoCount > 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedArticlePhotos((current) => current === group.groupKey ? "" : group.groupKey)}
                                      className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[9px] font-semibold text-white/55 transition hover:border-violet-300/25 hover:text-white"
                                    >
                                      {expanded ? "Ocultar" : `Ver ${photoCount}`}
                                    </button>
                                  ) : null}
                                </div>
                                {expanded ? (
                                  <div className="mt-2 flex gap-1.5 overflow-x-auto border-t border-white/[0.06] pt-2">
                                    {photos.map((photo) => photo.url ? (
                                      <div key={photo.sourceIndex} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={photo.url}
                                          alt={`${group.name || "Producto"} · ${photo.role}`}
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                        <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1 py-0.5 text-[7px] font-semibold text-white/85">
                                          {photo.role}
                                        </span>
                                        <span className="absolute right-1 top-1 rounded bg-black/80 px-1 py-0.5 text-[7px] text-white/75">
                                          #{photo.sourceIndex + 1}
                                        </span>
                                      </div>
                                    ) : null)}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-[10px] text-amber-200/70">Sin fotos asignadas — este artículo todavía no apareció.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {(() => {
              const matchedKeys = new Set(invoiceData.items.flatMap((line) => line.matched_group_keys));
              const expectedByGroup = new Map<string, number>();
              for (const line of invoiceData.items) {
                for (const key of line.matched_group_keys) {
                  expectedByGroup.set(key, (expectedByGroup.get(key) ?? 0) + Math.max(0, Number(line.quantity) || 0));
                }
              }
              const leftovers = groups.filter((group) => !matchedKeys.has(group.groupKey));
              const overflows = groups.flatMap((group) => {
                const expected = expectedByGroup.get(group.groupKey) ?? 0;
                const detected = Math.max(1, Math.floor(Number(group.unitCount) || 1));
                return expected > 0 && detected > expected
                  ? [{ group, extraUnits: detected - expected }]
                  : [];
              });
              const unmatchedUnits = leftovers.reduce(
                (total, group) => total + Math.max(1, Math.floor(Number(group.unitCount) || 1)),
                0,
              );
              const overflowUnits = overflows.reduce((total, entry) => total + entry.extraUnits, 0);
              if (!leftovers.length && !overflows.length) return null;
              const row = (group: BatchGroup, units: number, extra: boolean) => {
                const ordered = group.images.map((image) => ({
                  role: image.role,
                  url: batchSources[image.sourceIndex]?.source_url || previews[image.sourceIndex] || "",
                }));
                const cover = ordered.find((photo) => photo.role === "Frente" && photo.url)?.url
                  ?? ordered.find((photo) => photo.url)?.url
                  ?? "";
                return (
                  <div key={`${extra ? "overflow" : "leftover"}-${group.groupKey}`} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                    {cover ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={cover} alt={group.name || "Producto"} className="h-10 w-10 shrink-0 rounded-lg border border-white/10 object-cover" loading="lazy" />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-[8px] text-white/30">s/foto</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">{group.name || "Producto detectado"}</p>
                      <p className="mt-0.5 truncate text-[9px] text-white/40">
                        {group.images.length} foto{group.images.length === 1 ? "" : "s"} · {group.identifier ? `${group.identifier.type.toUpperCase()} ${group.identifier.value}` : "sin código"} · {units} un. {extra ? "extra" : "fuera de factura"}
                      </p>
                    </div>
                    {extra ? (
                      <span className="shrink-0 rounded-md border border-sky-300/25 bg-sky-300/[0.07] px-1.5 py-0.5 text-[9px] font-semibold text-sky-200">
                        +{units}
                      </span>
                    ) : null}
                  </div>
                );
              };
              return (
                <div className="rounded-xl border border-sky-300/15 bg-sky-300/[0.03] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-sky-200/80">
                    Sobras · fuera de factura ({unmatchedUnits + overflowUnits} un.)
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {overflows.map(({ group, extraUnits }) => row(group, extraUnits, true))}
                    {leftovers.map((group) => row(group, Math.max(1, Math.floor(Number(group.unitCount) || 1)), false))}
                  </div>
                  <p className="mt-2 text-[9px] leading-4 text-white/35">
                    Los excedentes de un artículo facturado aparecen acá como unidades extra. Una vista repetida del mismo objeto no suma una unidad.
                  </p>
                </div>
              );
            })()}
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
            {visibleDetectedGroups.map((group) => {
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
              const coverPhoto = photos.find((photo) => photo.role === "Frente" && photo.url)
                ?? photos.find((photo) => photo.url)
                ?? null;
              const expandedPhotos = expandedPhotoGroup === group.groupKey;
              const codePhotoIndex = group.visibleIdentifiers.find((code) =>
                code.sourceIndex != null
                && (!group.identifier
                  || (code.type === group.identifier.type && code.value === group.identifier.value)),
              )?.sourceIndex;
              // Conciliación por artículo: fotos del grupo + cantidad según
              // factura (líneas que matchean este groupKey) vs cantidad según
              // código/QR (unidades físicas del grupo).
              const invoiceLines = (invoiceData?.items ?? []).filter((item) =>
                Array.isArray(item.matched_group_keys) && item.matched_group_keys.includes(group.groupKey),
              );
              const invoiceUnits = invoiceLines.reduce((total, item) => total + Math.max(0, Number(item.quantity) || 0), 0);
              const physicalUnits = Math.max(1, Math.floor(Number(group.unitCount) || 1));
              const sharedContextPhotos = (group.contextReferences ?? []).flatMap((reference) => {
                const source = batchSources[reference.sourceIndex];
                if (!source?.source_url) return [];
                return [{
                  sourceIndex: reference.sourceIndex,
                  url: source.source_url,
                  fileName: source.file_name || "",
                  label: reference.label,
                  confidence: reference.confidence,
                }];
              });
              return (
                <div key={group.groupKey} className="rounded-xl border border-white/[0.08] bg-black/20 p-3">
                  <div className="flex items-start gap-3">
                    {coverPhoto ? (
                      <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-violet-300/15 bg-black/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={coverPhoto.url}
                          alt={coverPhoto.fileName || `${group.name || "Producto"} · Frente`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1.5 py-0.5 text-[8px] font-semibold text-white/85">
                          Frente
                        </span>
                        <span className="absolute right-1 top-1 rounded bg-black/80 px-1 py-0.5 text-[8px] text-white/75">
                          #{coverPhoto.sourceIndex + 1}
                        </span>
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
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
                    {group.images.length} foto{group.images.length === 1 ? "" : "s"} agrupada{group.images.length === 1 ? "" : "s"}
                    {coverPhoto ? ` · frente #${coverPhoto.sourceIndex + 1}` : ""}
                  </p>
                  {invoiceData && invoiceData.items.length ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
                      <span className="text-[10px] text-white/55">
                        Factura: <strong className="text-white/85">{invoiceUnits}</strong>
                        {invoiceLines.length ? ` · línea ${invoiceLines.map((line) => line.line_number).join(", ")}` : " · no está en factura (sobra)"}
                      </span>
                      <span className="text-white/20">·</span>
                      <span className="text-[10px] text-white/55">
                        Stock físico: <strong className="text-white/85">{physicalUnits}</strong>
                        {group.identifier ? ` · código ${group.identifier.type.toUpperCase()} ${group.identifier.value}` : " · sin código externo"}
                      </span>
                      {invoiceLines.length ? (
                        <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${physicalUnits === invoiceUnits ? "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-200" : physicalUnits < invoiceUnits ? "border-amber-300/25 bg-amber-300/[0.07] text-amber-200" : "border-sky-300/25 bg-sky-300/[0.07] text-sky-200"}`}>
                          {physicalUnits === invoiceUnits ? "Coincide" : physicalUnits < invoiceUnits ? `Faltan ${invoiceUnits - physicalUnits}` : `Sobran ${physicalUnits - invoiceUnits}`}
                        </span>
                      ) : (
                        <span className="rounded-md border border-sky-300/25 bg-sky-300/[0.07] px-1.5 py-0.5 text-[9px] font-semibold text-sky-200">
                          Extra
                        </span>
                      )}
                    </div>
                  ) : null}
                  {group.identifier && codePhotoIndex != null ? (
                    <p className="mt-1 text-[10px] leading-4 text-emerald-200/70">
                      Código confirmado desde foto #{codePhotoIndex + 1}
                    </p>
                  ) : null}
                  {group.visibleIdentifiers.length > 1 ? (
                    <p className="mt-1 text-[10px] leading-4 text-white/35">
                      Códigos leídos: {group.visibleIdentifiers.map((code) => `${code.type.toUpperCase()} ${code.value}${code.sourceIndex != null ? ` (#${code.sourceIndex + 1})` : ""}`).join(" · ")}
                    </p>
                  ) : null}
                  {photos.filter((photo) => photo.url).length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedPhotoGroup((current) => current === group.groupKey ? "" : group.groupKey)}
                      className="mt-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white/55 transition hover:border-violet-300/25 hover:text-white"
                    >
                      {expandedPhotos ? "Ocultar fotos" : `Ver ${photos.filter((photo) => photo.url).length} fotos del producto`}
                    </button>
                  ) : null}
                  {batchId && !busy ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {mergingSource === "" ? (
                        <button
                          type="button"
                          onClick={() => setMergingSource(group.groupKey)}
                          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-white/55 transition hover:border-cyan-300/25 hover:text-white"
                        >
                          Fusionar
                        </button>
                      ) : mergingSource === group.groupKey ? (
                        <button
                          type="button"
                          onClick={() => setMergingSource("")}
                          className="rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-2.5 py-1.5 text-[10px] font-semibold text-amber-100"
                        >
                          Cancelar fusión
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={mergingGroup !== ""}
                          onClick={() => void mergeGroupsInto(mergingSource, group.groupKey)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/[0.08] px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 disabled:opacity-45"
                        >
                          {mergingGroup === group.groupKey ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                          Fusionar aquí
                        </button>
                      )}
                    </div>
                  ) : null}
                  {mergingSource !== "" && mergingSource !== group.groupKey ? (
                    <p className="mt-1 text-[9px] text-cyan-100/50">Fusionando: elegí la ficha destino con “Fusionar aquí”.</p>
                  ) : null}
                  </div>
                  </div>
                  {expandedPhotos ? (
                    <div className="mt-3 flex gap-2 overflow-x-auto border-t border-white/[0.06] pt-3">
                      {photos.map((photo) => photo.url ? (
                        <div key={photo.sourceIndex} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={photo.fileName || `${group.name || "Producto"} · ${photo.role}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1.5 py-0.5 text-[8px] font-semibold text-white/85">
                            {codePhotoIndex === photo.sourceIndex ? "Código" : photo.role}
                          </span>
                          <span className="absolute right-1 top-1 rounded bg-black/80 px-1 py-0.5 text-[8px] text-white/75">
                            #{photo.sourceIndex + 1}
                          </span>
                        </div>
                      ) : null)}
                    </div>
                  ) : null}
                  {sharedContextPhotos.length ? (
                    <div className="mt-3 border-t border-cyan-300/[0.08] pt-3">
                      <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-cyan-200/70">
                        También aparece en fotos mixtas
                      </p>
                      <div className="mt-2 flex gap-2 overflow-x-auto">
                        {sharedContextPhotos.map((photo) => (
                          <div key={photo.sourceIndex} className="w-24 shrink-0">
                            <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-cyan-300/15 bg-black/30">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photo.url}
                                alt={photo.fileName || `Contexto #${photo.sourceIndex + 1}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                              <span className="absolute bottom-1 left-1 rounded bg-cyan-950/90 px-1.5 py-0.5 text-[8px] font-semibold text-cyan-100">
                                Contexto
                              </span>
                              <span className="absolute right-1 top-1 rounded bg-black/80 px-1 py-0.5 text-[8px] text-white/75">
                                #{photo.sourceIndex + 1}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[8px] leading-3 text-cyan-100/55">{photo.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
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
                        <span className="text-[10px] text-amber-100/60">Sin código externo: CLOUVA puede generar un código interno al ingresar el producto.</span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {groups.length > 8 ? (
            <button
              type="button"
              onClick={() => setShowAllDetectedGroups((current) => !current)}
              className="mt-3 w-full rounded-xl border border-violet-300/15 bg-violet-300/[0.04] px-3 py-3 text-xs font-semibold text-violet-100 transition hover:bg-violet-300/[0.08]"
            >
              {showAllDetectedGroups ? "Mostrar menos productos" : `Ver los ${groups.length} productos detectados`}
            </button>
          ) : null}
        </div>
      ) : null}

      {contextPhotos.length ? (
        <div className="mt-4 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-cyan-200">Evidencia pendiente</p>
              <p className="mt-1 text-[10px] leading-4 text-white/42">
                Solo quedan acá las fotos en las que CLOUVA todavía no pudo confirmar una identidad única. Si encuentra un código/QR válido, esa foto pasa a producto y entra en la recepción.
              </p>
            </div>
            <span className="rounded-full border border-cyan-300/15 px-2 py-1 text-[10px] text-cyan-100/70">{contextPhotos.length}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {contextPhotos.map((photo) => {
              const observed = Array.isArray(photo.recognition?.observed_products)
                ? photo.recognition.observed_products.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                : [];
              const matchedProducts = Array.isArray(photo.recognition?.matched_products)
                ? photo.recognition.matched_products.filter((value) => value && typeof value.label === "string" && value.label.trim().length > 0)
                : [];
              return (
                <div key={photo.id} className="flex gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-cyan-300/10 bg-black/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.source_url} alt={photo.file_name || `Foto mixta #${photo.source_index + 1}`} className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute right-1 top-1 rounded bg-black/80 px-1 py-0.5 text-[8px] text-white/75">#{photo.source_index + 1}</span>
                  </div>
                  <div className="min-w-0">
                    <strong className="text-xs text-cyan-100">Evidencia · identidad pendiente</strong>
                    <p className="mt-1 text-[10px] leading-4 text-white/65">
                      {observed.length ? `Veo: ${observed.join(" · ")}` : "Analizando los productos visibles de esta escena."}
                    </p>
                    {matchedProducts.length ? (
                      <p className="mt-1 text-[9px] leading-4 text-cyan-200/70">
                        Vinculada con: {matchedProducts.map((item) => item.label).join(" · ")}
                      </p>
                    ) : null}
                    {photo.recognition?.context_reason ? (
                      <p className="mt-1 text-[9px] leading-4 text-white/30">{photo.recognition.context_reason}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
