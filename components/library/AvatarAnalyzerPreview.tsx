"use client";

import { BrainCircuit, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { createElement, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import styles from "./avatar-analyzer-preview.module.css";

type AnalysisSummary = {
  status: string;
  runId: string;
  humanoidConfidence: number;
  bodyAnalysis?: string;
  faceAnalysis: string;
  leftHandAnalysis: string;
  rightHandAnalysis: string;
  landmarkCount: number;
  verifiedSurfaceLandmarkCount?: number;
  internalJointCount?: number;
  rejectedLandmarkCount?: number;
  rawLandmarkCount?: number;
  hiddenLandmarkCount?: number;
  warningCount: number;
  rigModified: boolean;
};

function decodeSummary(value: string | null): AnalysisSummary | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded)) as AnalysisSummary;
  } catch {
    return null;
  }
}

function statusLabel(value: string) {
  if (value === "valid") return "válido";
  if (value === "valid_with_warnings") return "válido con advertencias";
  if (value === "needs_review") return "necesita revisión";
  if (value === "invalid") return "inválido";
  return value || "sin datos";
}

export function AvatarAnalyzerPreview() {
  const { user, session, loading: authLoading } = useAuth();
  const [analyzing, setAnalyzing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const analyze = async () => {
    if (!session?.access_token) return;
    setAnalyzing(true);
    setError(null);
    setSummary(null);
    try {
      const response = await fetch("/api/avatar/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `No se pudo analizar el avatar (${response.status}).`);
      }
      const blob = await response.blob();
      if (blob.size < 1024) throw new Error("El diagnóstico llegó vacío.");
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setSummary(decodeSummary(response.headers.get("x-clouva-analysis-summary")));
    } catch (cause) {
      console.error("Avatar Analyzer UI failed", cause);
      setError(cause instanceof Error ? cause.message : "No se pudo analizar el avatar.");
    } finally {
      setAnalyzing(false);
    }
  };

  if (authLoading || !user) return null;

  const verified = summary?.verifiedSurfaceLandmarkCount ?? summary?.landmarkCount ?? 0;

  return (
    <section className={styles.card} aria-label="Avatar Analyzer CLOUVA">
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.icon}><BrainCircuit /></span>
        <div>
          <small>BLENDER WORKER · DIAGNÓSTICO</small>
          <h2>Avatar Analyzer</h2>
          <p>Segmenta la anatomía, triangula rostro y manos y valida cada cadena antes del rig.</p>
        </div>
      </header>

      {previewUrl ? (
        <div className={styles.viewer}>
          {createElement("model-viewer", {
            className: styles.model,
            src: previewUrl,
            alt: "Avatar CLOUVA con landmarks anatómicos verificados",
            "auto-rotate": true,
            "rotation-per-second": "12deg",
            "camera-controls": true,
            "shadow-intensity": "1",
            exposure: "1",
          })}
          <span className={styles.viewerBadge}>SUPERFICIE ANATÓMICA VERIFICADA</span>
        </div>
      ) : (
        <div className={styles.empty}>
          <BrainCircuit />
          <strong>Diagnóstico visual todavía no ejecutado</strong>
          <span>El avatar original se analiza en una escena limpia. El rig oficial no se modifica.</span>
        </div>
      )}

      {summary ? (
        <>
          <div className={styles.summary}>
            <div><span>Resultado</span><strong>{statusLabel(summary.status)}</strong></div>
            <div><span>Compatibilidad corporal humanoide</span><strong>{Math.round(summary.humanoidConfidence * 100)}%</strong></div>
            <div><span>Superficie verificada</span><strong>{verified}</strong></div>
            <div><span>Articulaciones internas</span><strong>{summary.internalJointCount ?? 0}</strong></div>
            <div><span>Candidatos rechazados</span><strong>{summary.rejectedLandmarkCount ?? 0}</strong></div>
            <div><span>Cuerpo</span><strong>{statusLabel(summary.bodyAnalysis || "unknown")}</strong></div>
            <div><span>Rostro</span><strong>{statusLabel(summary.faceAnalysis)}</strong></div>
            <div><span>Mano izquierda</span><strong>{statusLabel(summary.leftHandAnalysis)}</strong></div>
            <div><span>Mano derecha</span><strong>{statusLabel(summary.rightHandAnalysis)}</strong></div>
          </div>
          {summary.status === "needs_review" || summary.status === "invalid" ? (
            <p className={styles.error}>
              <TriangleAlert /> Análisis anatómico pendiente de revisión. Todavía no se utilizará para crear el rig.
            </p>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className={styles.action}
        onClick={() => void analyze()}
        disabled={analyzing || !session?.access_token}
      >
        {analyzing ? <Loader2 className={styles.spin} /> : previewUrl ? <RotateCcw /> : <BrainCircuit />}
        {analyzing ? "SEGMENTANDO Y TRIANGULANDO ANATOMÍA…" : previewUrl ? "VOLVER A ANALIZAR" : "ANALIZAR AVATAR"}
      </button>

      {analyzing ? (
        <div className={styles.processing}>
          <span />
          <p>Blender separa regiones anatómicas, aísla cabeza y manos y triangula cada punto con varias cámaras.</p>
        </div>
      ) : null}

      {error ? <p className={styles.error}><TriangleAlert /> {error}</p> : null}
    </section>
  );
}
