"use client";

import { Suspense, useRef, useState, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type NormalizedBox = { top: number; left: number; bottom: number; right: number };
type SourceKind = "own_logo_file" | "own_mockup" | "designer_delivery" | "reference_only";
type ComponentAnalysis = { kind: string; present: boolean; confidence: number; box: NormalizedBox | null; description: string; expectedText: string | null };
type DetectedLogo = {
  detected: boolean;
  confidence: number;
  primaryBox: NormalizedBox | null;
  occurrences: Array<{ box: NormalizedBox; role: string; confidence: number }>;
  logoType: string | null;
  visibleText: { primaryName: string | null; descriptor: string | null; otherText: string[] };
  lockupStructure: { symbolPosition: string; namePosition: string; descriptorPosition: string; orientation: string; letterSpacing: string } | null;
  visualSignature: { silhouette?: string; typographyStyle?: string | null; palette?: string[] } | null;
  decomposition: { components: ComponentAnalysis[]; foregroundPolarity: string; recommendedColorCount: number; backgroundDescription: string } | null;
};
type BrandNaming = { entityName: string; displayName: string; descriptor: string | null; source: string };
type AnalyzeResult = { detectedLogo: DetectedLogo; naming: BrandNaming; suggestedTypography: Record<string, unknown> };
type CandidateUrls = {
  primary_logo_url: string; symbol_logo_url: string; horizontal_logo_url: string; vertical_logo_url: string;
  square_logo_url: string; transparent_logo_url: string; white_logo_url: string; black_logo_url: string; favicon_url: string;
  master_svg_url?: string | null; symbol_svg_url?: string | null; horizontal_svg_url?: string | null; vertical_svg_url?: string | null;
  white_svg_url?: string | null; black_svg_url?: string | null; monochrome_svg_url?: string | null; print_pdf_url?: string | null; brand_config_url?: string | null;
};
type Validation = { rasterSimilarity: number; edgeSimilarity: number; smallSizeLegible: boolean; monochromeValid: boolean; transparentBackground: boolean; nodeCount: number; warnings: string[] };
type Clearance = { status: string; decisionReasons: string[]; external: { checked: boolean; sourcesChecked: string[] }; internal: { status: string } };
type ResolveResult = {
  jobId: string; brandAssetId: string; brandAssetVersionId: string; status: "awaiting_review" | "reused_official";
  mode: "legacy_raster_import" | "owned_identity_reconstruction" | "clouva_generated_redesign" | "standalone_creation";
  urls: CandidateUrls | null; sourceReferenceUrl: string | null; reconstructionPreviewUrl: string | null;
  standaloneSymbolAvailable: boolean; clearance: Clearance | null; validation: Validation | null; costUsd: number;
};
type ReconstructionParams = { colorCount: number; backgroundTolerance: number; localContrastThreshold: number; brightnessThreshold: number; minComponentArea: number; simplifyTolerance: number; smoothing: number; paddingPct: number };

const DEFAULT_PARAMS: ReconstructionParams = { colorCount: 2, backgroundTolerance: 34, localContrastThreshold: 10, brightnessThreshold: 168, minComponentArea: 8, simplifyTolerance: 1.3, smoothing: 0, paddingPct: 0.04 };

function boxStyle(box: NormalizedBox) {
  return { left: `${box.left / 10}%`, top: `${box.top / 10}%`, width: `${(box.right - box.left) / 10}%`, height: `${(box.bottom - box.top) / 10}%` };
}

function statusTone(status: string) {
  if (status === "clear") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
  if (status.startsWith("blocked_")) return "border-red-500/30 bg-red-500/10 text-red-100";
  return "border-amber-500/30 bg-amber-500/10 text-amber-100";
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="block text-xs text-white/60"><span className="flex justify-between"><span>{label}</span><strong className="text-white/80">{value}</strong></span><input className="mt-2 w-full" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))}/></label>;
}

function LogoToolInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const playerId = search.get("playerId");
  const studioId = search.get("studioId");
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [useDescriptor, setUseDescriptor] = useState(true);
  const [sourceKind, setSourceKind] = useState<SourceKind>("own_mockup");
  const [sourceNote, setSourceNote] = useState("");
  const [ownershipAttested, setOwnershipAttested] = useState(false);
  const [selectionBox, setSelectionBox] = useState<NormalizedBox | null>(null);
  const [selectionIsManual, setSelectionIsManual] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [params, setParams] = useState<ReconstructionParams>(DEFAULT_PARAMS);
  const [overlay, setOverlay] = useState(50);
  const [result, setResult] = useState<ResolveResult | null>(null);

  if (!authLoading && !user) { router.replace("/login"); return null; }
  if (!playerId && !studioId) return <div className="mx-auto max-w-2xl px-6 py-16 text-white/70">Falta indicar el Player o Estudio en la URL.</div>;

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const rect = imageFrameRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.round(Math.max(0, Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000))),
      y: Math.round(Math.max(0, Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000))),
    };
  };
  const startSelection = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(event); if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point); setSelectionIsManual(true); setSelectionBox({ left: point.x, right: point.x, top: point.y, bottom: point.y }); setAnalysis(null); setResult(null);
  };
  const moveSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return; const point = pointFromEvent(event); if (!point) return;
    setSelectionBox({ left: Math.min(dragStart.x, point.x), right: Math.max(dragStart.x, point.x), top: Math.min(dragStart.y, point.y), bottom: Math.max(dragStart.y, point.y) });
  };
  const endSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragStart(null);
    setSelectionBox((current) => current && current.right - current.left >= 18 && current.bottom - current.top >= 18 ? current : null);
  };

  const uploadReference = async (file: File) => {
    setUploading(true); setError(null);
    try {
      const form = new FormData(); if (playerId) form.set("playerId", playerId); if (studioId) form.set("studioId", studioId); form.append("images", file);
      const payload = await readApiJson<{ urls: string[] }>(await authenticatedFetch("/api/vip-profile/reference-images", { method: "POST", body: form }));
      setReferenceImageUrls(payload.urls); setAnalysis(null); setResult(null); setSelectionBox(null); setSelectionIsManual(false); setOwnershipAttested(false); setMessage("Imagen subida. Marcá solamente el logo que querés reconstruir.");
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen."); }
    finally { setUploading(false); }
  };

  const analyze = async () => {
    setAnalyzing(true); setError(null);
    try {
      const payload = await readApiJson<{ result: AnalyzeResult; manualSelection?: boolean }>(await authenticatedFetch("/api/logo/analyze", { method: "POST", body: JSON.stringify({ playerId: playerId || undefined, studioId: studioId || undefined, referenceImageUrls, manualBox: selectionIsManual ? selectionBox : undefined }) }));
      setAnalysis(payload.result); setDisplayName(payload.result.naming.displayName); setDescriptor(payload.result.naming.descriptor ?? ""); setUseDescriptor(Boolean(payload.result.naming.descriptor)); setSelectionBox(payload.result.detectedLogo.primaryBox); setSelectionIsManual(Boolean(payload.manualSelection)); setParams((current) => ({ ...current, colorCount: payload.result.detectedLogo.decomposition?.recommendedColorCount ?? current.colorCount })); setResult(null); setMessage("Análisis listo. Revisá texto, componentes y elegí qué querés hacer.");
    } catch (analyzeError) { setError(analyzeError instanceof Error ? analyzeError.message : "No se pudo analizar."); }
    finally { setAnalyzing(false); }
  };

  const processIdentity = async (forceRedesign: boolean) => {
    if (!analysis) return;
    if (!forceRedesign && sourceKind === "reference_only") { setError("Una referencia ajena no puede reconstruirse como tu logo. Elegí Crear una identidad original."); return; }
    if (!forceRedesign && !ownershipAttested) { setError("Confirmá que el logo pertenece a tu proyecto o que tenés autorización."); return; }
    if (forceRedesign && !window.confirm("CLOUVA creará una identidad nueva inspirada en la dirección visual. No copiará el logo de la referencia. ¿Continuar?")) return;
    setProcessing(true); setError(null); setMessage(null);
    try {
      const naming: BrandNaming = { entityName: analysis.naming.entityName, displayName: displayName.trim() || analysis.naming.entityName, descriptor: useDescriptor ? descriptor.trim() || null : null, source: "user_confirmed" };
      const payload = await readApiJson<{ result: ResolveResult }>(await authenticatedFetch("/api/logo/jobs", { method: "POST", body: JSON.stringify({
        playerId: playerId || undefined, studioId: studioId || undefined, referenceImageUrls,
        source: referenceImageUrls.length ? "website_mockup" : "standalone", forceRedesign, referenceFidelity: "high",
        detectedLogo: analysis.detectedLogo, naming, extractionMethod: selectionIsManual ? "manual_crop" : "confirmed_detected_crop",
        ownershipAttested: !forceRedesign && ownershipAttested, sourceKind, sourceNote, reconstructionParams: params,
      }) }));
      setResult(payload.result); setMessage(payload.result.mode === "owned_identity_reconstruction" ? "SVG reconstruido. Comparalo con la referencia antes de aprobar." : "Identidad original creada y convertida a SVG.");
    } catch (processError) { setError(processError instanceof Error ? processError.message : "No se pudo procesar la identidad."); }
    finally { setProcessing(false); }
  };

  const approve = async () => {
    if (!result) return; setApproving(true); setError(null);
    try { await readApiJson(await authenticatedFetch(`/api/logo/jobs/${result.brandAssetVersionId}/approve`, { method: "POST" })); setMessage("Identidad publicada como oficial."); }
    catch (approveError) { setError(approveError instanceof Error ? approveError.message : "No se pudo publicar."); }
    finally { setApproving(false); }
  };
  const discard = async () => {
    if (!result || !window.confirm("Descartar esta versión sin borrar su auditoría?")) return; setDiscarding(true);
    try { await readApiJson(await authenticatedFetch(`/api/logo/jobs/${result.brandAssetVersionId}/discard`, { method: "POST" })); setResult(null); setMessage("Versión descartada."); }
    catch (discardError) { setError(discardError instanceof Error ? discardError.message : "No se pudo descartar."); }
    finally { setDiscarding(false); }
  };

  const validationReady = Boolean(result?.validation && result.validation.rasterSimilarity >= 0.68 && result.validation.smallSizeLegible && result.urls?.master_svg_url);
  const canPublish = result?.clearance?.status === "clear" && (result.mode !== "owned_identity_reconstruction" || validationReady);
  const components = analysis?.detectedLogo.decomposition?.components.filter((component) => component.present) ?? [];

  return <div className="mx-auto max-w-6xl px-5 py-12 text-white">
    <h1 className="text-3xl font-black">CLOUVA Logo Engine</h1>
    <p className="mt-2 max-w-3xl text-sm text-white/60">El mockup sirve para entender el logo. El resultado oficial siempre es un SVG limpio; nunca una captura recortada.</p>
    {error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">{error}</div> : null}
    {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">{message}</div> : null}

    <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="font-semibold">1. Subí el mockup o logo</h2>
      <input className="mt-3 text-sm text-white/70" disabled={uploading} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); }}/>
      {referenceImageUrls[0] ? <>
        <p className="mt-4 text-sm text-white/65">Arrastrá un rectángulo ajustado alrededor de la identidad completa.</p>
        <div ref={imageFrameRef} className="relative mt-2 max-h-[70vh] cursor-crosshair touch-none overflow-hidden rounded-xl border border-white/15 bg-black/40" onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={endSelection} onPointerCancel={endSelection}>
          <img className="block max-h-[70vh] w-full select-none object-contain" src={referenceImageUrls[0]} alt="Mockup" draggable={false}/>
          {selectionBox ? <div className={`pointer-events-none absolute border-2 ${selectionIsManual ? "border-cyan-300 bg-cyan-300/10" : "border-amber-300 bg-amber-300/10"}`} style={boxStyle(selectionBox)}/> : null}
        </div>
        <button className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40" disabled={analyzing || !referenceImageUrls.length} onClick={() => void analyze()}>{analyzing ? "Analizando..." : selectionIsManual ? "Analizar área marcada" : "Detectar logo"}</button>
      </> : null}
    </section>

    {analysis ? <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="font-semibold">2. Identidad entendida por CLOUVA</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm text-white/60">Texto principal<input className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white" value={displayName} onChange={(event) => setDisplayName(event.target.value)}/></label>
        <label className="text-sm text-white/60">Descriptor<input className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white disabled:opacity-40" disabled={!useDescriptor} value={descriptor} onChange={(event) => setDescriptor(event.target.value)}/></label>
      </div>
      <label className="mt-3 flex gap-2 text-sm text-white/60"><input type="checkbox" checked={useDescriptor} onChange={(event) => setUseDescriptor(event.target.checked)}/>Usar descriptor</label>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{components.map((component) => <div key={component.kind} className="rounded-xl border border-white/10 bg-black/25 p-3"><strong className="text-sm capitalize">{component.kind}</strong><p className="mt-1 text-xs text-white/55">{component.expectedText || component.description || "Detectado"}</p><p className="mt-2 text-[11px] text-white/35">Confianza {Math.round(component.confidence * 100)}%</p></div>)}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="rounded-xl border border-white/10 p-4 text-sm"><input className="mr-2" type="radio" name="source" checked={sourceKind !== "reference_only"} onChange={() => setSourceKind("own_mockup")}/><strong>Sí, este logo pertenece a mi proyecto</strong><span className="mt-1 block text-white/50">Reconstruirlo limpio y fiel como SVG.</span></label>
        <label className="rounded-xl border border-white/10 p-4 text-sm"><input className="mr-2" type="radio" name="source" checked={sourceKind === "reference_only"} onChange={() => { setSourceKind("reference_only"); setOwnershipAttested(false); }}/><strong>No, es solamente una referencia</strong><span className="mt-1 block text-white/50">Crear una identidad distinta y original.</span></label>
      </div>
      {sourceKind !== "reference_only" ? <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100"><input className="mt-1" type="checkbox" checked={ownershipAttested} onChange={(event) => setOwnershipAttested(event.target.checked)}/><span>Declaro que esta identidad pertenece a mi proyecto o que tengo autorización para reconstruirla y utilizarla.</span></label> : null}
      <textarea className="mt-4 w-full rounded-xl border border-white/10 bg-black/25 p-3 text-sm" placeholder="Nota opcional sobre procedencia o diseñador" value={sourceNote} onChange={(event) => setSourceNote(event.target.value)}/>

      {sourceKind !== "reference_only" ? <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4"><h3 className="text-sm font-semibold">Limpieza vectorial</h3><div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Slider label="Cantidad de colores" value={params.colorCount} min={1} max={4} step={1} onChange={(value) => setParams({ ...params, colorCount: value })}/>
        <Slider label="Separación del fondo" value={params.backgroundTolerance} min={8} max={120} step={1} onChange={(value) => setParams({ ...params, backgroundTolerance: value })}/>
        <Slider label="Contraste local" value={params.localContrastThreshold} min={2} max={80} step={1} onChange={(value) => setParams({ ...params, localContrastThreshold: value })}/>
        <Slider label="Brillo del trazo" value={params.brightnessThreshold} min={80} max={245} step={1} onChange={(value) => setParams({ ...params, brightnessThreshold: value })}/>
        <Slider label="Eliminar manchas" value={params.minComponentArea} min={2} max={200} step={1} onChange={(value) => setParams({ ...params, minComponentArea: value })}/>
        <Slider label="Simplificar nodos" value={params.simplifyTolerance} min={0.1} max={8} step={0.1} onChange={(value) => setParams({ ...params, simplifyTolerance: value })}/>
        <Slider label="Suavizado" value={params.smoothing} min={0} max={1} step={0.05} onChange={(value) => setParams({ ...params, smoothing: value })}/>
        <Slider label="Margen del recorte" value={params.paddingPct} min={0} max={0.2} step={0.01} onChange={(value) => setParams({ ...params, paddingPct: value })}/>
      </div></div> : null}
      <div className="mt-5 flex flex-wrap gap-3">
        {sourceKind !== "reference_only" ? <button disabled={processing || !ownershipAttested} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold disabled:opacity-35" onClick={() => void processIdentity(false)}>{processing ? "Reconstruyendo..." : result?.mode === "owned_identity_reconstruction" ? "Volver a reconstruir SVG" : "Reconstruir mi logo en SVG"}</button> : null}
        <button disabled={processing} className="rounded-xl border border-cyan-400/30 px-5 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40" onClick={() => void processIdentity(true)}>{processing ? "Procesando..." : "Crear una identidad original"}</button>
      </div>
    </section> : null}

    {result?.urls ? <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">3. Resultado profesional</h2><p className="mt-1 text-sm text-white/50">{result.mode === "owned_identity_reconstruction" ? "Reconstrucción vectorial de tu logo" : "Nueva identidad vectorial"}</p></div><div className="flex gap-2"><button className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-100" disabled={discarding} onClick={() => void discard()}>{discarding ? "Descartando..." : "Descartar"}</button><button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold disabled:opacity-35" disabled={!canPublish || approving} onClick={() => void approve()}>{approving ? "Publicando..." : "Publicar como oficial"}</button></div></div>
      {result.sourceReferenceUrl && result.reconstructionPreviewUrl ? <>
        <div className="mt-5 grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-xs uppercase tracking-wide text-white/40">Referencia</p><div className="aspect-video overflow-hidden rounded-xl border border-white/10 bg-black/40"><img className="h-full w-full object-contain" src={result.sourceReferenceUrl} alt="Referencia recortada"/></div></div><div><p className="mb-2 text-xs uppercase tracking-wide text-white/40">SVG reconstruido</p><div className="aspect-video overflow-hidden rounded-xl border border-white/10 bg-black/40"><img className="h-full w-full object-contain" src={result.reconstructionPreviewUrl} alt="Reconstrucción vectorial"/></div></div></div>
        <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-white/50"><span>Superposición para comparar</span><span>{overlay}% SVG</span></div><input className="w-full" type="range" min={0} max={100} value={overlay} onChange={(event) => setOverlay(Number(event.target.value))}/><div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-white/10 bg-black/50"><img className="absolute inset-0 h-full w-full object-contain" src={result.sourceReferenceUrl} alt="Referencia"/><img className="absolute inset-0 h-full w-full object-contain" style={{ opacity: overlay / 100 }} src={result.reconstructionPreviewUrl} alt="SVG superpuesto"/></div></div>
      </> : null}
      {result.validation ? <div className="mt-5 grid gap-3 md:grid-cols-4"><div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-white/40">Fidelidad de contorno</span><strong className="mt-1 block text-xl">{Math.round(result.validation.rasterSimilarity * 100)}%</strong></div><div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-white/40">Tamaño pequeño</span><strong className="mt-1 block">{result.validation.smallSizeLegible ? "Aprobado" : "Revisar"}</strong></div><div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-white/40">Transparencia</span><strong className="mt-1 block">{result.validation.transparentBackground ? "Aprobada" : "Revisar"}</strong></div><div className="rounded-xl border border-white/10 p-3"><span className="text-xs text-white/40">Contornos</span><strong className="mt-1 block">{result.validation.nodeCount}</strong></div></div> : null}
      {result.validation?.warnings.length ? <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-100">{result.validation.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div> : null}
      {result.clearance ? <div className={`mt-4 rounded-xl border p-4 text-sm ${statusTone(result.clearance.status)}`}><strong>Originalidad: {result.clearance.status}</strong>{result.clearance.decisionReasons.map((reason) => <p className="mt-1" key={reason}>{reason}</p>)}</div> : null}

      <h3 className="mt-6 font-semibold">Brand Kit</h3><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[
        [result.urls.master_svg_url, "SVG maestro"], [result.urls.symbol_svg_url, "SVG símbolo"], [result.urls.horizontal_svg_url, "SVG horizontal"], [result.urls.vertical_svg_url, "SVG vertical"], [result.urls.white_svg_url, "SVG blanco"], [result.urls.black_svg_url, "SVG negro"], [result.urls.print_pdf_url, "PDF impresión"], [result.urls.brand_config_url, "Brand config"], [result.urls.transparent_logo_url, "PNG transparente"], [result.urls.favicon_url, "Favicon"],
      ].map(([url, label]) => url ? <a key={label} className="rounded-xl border border-white/10 bg-black/25 p-3 text-center text-xs text-white/70 hover:border-violet-400/50" href={url} target="_blank" rel="noreferrer">{label}</a> : null)}</div>
      {!canPublish ? <p className="mt-4 text-xs text-white/45">La publicación se habilita cuando la reconstrucción y el clearance estén aprobados.</p> : null}
      {result.costUsd > 0 ? <p className="mt-3 text-xs text-white/40">Costo de generación visual: US${result.costUsd.toFixed(4)}</p> : <p className="mt-3 text-xs text-white/40">Reconstrucción SVG: sin generación visual de Gemini.</p>}
    </section> : null}
  </div>;
}

export default function LogoToolPage() {
  return <Suspense fallback={<div className="mx-auto max-w-2xl px-6 py-16 text-white/60">Cargando Logo Engine...</div>}><LogoToolInner/></Suspense>;
}
