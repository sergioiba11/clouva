"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

// Herramienta independiente "Generador de Logo" -- mismo motor
// (lib/server/brand-engine) que usa la generación automática de páginas.
//
// V2 (Fase 6): el flujo ahora tiene un paso de análisis separado del de
// generación -- primero se analiza la referencia (barato, sin gastar una
// generación real) y se muestra la identidad detectada (nombre/descriptor/
// estructura), editable, ANTES de confirmar y generar. Nunca se genera
// automáticamente sin dejar corregir "IGLÚ RECORDS".
//
// Simplificación deliberada de esta tanda: el dueño (Player o Estudio) se
// identifica por query param (?playerId= o ?studioId=) en vez de un
// selector propio.

type DetectedLogo = {
  detected: boolean;
  confidence: number;
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

function LogoToolInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const playerId = search.get("playerId");
  const studioId = search.get("studioId");

  const fileInputRef = useRef<HTMLInputElement>(null);
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

  if (!authLoading && !user) {
    router.replace("/login");
    return null;
  }
  if (!playerId && !studioId) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-white/70">Falta indicar el Player o Estudio (?playerId= o ?studioId= en la URL).</div>;
  }

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
      setMessage("Referencia subida. Ahora analizá para ver qué identidad detectamos.");
      setAnalysis(null);
      setResult(null);
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
        body: JSON.stringify({ playerId: playerId || undefined, studioId: studioId || undefined, referenceImageUrls }),
      });
      const payload = await readApiJson<{ result: AnalyzeResult }>(response);
      setAnalysis(payload.result);
      setDisplayName(payload.result.naming.displayName);
      setDescriptor(payload.result.naming.descriptor ?? "");
      setUseDescriptor(Boolean(payload.result.naming.descriptor));
      setResult(null);
      setMessage("Análisis listo -- revisá y corregí antes de generar.");
    } catch (analyzeError) {
      setError(analyzeError instanceof Error ? analyzeError.message : "No se pudo analizar la referencia.");
    } finally {
      setAnalyzing(false);
    }
  };

  const confirmAndGenerate = async (forceRedesign: boolean) => {
    if (!analysis) return;
    if (forceRedesign) {
      const confirmed = window.confirm(
        "Rediseñar identidad crea un símbolo completamente NUEVO, distinto del oficial actual.\n¿Confirmás que querés rediseñar en vez de solo adaptar el logo existente?",
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
      setMessage(
        payload.result.status === "reused_official"
          ? "Ya tenías un logo oficial -- se adaptó al detectado, no se rediseñó."
          : "Logo generado. Revisalo antes de aprobarlo.",
      );
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
    <div className="mx-auto max-w-4xl px-6 py-16 text-white">
      <h1 className="text-2xl font-bold">Generador de Logo</h1>
      <p className="mt-2 text-sm text-white/60">
        Motor compartido con la web automática -- fiel a la composición/estructura/texto real del logo de tu referencia, con un símbolo original.
      </p>

      {error ? <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {message ? <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div> : null}

      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/50">1. Referencia (opcional)</p>
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
          <img src={referenceImageUrls[0]} alt="Referencia subida" className="mt-4 h-32 w-32 rounded-xl border border-white/10 object-cover" />
        ) : null}

        <div className="mt-4">
          <button disabled={analyzing || uploading} onClick={() => void analyze()} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
            {analyzing ? "Analizando..." : "Analizar"}
          </button>
        </div>
      </div>

      {analysis ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/50">2. Detectamos esta identidad -- revisá y corregí</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/70">
            <div><dt className="text-white/40">Nombre interno</dt><dd>{analysis.naming.entityName}</dd></div>
            <div><dt className="text-white/40">Tipo</dt><dd>{analysis.detectedLogo.logoType ?? "símbolo original"}</dd></div>
            <div><dt className="text-white/40">Estructura</dt><dd>{analysis.detectedLogo.lockupStructure ? `${analysis.detectedLogo.lockupStructure.symbolPosition} / ${analysis.detectedLogo.lockupStructure.orientation}` : "sin referencia"}</dd></div>
            <div><dt className="text-white/40">Confianza</dt><dd>{Math.round(analysis.detectedLogo.confidence * 100)}%</dd></div>
          </dl>

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
              <option value="high">Alta (respeta estructura/paleta/complejidad)</option>
              <option value="balanced">Media</option>
              <option value="creative">Creativa (solo inspiración de mood)</option>
            </select>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={generating} onClick={() => void confirmAndGenerate(false)} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
              {generating ? "Generando..." : "Confirmar análisis y generar"}
            </button>
            <button disabled={generating} onClick={() => void confirmAndGenerate(true)} className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white/80 disabled:opacity-60">
              Rediseñar identidad (crea un símbolo nuevo)
            </button>
          </div>
        </div>
      ) : null}

      {result?.urls ? (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {result.status === "reused_official" ? "Logo oficial adaptado" : "Candidato generado"}
            </h2>
            {result.status === "awaiting_review" ? (
              <div className="flex gap-2">
                <button disabled={discarding} onClick={() => void discard()} className="rounded-xl border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-200 disabled:opacity-60">
                  {discarding ? "Descartando..." : "Descartar candidato"}
                </button>
                <button disabled={approving} onClick={() => void approve()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-60">
                  {approving ? "Aprobando..." : "Aprobar y publicar como identidad oficial"}
                </button>
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
