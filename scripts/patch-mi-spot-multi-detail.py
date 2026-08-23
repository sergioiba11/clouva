from pathlib import Path

path = Path("components/commerce/SpotCommerceDashboard.tsx")
text = path.read_text(encoding="utf-8")

if "MAX_PRODUCT_DETAIL_IMAGES" in text and "function ProductCapturePreview" in text:
    print("MI SPOT scanner already patched")
    raise SystemExit(0)


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label}, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'import type { CommerceProductRecognition } from "@/lib/commerce/product-recognition";',
    '''import type { CommerceProductRecognition } from "@/lib/commerce/product-recognition";
import {
  MAX_PRODUCT_DETAIL_IMAGES,
  MAX_PRODUCT_REFERENCE_IMAGES,
  orderProductCaptures,
  type ProductCaptureLabel,
} from "@/lib/commerce/product-capture-contract";''',
    "capture contract import",
)

replace_once(
    '''type ProductCapture = {
  id: string;
  label: "Frente" | "Atrás" | "Detalle";
  dataUrl: string;
};''',
    '''type ProductCapture = {
  id: string;
  label: ProductCaptureLabel;
  dataUrl: string;
};''',
    "ProductCapture type",
)

replace_once(
    '''type StoredProductSource = {
  label: ProductCapture["label"];
  url: string;
  storagePath: string;
  mimeType: string;
};''',
    '''type StoredProductSource = {
  label: ProductCapture["label"];
  detailIndex: number | null;
  displayLabel: string;
  url: string;
  storagePath: string;
  mimeType: string;
};''',
    "StoredProductSource type",
)

replace_once(
    '''type GeneratedProductImage = {
  kind: GeneratedProductImageKind;
  sourceLabel: ProductCapture["label"];
  url: string;
  storagePath: string;
  mimeType: string;
  model: string;
};''',
    '''type GeneratedProductImage = {
  kind: GeneratedProductImageKind;
  sourceLabel: ProductCapture["label"];
  detailIndex: number | null;
  url: string;
  storagePath: string;
  mimeType: string;
  model: string;
};''',
    "GeneratedProductImage type",
)

replace_once(
    '''function nextCaptureLabel(index: number): ProductCapture["label"] {
  return index === 0 ? "Frente" : index === 1 ? "Atrás" : "Detalle";
}
''',
    '''function getFrontCapture(captures: ProductCapture[]) {
  return captures.find((capture) => capture.label === "Frente") ?? null;
}

function getBackCapture(captures: ProductCapture[]) {
  return captures.find((capture) => capture.label === "Atrás") ?? null;
}

function getDetailCaptures(captures: ProductCapture[]) {
  return captures.filter((capture) => capture.label === "Detalle");
}

function productCaptureDisplayLabels(captures: ProductCapture[]) {
  let detailIndex = 0;
  return orderProductCaptures(captures).map((capture) => capture.label === "Detalle" ? `Detalle ${++detailIndex}` : capture.label);
}

function productReferenceSummary(captures: ProductCapture[]) {
  const detailCount = getDetailCaptures(captures).length;
  const parts = [
    getFrontCapture(captures) ? "Frente" : null,
    getBackCapture(captures) ? "Atrás" : null,
    detailCount ? `${detailCount} ${detailCount === 1 ? "detalle" : "detalles"}` : null,
  ].filter(Boolean);
  return parts.length ? `Gemini usará ${parts.join(" + ")}.` : "Agregá el Frente para empezar.";
}
''',
    "capture helpers",
)

start = text.index('  function captureProductPhoto(label: ProductCapture["label"]) {')
end = text.index('  async function analyzeProductWithGemini() {', start)
text = text[:start] + r'''  function invalidateProductAiResults() {
    setRecognitionResult(null);
    setProductImagesResult(null);
    setSelectedCoverImage("");
  }

  function removeProductCapture(captureId: string) {
    const removed = productCaptures.find((capture) => capture.id === captureId);
    setProductCaptures((current) => current.filter((capture) => capture.id !== captureId));
    invalidateProductAiResults();
    setMessage(removed?.label === "Detalle"
      ? "Detalle eliminado. Volvé a analizar o generar para usar el conjunto actualizado."
      : `${removed?.label || "Vista"} eliminada. Volvé a analizar el producto.`);
  }

  function captureProductPhoto(label: ProductCapture["label"]) {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setError("Abrí la cámara y enfocá el producto antes de capturar.");
      return;
    }
    const detailCount = getDetailCaptures(productCaptures).length;
    if (label === "Detalle" && detailCount >= MAX_PRODUCT_DETAIL_IMAGES) {
      setError(`Podés cargar hasta ${MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle.`);
      return;
    }
    try {
      const dataUrl = imageToJpegDataUrl(video, video.videoWidth, video.videoHeight);
      const capture = { id: crypto.randomUUID(), label, dataUrl };
      setProductCaptures((current) => {
        if (label === "Detalle") {
          if (getDetailCaptures(current).length >= MAX_PRODUCT_DETAIL_IMAGES) return current;
          return orderProductCaptures([...current, capture]);
        }
        return orderProductCaptures([...current.filter((item) => item.label !== label), capture]);
      });
      invalidateProductAiResults();
      if (label === "Detalle") {
        const nextCount = Math.min(MAX_PRODUCT_DETAIL_IMAGES, detailCount + 1);
        setMessage(`Detalle agregado. ${nextCount} ${nextCount === 1 ? "detalle listo" : "detalles listos"} para Gemini.`);
      } else if (label === "Frente") {
        setMessage("Frente capturado. Ahora podés sumar Atrás y todos los Detalles que necesites.");
      } else {
        setMessage("Atrás capturado. Podés seguir agregando Detalles para darle más contexto a Gemini.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo capturar la foto.");
    }
  }

  async function uploadProductPhotos(files: FileList | null) {
    const incoming = Array.from(files ?? []);
    if (!incoming.length) return;
    const frontMissing = !getFrontCapture(productCaptures);
    const backMissing = !getBackCapture(productCaptures);
    const existingDetails = getDetailCaptures(productCaptures).length;
    const detailSlots = Math.max(0, MAX_PRODUCT_DETAIL_IMAGES - existingDetails);
    const capacity = (frontMissing ? 1 : 0) + (frontMissing && backMissing ? 1 : 0) + detailSlots;
    const selected = incoming.slice(0, Math.min(capacity, MAX_PRODUCT_REFERENCE_IMAGES));
    if (!selected.length) {
      setError(`Ya alcanzaste el límite de ${MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle.`);
      return;
    }
    setError(null);
    try {
      const compressed = await Promise.all(selected.map(compressProductImage));
      setProductCaptures((current) => {
        let next = [...current];
        let cursor = 0;
        const needsFront = !getFrontCapture(next);
        if (needsFront && compressed[cursor]) {
          next = [...next.filter((item) => item.label !== "Frente"), { id: crypto.randomUUID(), label: "Frente" as const, dataUrl: compressed[cursor++] }];
        }
        if (needsFront && !getBackCapture(next) && compressed[cursor]) {
          next = [...next.filter((item) => item.label !== "Atrás"), { id: crypto.randomUUID(), label: "Atrás" as const, dataUrl: compressed[cursor++] }];
        }
        const room = Math.max(0, MAX_PRODUCT_DETAIL_IMAGES - getDetailCaptures(next).length);
        const details = compressed.slice(cursor, cursor + room).map((dataUrl) => ({ id: crypto.randomUUID(), label: "Detalle" as const, dataUrl }));
        return orderProductCaptures([...next, ...details]);
      });
      invalidateProductAiResults();
      const assignedBaseViews = frontMissing ? Math.min(backMissing ? 2 : 1, compressed.length) : 0;
      const addedDetails = Math.max(0, compressed.length - assignedBaseViews);
      const nextDetailCount = Math.min(MAX_PRODUCT_DETAIL_IMAGES, existingDetails + addedDetails);
      setMessage(addedDetails > 0
        ? `${nextDetailCount} ${nextDetailCount === 1 ? "detalle listo" : "detalles listos"} para Gemini. Las referencias nuevas invalidaron el análisis anterior.`
        : `${compressed.length} ${compressed.length === 1 ? "vista cargada" : "vistas cargadas"}. Ya podés analizar el producto.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron preparar las fotos.");
    }
  }

''' + text[end:]

replace_once(
    '''    if (!productCaptures.length) {
      setError("Capturá el frente del producto o subí una foto.");
      return;
    }
    setRecognizingProduct(true);''',
    '''    if (!getFrontCapture(productCaptures)) {
      setError("Capturá el Frente del producto antes de analizarlo con Gemini.");
      return;
    }
    const orderedCaptures = orderProductCaptures(productCaptures);
    setRecognizingProduct(true);''',
    "recognition front requirement",
)
replace_once(
    '          images: productCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),',
    '          images: orderedCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),',
    "recognition ordered payload",
)
replace_once(
    '''    setGeneratingProductImages(true);
    setError(null);''',
    '''    const orderedCaptures = orderProductCaptures(productCaptures);
    setGeneratingProductImages(true);
    setError(null);''',
    "generation ordering",
)
replace_once(
    '          captures: productCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),',
    '          captures: orderedCaptures.map(({ label, dataUrl }) => ({ label, dataUrl })),',
    "generation ordered payload",
)
replace_once(
    '        captured_views: productCaptures.map((capture) => capture.label),',
    '        captured_views: productCaptureDisplayLabels(productCaptures),',
    "captured views metadata",
)
replace_once(
    '''          label: photo.label,
          url: photo.url,
          storage_path: photo.storagePath,
          mime_type: photo.mimeType,''',
    '''          label: photo.label,
          display_label: photo.displayLabel,
          detail_index: photo.detailIndex,
          url: photo.url,
          storage_path: photo.storagePath,
          mime_type: photo.mimeType,''',
    "source metadata",
)
replace_once(
    '''          kind: image.kind,
          source_label: image.sourceLabel,
          url: image.url,''',
    '''          kind: image.kind,
          source_label: image.sourceLabel,
          detail_index: image.detailIndex,
          url: image.url,''',
    "generated metadata",
)
replace_once(
    '''  const goal = data.summary.goal;
  const goalProgress = goal ? Math.max(0, Math.min(100, Number(goal.progress_amount || 0) / Number(goal.target_amount || 1) * 100)) : 0;

  return (''',
    '''  const goal = data.summary.goal;
  const goalProgress = goal ? Math.max(0, Math.min(100, Number(goal.progress_amount || 0) / Number(goal.target_amount || 1) * 100)) : 0;
  const frontCapture = getFrontCapture(productCaptures);
  const backCapture = getBackCapture(productCaptures);
  const detailCaptures = getDetailCaptures(productCaptures);
  const referenceSummary = productReferenceSummary(productCaptures);

  return (''',
    "computed captures",
)

section_start = text.index('              <section className="border-t border-white/[0.08] bg-[radial-gradient(circle_at_0%_0%,rgba(124,58,237,.12),transparent_48%)] p-4">')
section_end_marker = '              </section>\n            </div>\n            <div className="space-y-4">'
section_end = text.index(section_end_marker, section_start) + len('              </section>\n')
text = text[:section_start] + r'''              <section className="border-t border-white/[0.08] bg-[radial-gradient(circle_at_0%_0%,rgba(124,58,237,.12),transparent_48%)] p-4">
                <div className="flex items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-300"><Sparkles className="h-4 w-4" /> Escanear producto con IA</p><p className="mt-2 text-xs leading-5 text-white/40">Frente es obligatorio, Atrás es opcional y podés sumar hasta {MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle. Gemini usa todas las referencias del mismo objeto para analizarlo y generar imágenes limpias de catálogo.</p></div><span className="shrink-0 rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-1 text-[9px] font-bold text-violet-200">GEMINI</span></div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className={`rounded-xl border px-3 py-2 ${frontCapture ? "border-emerald-400/25 bg-emerald-400/[0.07]" : "border-amber-400/20 bg-amber-400/[0.04]"}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold">Frente</span>{frontCapture ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : null}</div><p className={`mt-1 text-[9px] ${frontCapture ? "text-emerald-200/70" : "text-amber-200/55"}`}>{frontCapture ? "Capturado" : "Obligatorio"}</p></div>
                  <div className={`rounded-xl border px-3 py-2 ${backCapture ? "border-emerald-400/25 bg-emerald-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold">Atrás</span>{backCapture ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" /> : null}</div><p className={`mt-1 text-[9px] ${backCapture ? "text-emerald-200/70" : "text-white/30"}`}>{backCapture ? "Capturado" : "Opcional"}</p></div>
                  <div className={`rounded-xl border px-3 py-2 ${detailCaptures.length ? "border-violet-400/25 bg-violet-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold">Detalles</span><span className="text-[9px] font-semibold text-violet-200">{detailCaptures.length}/{MAX_PRODUCT_DETAIL_IMAGES}</span></div><p className="mt-1 text-[9px] text-white/30">Múltiples · opcionales</p></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button type="button" disabled={!scanning} onClick={() => captureProductPhoto("Frente")} className="rounded-xl border border-white/10 px-3 py-2.5 text-xs disabled:opacity-35"><Camera className="mr-1.5 inline h-3.5 w-3.5" />Frente</button>
                  <button type="button" disabled={!scanning} onClick={() => captureProductPhoto("Atrás")} className="rounded-xl border border-white/10 px-3 py-2.5 text-xs disabled:opacity-35"><Camera className="mr-1.5 inline h-3.5 w-3.5" />Atrás</button>
                  <button type="button" disabled={!scanning || detailCaptures.length >= MAX_PRODUCT_DETAIL_IMAGES} onClick={() => captureProductPhoto("Detalle")} className="rounded-xl border border-white/10 px-3 py-2.5 text-xs disabled:opacity-35"><Camera className="mr-1.5 inline h-3.5 w-3.5" />Detalle</button>
                  <label className="cursor-pointer rounded-xl border border-white/10 px-3 py-2.5 text-center text-xs"><ImagePlus className="mr-1.5 inline h-3.5 w-3.5" />{frontCapture ? "Subir detalles" : "Subir"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => { void uploadProductPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>
                </div>
                <p className="mt-3 rounded-xl border border-violet-400/10 bg-violet-500/[0.04] px-3 py-2 text-[10px] text-violet-100/65">{referenceSummary}</p>
                {frontCapture || backCapture ? <div className="mt-3 grid grid-cols-2 gap-2">{frontCapture ? <ProductCapturePreview capture={frontCapture} label="Frente" onRemove={() => removeProductCapture(frontCapture.id)} /> : <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-amber-400/20 text-[10px] text-amber-200/45">Falta Frente</div>}{backCapture ? <ProductCapturePreview capture={backCapture} label="Atrás" onRemove={() => removeProductCapture(backCapture.id)} /> : <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-white/10 text-[10px] text-white/25">Atrás opcional</div>}</div> : null}
                {detailCaptures.length ? <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-violet-300">Detalles del objeto</p><p className="mt-1 text-[9px] text-white/30">Cada imagen suma contexto; podés borrar cualquiera individualmente.</p></div><span className="rounded-full border border-violet-400/20 px-2 py-1 text-[9px] text-violet-200">{detailCaptures.length}</span></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{detailCaptures.map((capture, index) => <ProductCapturePreview key={capture.id} capture={capture} label={`Detalle ${index + 1}`} onRemove={() => removeProductCapture(capture.id)} />)}</div></div> : null}
                <button type="button" disabled={recognizingProduct || !frontCapture} onClick={() => void analyzeProductWithGemini()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-semibold shadow-[0_10px_28px_rgba(124,58,237,.22)] disabled:opacity-40">{recognizingProduct ? <><LoaderCircle className="h-4 w-4 animate-spin" />Analizando producto…</> : <><Sparkles className="h-4 w-4" />Analizar y completar datos</>}</button>
                <button type="button" disabled={generatingProductImages || !recognitionResult || !frontCapture} onClick={() => void generateProductImagesWithGemini()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/[0.08] px-4 py-3 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/[0.14] disabled:opacity-35">{generatingProductImages ? <><LoaderCircle className="h-4 w-4 animate-spin" />Generando imágenes de catálogo…</> : <><ImagePlus className="h-4 w-4" />Generar imágenes del producto</>}</button>
                {productImagesResult ? <div className="mt-4 rounded-2xl border border-violet-400/20 bg-black/20 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Imágenes de catálogo</p><p className="mt-1 text-[10px] text-white/35">Elegí cuál será la portada del producto.</p></div><span className="rounded-full border border-violet-400/20 px-2 py-1 text-[9px] text-violet-200">{productImagesResult.generatedImages.length} GEMINI</span></div><div className="mt-3 grid grid-cols-3 gap-2">{productImagesResult.generatedImages.map((image) => { const selected = selectedCoverImage === image.url; return <button type="button" key={`${image.kind}-${image.url}`} onClick={() => setSelectedCoverImage(image.url)} className={`relative overflow-hidden rounded-xl border text-left ${selected ? "border-violet-300 shadow-[0_0_20px_rgba(139,92,246,.25)]" : "border-white/10"}`}><img src={image.url} alt={image.sourceLabel} className="aspect-square w-full object-cover" /><span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/80 px-1.5 py-1 text-[9px]">{image.sourceLabel}{image.detailIndex ? ` ${image.detailIndex}` : ""}</span>{selected ? <span className="absolute right-1.5 top-1.5 rounded-md bg-violet-600 px-1.5 py-1 text-[8px] font-bold uppercase tracking-wider">Portada</span> : null}</button>; })}</div><p className="mt-3 text-[10px] text-white/35">Originales guardados: {productImagesResult.sourcePhotos.map((photo) => photo.displayLabel).join(" · ")}</p></div> : null}
              </section>
''' + text[section_end:]

marker = '\nfunction SpotDashboard({ data, goal, goalProgress, busy, onNavigate, onRefreshFx }: {'
preview = r'''

function ProductCapturePreview({ capture, label, onRemove }: { capture: ProductCapture; label: string; onRemove: () => void }) {
  return <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-black"><img src={capture.dataUrl} alt={label} className="aspect-square h-full w-full object-cover" /><span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/80 px-1.5 py-1 text-[9px]">{label}</span><button type="button" aria-label={`Eliminar ${label}`} onClick={onRemove} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-black/80 text-white/70 transition hover:text-white"><Trash2 className="h-3.5 w-3.5" /></button></div>;
}
'''
if text.count(marker) != 1:
    raise SystemExit("SpotDashboard marker not found exactly once")
text = text.replace(marker, preview + marker, 1)

path.write_text(text, encoding="utf-8")
print("MI SPOT multi-detail scanner patched")
