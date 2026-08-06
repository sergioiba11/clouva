"use client";

import { Suspense, useRef, useState, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type NormalizedBox = { top: number; left: number; bottom: number; right: number };

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

type ResolveResult = {
  jobId: string;
  brandAssetId: string;
  brandAssetVersionId: string;
  status: "awaiting_review" | "reused_official";
  urls: CandidateUrls | null;
  costUsd: number;
};

const VARIANT_LABELS: Array<[keyof CandidateUrls, string]> = [
  ["primary_logo_url", "Principal"],
  ["symbol_logo_url", "Símbolo"],
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
    setMessage("Área manual marcada. Ajustala arrastrando y después tocá ‘Analizar área marcada’. ");
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
      setMessage("Referencia subida. Podés analizar automáticamente o marcar con el mouse el logo exacto.");
      setAnalysis(null);
      setResult(null);
      setSelectionBox(null);
      setSelectionIsManual(false);
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
      setMessage(payload.manualSelection ? "Área marcada analizada. Revisá que detecte el símbolo real antes de generar." : "Análisis automático listo. El rectángulo muestra exactamente qué zona tomó como logo.");
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "No se pudo analizar la referencia.");
    } finally {
      setAnalyzing(false);
    }
  };

  const hasStandaloneSymbol = analysis?.detectedLogo.logoType === "symbol" || analysis?.detectedLogo.logoType === "monogram" || analysis?.detectedLogo.logoType === "emblem";
  const hasSymbolInLockup = Boolean(analysis?.detectedLogo.lockupStructure?.symbolPosition && analysis.detectedLogo.lockupStructure.symbolPosition !== "none");
  const canGenerateFromReference = referenceImageUrls.length === 0 || Boolean(analysis?.detectedLogo.primaryBox && (hasStandaloneSymbol || hasSymbolInLockup));

  const confirmAndGenerate = async (forceRedesign: boolean) => {
    if (!analysis) return;
    if (!forceRedesign && !canGenerateFromReference) {
      setError("El análisis no encontró un símbolo real. Marcá con el mouse el logo de montañas, analizá esa zona y recién después generá.");
      return;
    }
    if (forceRedesign) {
      const confirmed = window.confirm(
        "Rediseñar identidad crea un símbolo completamente NUEVO, distinto del oficial actual.\n¿Confirmás que querés rediseñar en vez de tomar el símbolo del mockup como referencia?",
      );
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
        }),
      });
      const payload = await readApiJson<{ result: ResolveResult }>(response);
      setResult(payload.result);
      setMessage(payload.result.status === "reused_official" ? "Ya tenías un logo oficial -- se adaptó al detectado, no se rediseñó." : "Logo generado. Revisalo antes de aprobarlo.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "No se pudo generar el logo.");
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
      setMessage("Logo aprobado y publicado como identidad oficial.");
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "No se pudo aprobar el logo.");
    } finally {
      setApproving(false);
    }
  };

  const discard = async () => {
    if (!result) return;
    const confirmed = window.confirm("Descartar este candidato -- queda archivado, nunca se publica, no se borra el registro.");
    if (!confirmed) return;
    setDiscarding(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/logo/jobs/${result.brandAssetVersionId}/discard`, { method: "POST" });
      await readApiJson(response);
      setMessage("Candidato descartado.");
      setResult(null);
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : "No se pudo descartar.");
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 text-white">
      <h1 className="text-2xl font-bold">Generador de Logo</h1>
      <p className="mt-2 text-sm text-white/60">Marcá el logo real del mockup; CLOUVA no genera hasta comprobar que el recorte contiene un símbolo.</p>

      {error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/50">1. Referencia</p>
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
            <p className="mb-2 text-sm text-white/60"><strong className="text-white">Arrastrá un rectángulo</strong> alrededor del logo o isotipo real. Para El Iglú, marcá el conjunto de montañas + IGLÚ RECORDS de la pared o del monitor.</p>
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
                  <span className={`absolute -top-7 left-0 rounded px-2 py-1 text-xs font-semibold text-black ${selectionIsManual ? "bg-cyan-300" : "bg-amber-300"}`}>
                    {selectionIsManual ? "Área elegida" : "Área detectada"}
                  </span>
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-white/45">El rectángulo debe contener solamente la marca. No incluyas el hero, botones, párrafos ni media página.</p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={analyzing || uploading || referenceImageUrls.length === 0} onClick={() => void analyze()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
            {analyzing ? "Analizando..." : selectionIsManual ? "Analizar área marcada" : "Detectar logo automáticamente"}
          </button>
          {selectionIsManual ? (
            <button
              disabled={analyzing}
              onClick={() => {
                setSelectionBox(null);
                setSelectionIsManual(false);
                setAnalysis(null);
                setMessage("Selección manual eliminada. Podés volver a detectar automáticamente.");
              }}
              className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/75"
            >
              Borrar selección
            </button>
          ) : null}
        </div>
      </div>

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/50">2. Identidad detectada</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/70">
            <div><dt className="text-white/40">Nombre interno</dt><dd>{analysis.naming.entityName}</dd></div>
            <div><dt className="text-white/40">Tipo</dt><dd>{analysis.detectedLogo.logoType ?? "sin clasificar"}</dd></div>
            <div><dt className="text-white/40">Estructura</dt><dd>{analysis.detectedLogo.lockupStructure ? `${analysis.detectedLogo.lockupStructure.symbolPosition} / ${analysis.detectedLogo.lockupStructure.orientation}` : "sin referencia"}</dd></div>
            <div><dt className="text-white/40">Confianza</dt><dd>{Math.round(analysis.detectedLogo.confidence * 100)}%</dd></div>
          </dl>

          {!canGenerateFromReference ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              Este análisis no encontró un símbolo real: detectó <strong>{analysis.detectedLogo.logoType ?? "nada"}</strong> con posición <strong>{analysis.detectedLogo.lockupStructure?.symbolPosition ?? "none"}</strong>. No se permite generar ni gastar. Volvé arriba y marcá las montañas/isotipo exacto.
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">Símbolo real detectado. La generación está habilitada.</div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-white/60">
              Texto principal del logo
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white" />
            </label>
            <label className="text-sm text-white/60">
              Descriptor
              <input value={descriptor} onChange={(e) => setDescriptor(e.target.value)} disabled={!useDescriptor} className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white disabled:opacity-40" />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-white/60">
            <input type="checkbox" checked={useDescriptor} onChange={(e) => setUseDescriptor(e.target.checked)} /> Usar descriptor
          </label>
          <label className="mt-3 block text-sm text-white/60">
            Fidelidad a la referencia
            <select value={fidelity} onChange={(e) => setFidelity(e.target.value as typeof fidelity)} className="mt-1 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white">
              <option value="high">Alta</option>
              <option value="balanced">Media</option>
              <option value="creative">Creativa</option>
            </select>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={generating || !canGenerateFromReference} onClick={() => void confirmAndGenerate(false)} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35">
              {generating ? "Generando..." : "Confirmar análisis y generar"}
            </button>
            <button disabled={generating} onClick={() => void confirmAndGenerate(true)} className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/80 disabled:opacity-60">
              Crear símbolo nuevo sin copiar el del mockup
            </button>
          </div>
        </div>
      ) : null}

      {result?.urls ? (
        <div className="mt-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">{result.status === "reused_official" ? "Logo oficial adaptado" : "Candidato generado"}</h2>
            {result.status === "awaiting_review" ? (
              <div className="flex gap-2">
                <button disabled={discarding} onClick={() => void discard()} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-200 disabled:opacity-60">{discarding ? "Descartando..." : "Descartar candidato"}</button>
                <button disabled={approving} onClick={() => void approve()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-60">{approving ? "Aprobando..." : "Aprobar y publicar como identidad oficial"}</button>
              </div>
            ) : (
              <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60">Ya es la identidad oficial</span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4">
            {VARIANT_LABELS.map(([key, label]) => (
              <div key={key} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <img src={result.urls![key]} alt={label} className="aspect-square w-full rounded-lg object-contain" />
                <p className="mt-2 text-center text-xs text-white/60">{label}</p>
              </div>
            ))}
          </div>
          {result.costUsd > 0 ? <p className="mt-3 text-xs text-white/40">Costo de esta generación: ${result.costUsd.toFixed(4)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export default function LogoToolPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl px-6 py-16 text-white/60">Cargando...</div>}>
      <LogoToolInner />
    </Suspense>
  );
}
