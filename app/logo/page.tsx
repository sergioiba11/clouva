"use client";

import { Suspense, useRef, useState, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type NormalizedBox = { top: number; left: number; bottom: number; right: number };
type SourceKind = "own_logo_file" | "own_mockup" | "designer_delivery" | "reference_only";

type DetectedLogo = {
  detected: boolean;
  confidence: number;
  primaryBox: NormalizedBox | null;
  occurrences: Array<{ box: NormalizedBox; role: string; confidence: number }>;
  logoType: string | null;
  visibleText: { primaryName: string | null; descriptor: string | null; otherText: string[] };
  lockupStructure: { symbolPosition: string; namePosition: string; descriptorPosition: string; orientation: string; letterSpacing: string } | null;
  visualSignature: unknown;
};

type BrandNaming = { entityName: string; displayName: string; descriptor: string | null; source: string };
type TypographyConfig = Record<string, unknown>;
type AnalyzeResult = { detectedLogo: DetectedLogo; naming: BrandNaming; suggestedTypography: TypographyConfig };

type CandidateUrls = {
  primary_logo_url: string;
  symbol_logo_url: string;
  horizontal_logo_url: string;
  vertical_logo_url: string;
  square_logo_url: string;
  transparent_logo_url: string;
  white_logo_url: string;
  black_logo_url: string;
  favicon_url: string;
};

type Clearance = {
  status: string;
  internal: { status: string; highestSimilarity: number; matches: Array<{ versionId: string; similarity: number; reason: string }> };
  external: { checked: boolean; status: string; sourcesChecked: string[]; matches: Array<{ source: string; name: string | null; similarity: number }> };
  decisionReasons: string[];
};

type ResolveResult = {
  jobId: string;
  brandAssetId: string;
  brandAssetVersionId: string;
  status: "awaiting_review" | "reused_official";
  mode: "real_identity_import" | "clouva_generated_redesign" | "standalone_creation";
  urls: CandidateUrls | null;
  originalAssetUrl: string | null;
  cleanedAssetUrl: string | null;
  standaloneSymbolAvailable: boolean;
  clearance: Clearance | null;
  costUsd: number;
};

const VARIANT_LABELS: Array<[keyof CandidateUrls, string]> = [
  ["primary_logo_url", "Principal"],
  ["symbol_logo_url", "Símbolo / fallback"],
  ["horizontal_logo_url", "Horizontal"],
  ["vertical_logo_url", "Vertical"],
  ["square_logo_url", "Cuadrado"],
  ["transparent_logo_url", "Transparente"],
  ["white_logo_url", "Blanco"],
  ["black_logo_url", "Negro"],
  ["favicon_url", "Favicon"],
];

function boxStyle(box: NormalizedBox) {
  return {
    left: `${box.left / 10}%`,
    top: `${box.top / 10}%`,
    width: `${(box.right - box.left) / 10}%`,
    height: `${(box.bottom - box.top) / 10}%`,
  };
}

function clearanceTone(status: string) {
  if (status === "clear") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status.startsWith("blocked_")) return "border-red-500/30 bg-red-500/10 text-red-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-100";
}

function LogoToolInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const playerId = search.get("playerId");
  const studioId = search.get("studioId");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageFrameRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [useDescriptor, setUseDescriptor] = useState(true);
  const [fidelity, setFidelity] = useState<"creative" | "balanced" | "high">("high");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [selectionBox, setSelectionBox] = useState<NormalizedBox | null>(null);
  const [selectionIsManual, setSelectionIsManual] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>("own_mockup");
  const [sourceNote, setSourceNote] = useState("");
  const [ownershipAttested, setOwnershipAttested] = useState(false);

  if (!authLoading && !user) {
    router.replace("/login");
    return null;
  }
  if (!playerId && !studioId) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-white/70">Falta indicar el Player o Estudio (?playerId= o ?studioId= en la URL).</div>;
  }

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const rect = imageFrameRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000));
    const y = Math.max(0, Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000));
    return { x: Math.round(x), y: Math.round(y) };
  };

  const startSelection = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setSelectionBox({ left: point.x, right: point.x, top: point.y, bottom: point.y });
    setSelectionIsManual(true);
    setAnalysis(null);
    setResult(null);
    setMessage("Área manual marcada. Ajustala y después tocá ‘Analizar área marcada’. ");
  };

  const moveSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setSelectionBox({
      left: Math.min(dragStart.x, point.x),
      right: Math.max(dragStart.x, point.x),
      top: Math.min(dragStart.y, point.y),
      bottom: Math.max(dragStart.y, point.y),
    });
  };

  const endSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragStart(null);
    setSelectionBox((current) => {
      if (!current || current.right - current.left < 18 || current.bottom - current.top < 18) {
        setSelectionIsManual(false);
        return null;
      }
      return current;
    });
  };

  const uploadReference = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      if (playerId) form.set("playerId", playerId);
      if (studioId) form.set("studioId", studioId);
      form.append("images", file);
      const response = await authenticatedFetch("/api/vip-profile/reference-images", { method: "POST", body: form });
      const payload = await readApiJson<{ urls: string[] }>(response);
      setReferenceImageUrls(payload.urls);
      setMessage("Referencia subida. Marcá exactamente la identidad que querés importar.");
      setAnalysis(null);
      setResult(null);
      setSelectionBox(null);
      setSelectionIsManual(false);
      setOwnershipAttested(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen.");
    } finally {
      setUploading(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/logo/analyze", {
        method: "POST",
        body: JSON.stringify({
          playerId: playerId || undefined,
          studioId: studioId || undefined,
          referenceImageUrls,
          manualBox: selectionIsManual ? selectionBox : undefined,
        }),
      });
      const payload = await readApiJson<{ result: AnalyzeResult; manualSelection?: boolean }>(response);
      setAnalysis(payload.result);
      setDisplayName(payload.result.naming.displayName);
      setDescriptor(payload.result.naming.descriptor ?? "");
      setUseDescriptor(Boolean(payload.result.naming.descriptor));
      setResult(null);
      setSelectionBox(payload.result.detectedLogo.primaryBox);
      setSelectionIsManual(Boolean(payload.manualSelection));
      setMessage(payload.manualSelection ? "Área marcada analizada. CLOUVA importará exactamente ese recorte." : "Análisis automático listo. El rectángulo muestra exactamente qué zona se importará.");
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "No se pudo analizar la referencia.");
    } finally {
      setAnalyzing(false);
    }
  };

  const canImport = Boolean(referenceImageUrls.length > 0 && analysis?.detectedLogo.detected && analysis.detectedLogo.primaryBox && sourceKind !== "reference_only" && ownershipAttested);

  const processIdentity = async (forceRedesign: boolean) => {
    if (!analysis) return;
    if (!forceRedesign && !canImport) {
      setError(sourceKind === "reference_only" ? "Una referencia ajena solo puede usarse para rediseñar una identidad nueva." : "Marcá el logo exacto y confirmá la declaración de titularidad antes de importarlo.");
      return;
    }
    if (forceRedesign) {
      const confirmed = window.confirm("CLOUVA creará una identidad NUEVA inspirada en la referencia. No conservará exactamente el símbolo actual. ¿Continuar?");
      if (!confirmed) return;
    }

    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const editedNaming: BrandNaming = {
        entityName: analysis.naming.entityName,
        displayName: displayName.trim() || analysis.naming.entityName,
        descriptor: useDescriptor ? (descriptor.trim() || null) : null,
        source: displayName.trim() !== analysis.naming.displayName || (useDescriptor ? descriptor.trim() : null) !== analysis.naming.descriptor ? "user_confirmed" : analysis.naming.source,
      };
      const response = await authenticatedFetch("/api/logo/jobs", {
        method: "POST",
        body: JSON.stringify({
          playerId: playerId || undefined,
          studioId: studioId || undefined,
          referenceImageUrls,
          source: referenceImageUrls.length > 0 ? "website_mockup" : "standalone",
          forceRedesign,
          referenceFidelity: fidelity,
          detectedLogo: analysis.detectedLogo,
          naming: editedNaming,
          extractionMethod: selectionIsManual ? "manual_crop" : "confirmed_detected_crop",
          ownershipAttested,
          sourceKind,
          sourceNote,
        }),
      });
      const payload = await readApiJson<{ result: ResolveResult }>(response);
      setResult(payload.result);
      setMessage(payload.result.status === "reused_official"
        ? "Ya existe una identidad oficial y fue reutilizada."
        : payload.result.mode === "real_identity_import"
          ? "Identidad real importada sin rediseño ni generación visual de Gemini."
          : "Nueva identidad generada. Revisá el clearance antes de publicarla.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "No se pudo procesar la identidad.");
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!result) return;
    setApproving(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/logo/jobs/${result.brandAssetVersionId}/approve`, { method: "POST" });
      await readApiJson(response);
      setMessage("Identidad aprobada y publicada como oficial.");
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "No se pudo aprobar la identidad.");
    } finally {
      setApproving(false);
    }
  };

  const discard = async () => {
    if (!result) return;
    const confirmed = window.confirm("Descartar esta identidad. Queda archivada para auditoría y nunca se publica.");
    if (!confirmed) return;
    setDiscarding(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/logo/jobs/${result.brandAssetVersionId}/discard`, { method: "POST" });
      await readApiJson(response);
      setMessage("Identidad descartada.");
      setResult(null);
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "No se pudo descartar.");
    } finally {
      setDiscarding(false);
    }
  };

  const canPublish = result?.clearance?.status === "clear";

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 text-white">
      <h1 className="text-2xl font-bold">CLOUVA Logo Engine</h1>
      <p className="mt-2 text-sm text-white/60">Importá una identidad real sin cambiarla o elegí explícitamente crear un rediseño nuevo.</p>

      {error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/50">1. Referencia e identidad real</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="mt-3 text-sm text-white/70"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadReference(file);
          }}
        />

        {referenceImageUrls.length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-sm text-white/60"><strong className="text-white">Arrastrá un rectángulo</strong> alrededor del logo completo que querés conservar.</p>
            <div
              ref={imageFrameRef}
              className="relative max-h-[70vh] w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-white/15 bg-black/40"
              onPointerDown={startSelection}
              onPointerMove={moveSelection}
              onPointerUp={endSelection}
              onPointerCancel={endSelection}
            >
              <img src={referenceImageUrls[0]} alt="Referencia subida" draggable={false} className="block max-h-[70vh] w-full select-none object-contain" />
              {selectionBox ? (
                <div className={`pointer-events-none absolute border-2 ${selectionIsManual ? "border-cyan-300 bg-cyan-300/10" : "border-amber-300 bg-amber-300/10"}`} style={boxStyle(selectionBox)}>
                  <span className={`absolute -top-7 left-0 rounded px-2 py-1 text-xs font-semibold text-black ${selectionIsManual ? "bg-cyan-300" : "bg-amber-300"}`}>{selectionIsManual ? "Área elegida" : "Área detectada"}</span>
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-white/45">El rectángulo debe contener únicamente la identidad. CLOUVA conservará esos píxeles.</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={analyzing || uploading || referenceImageUrls.length === 0} onClick={() => void analyze()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
            {analyzing ? "Analizando..." : selectionIsManual ? "Analizar área marcada" : "Detectar identidad automáticamente"}
          </button>
          {selectionIsManual ? (
            <button disabled={analyzing} onClick={() => { setSelectionBox(null); setSelectionIsManual(false); setAnalysis(null); setMessage("Selección eliminada."); }} className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/75">Borrar selección</button>
          ) : null}
        </div>
      </div>

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/50">2. Confirmación</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/70">
            <div><dt className="text-white/40">Nombre interno</dt><dd>{analysis.naming.entityName}</dd></div>
            <div><dt className="text-white/40">Tipo detectado</dt><dd>{analysis.detectedLogo.logoType ?? "sin clasificar"}</dd></div>
            <div><dt className="text-white/40">Estructura</dt><dd>{analysis.detectedLogo.lockupStructure ? `${analysis.detectedLogo.lockupStructure.symbolPosition} / ${analysis.detectedLogo.lockupStructure.orientation}` : "sin referencia"}</dd></div>
            <div><dt className="text-white/40">Confianza</dt><dd>{Math.round(analysis.detectedLogo.confidence * 100)}%</dd></div>
          </dl>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-white/60">Texto principal<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white" /></label>
            <label className="text-sm text-white/60">Descriptor<input value={descriptor} onChange={(event) => setDescriptor(event.target.value)} disabled={!useDescriptor} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white disabled:opacity-40" /></label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-white/60"><input type="checkbox" checked={useDescriptor} onChange={(event) => setUseDescriptor(event.target.checked)} /> Usar descriptor</label>

          <div className="mt-5 grid gap-4 rounded-xl border border-white/10 bg-black/20 p-4 sm:grid-cols-2">
            <label className="text-sm text-white/60">Procedencia
              <select value={sourceKind} onChange={(event) => { setSourceKind(event.target.value as SourceKind); setOwnershipAttested(false); }} className="mt-1 w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white">
                <option value="own_mockup">Mockup propio</option>
                <option value="own_logo_file">Archivo de logo propio</option>
                <option value="designer_delivery">Entregado por diseñador autorizado</option>
                <option value="reference_only">Solo referencia / no me pertenece</option>
              </select>
            </label>
            <label className="text-sm text-white/60">Nota opcional<input value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-white/15 bg-black/50 px-3 py-2 text-white" placeholder="Diseñador, entrega, procedencia…" /></label>
          </div>

          {sourceKind !== "reference_only" ? (
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4 text-sm text-white/75">
              <input type="checkbox" checked={ownershipAttested} onChange={(event) => setOwnershipAttested(event.target.checked)} className="mt-1" />
              <span>Declaro que esta identidad pertenece a mi proyecto, que tengo autorización para utilizarla o que poseo los derechos necesarios.</span>
            </label>
          ) : (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Esta imagen se usará únicamente como inspiración. No puede importarse exactamente como identidad propia.</div>
          )}

          <div className="mt-5 rounded-xl border border-white/10 p-4">
            <h3 className="font-semibold">Importar identidad real</h3>
            <p className="mt-1 text-sm text-white/55">Conserva exactamente el recorte. Solo limpia el fondo, adapta tamaños y valida exclusividad. No genera imágenes con Gemini ni reemplaza la tipografía.</p>
            <button disabled={generating || !canImport} onClick={() => void processIdentity(false)} className="mt-3 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35">{generating ? "Procesando..." : "Importar y preparar identidad real"}</button>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 p-4">
            <h3 className="font-semibold">Rediseñar identidad</h3>
            <p className="mt-1 text-sm text-white/55">Crea un símbolo nuevo inspirado en la referencia. Este es el único flujo que llama al generador visual.</p>
            <label className="mt-3 block text-sm text-white/60">Fidelidad creativa
              <select value={fidelity} onChange={(event) => setFidelity(event.target.value as typeof fidelity)} className="mt-1 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white"><option value="high">Alta</option><option value="balanced">Media</option><option value="creative">Creativa</option></select>
            </label>
            <button disabled={generating} onClick={() => void processIdentity(true)} className="mt-3 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/80 disabled:opacity-60">{generating ? "Procesando..." : "Rediseñar identidad"}</button>
          </div>
        </div>
      ) : null}

      {result?.urls ? (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><h2 className="text-lg font-semibold">{result.mode === "real_identity_import" ? "Identidad real importada" : "Identidad nueva generada"}</h2><p className="text-xs text-white/45">Modo: {result.mode}</p></div>
            {result.status === "awaiting_review" ? (
              <div className="flex gap-2">
                <button disabled={discarding} onClick={() => void discard()} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-200 disabled:opacity-60">{discarding ? "Descartando..." : "Descartar"}</button>
                <button disabled={approving || !canPublish} onClick={() => void approve()} title={!canPublish ? "El clearance debe estar en estado clear" : undefined} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35">{approving ? "Publicando..." : "Publicar como identidad oficial"}</button>
              </div>
            ) : <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">Identidad oficial reutilizada</span>}
          </div>

          {result.mode === "real_identity_import" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {result.originalAssetUrl ? <div className="rounded-xl border border-white/10 p-3"><p className="mb-2 text-xs text-white/50">Activo original</p><img src={result.originalAssetUrl} alt="Activo original importado" className="max-h-64 w-full object-contain" /></div> : null}
              {result.cleanedAssetUrl ? <div className="rounded-xl border border-white/10 p-3"><p className="mb-2 text-xs text-white/50">Activo limpio</p><img src={result.cleanedAssetUrl} alt="Activo limpio" className="max-h-64 w-full object-contain" /></div> : null}
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {VARIANT_LABELS.map(([key, label]) => (
              <div key={key} className="rounded-xl border border-white/10 bg-black/30 p-3"><img src={result.urls![key]} alt={label} className="aspect-square w-full rounded-lg object-contain" /><p className="mt-2 text-center text-xs text-white/60">{label}</p></div>
            ))}
          </div>

          {result.clearance ? (
            <div className={`mt-5 rounded-xl border p-4 text-sm ${clearanceTone(result.clearance.status)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><strong>Clearance: {result.clearance.status}</strong><span>Interno: {result.clearance.internal.status}</span></div>
              <ul className="mt-2 list-disc space-y-1 pl-5">{result.clearance.decisionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <p className="mt-3 text-xs opacity-80">Fuentes externas consultadas: {result.clearance.external.sourcesChecked.length ? result.clearance.external.sourcesChecked.join(", ") : "ninguna configurada"}.</p>
              {!canPublish ? <p className="mt-2 font-semibold">No puede publicarse automáticamente hasta que el clearance quede en clear.</p> : null}
            </div>
          ) : null}

          <p className="mt-3 text-xs text-white/40">Costo visual: ${result.costUsd.toFixed(4)} · Símbolo separado real: {result.standaloneSymbolAvailable ? "sí" : "no, se usa el lockup completo con contain"}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function LogoToolPage() {
  return <Suspense fallback={<div className="mx-auto max-w-2xl px-6 py-16 text-white/60">Cargando...</div>}><LogoToolInner /></Suspense>;
}
