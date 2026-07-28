"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import styles from "./avatar-analyzer-residual-metrics.module.css";

const ACTIVE_JOB_KEY = "clouva.avatarAnalyzer.activeJob.v1";
const POLL_INTERVAL_MS = 2500;

type JsonRecord = Record<string, unknown>;
type LoadState = "idle" | "waiting" | "loading" | "ready" | "error";

type ResidualMetrics = {
  runId: string;
  lowConfidenceCount: number;
  projectionMismatchCount: number;
  noVisualEvidenceCount: number;
  insufficientViewsCount: number;
  topologyInvalidCount: number;
  manualReviewRequiredCount: number;
  leftFingerRigMode: string;
  rightFingerRigMode: string;
  leftVerifiedBranches: number;
  rightVerifiedBranches: number;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function numberOf(record: JsonRecord | null, key: string, fallback = 0) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textOf(record: JsonRecord | null, key: string, fallback: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const FINGER_MODE_LABELS: Record<string, string> = {
  full: "Completo",
  partial: "Parcial",
  simplified: "Simplificado",
  unsupported: "No compatible",
};

function labelMode(value: string) {
  return FINGER_MODE_LABELS[value] || value.replace(/_/g, " ");
}

export function AvatarAnalyzerResidualMetrics() {
  const { session, loading: authLoading } = useAuth();
  const [state, setState] = useState<LoadState>("idle");
  const [metrics, setMetrics] = useState<ResidualMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedRunRef = useRef("");

  const loadLatest = useCallback(async (force = false) => {
    const accessToken = session?.access_token;
    if (!accessToken) return;

    if (window.localStorage.getItem(ACTIVE_JOB_KEY)) {
      setState("waiting");
      return;
    }

    try {
      setState((current) => current === "ready" && !force ? current : "loading");
      const headers = { Authorization: `Bearer ${accessToken}` };
      const latestResponse = await fetch("/api/avatar/analyze/latest", { headers, cache: "no-store" });
      const latest = await latestResponse.json().catch(() => null) as JsonRecord | null;
      if (!latestResponse.ok) throw new Error(String(latest?.error || "No se pudo consultar el último análisis."));
      const runId = typeof latest?.runId === "string" ? latest.runId : "";
      if (!runId) {
        setState("idle");
        setMetrics(null);
        return;
      }
      if (!force && loadedRunRef.current === runId) {
        setState("ready");
        return;
      }

      const resultResponse = await fetch(`/api/avatar/analyze/result/${runId}`, { headers, cache: "no-store" });
      const result = await resultResponse.json().catch(() => null) as JsonRecord | null;
      if (!resultResponse.ok) throw new Error(String(result?.error || "No se pudo recuperar el diagnóstico residual."));
      const analysis = asRecord(result?.analysis);
      const rawMetrics = asRecord(analysis?.metrics);
      const topology = asRecord(analysis?.topology_capabilities) || asRecord(analysis?.topologyCapabilities);

      loadedRunRef.current = runId;
      setMetrics({
        runId,
        lowConfidenceCount: numberOf(rawMetrics, "lowConfidenceCount"),
        projectionMismatchCount: numberOf(rawMetrics, "projectionMismatchCount", numberOf(rawMetrics, "technicalMismatchCount")),
        noVisualEvidenceCount: numberOf(rawMetrics, "noVisualEvidenceCount"),
        insufficientViewsCount: numberOf(rawMetrics, "insufficientViewsCount"),
        topologyInvalidCount: numberOf(rawMetrics, "topologyInvalidCount"),
        manualReviewRequiredCount: numberOf(rawMetrics, "manualReviewRequiredCount"),
        leftFingerRigMode: textOf(topology, "left_finger_rig_mode", "unsupported"),
        rightFingerRigMode: textOf(topology, "right_finger_rig_mode", "unsupported"),
        leftVerifiedBranches: numberOf(topology, "left_verified_finger_branch_count", numberOf(topology, "left_detected_finger_branches")),
        rightVerifiedBranches: numberOf(topology, "right_verified_finger_branch_count", numberOf(topology, "right_detected_finger_branches")),
      });
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el diagnóstico residual.");
      setState("error");
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (authLoading || !session?.access_token) return;
    void loadLatest();
    const timer = window.setInterval(() => {
      const active = window.localStorage.getItem(ACTIVE_JOB_KEY);
      if (active) {
        setState("waiting");
        return;
      }
      void loadLatest();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [authLoading, loadLatest, session?.access_token]);

  if (authLoading || !session?.access_token) return null;

  return (
    <section className={styles.card} aria-label="Métricas residuales del Avatar Analyzer">
      <header className={styles.header}>
        <div>
          <small>VALIDACIÓN V4.1 · MÉTRICAS CANÓNICAS</small>
          <h2>Diagnóstico separado</h2>
          <p>Confianza baja y contradicción técnica se contabilizan como estados distintos.</p>
        </div>
        <button type="button" onClick={() => void loadLatest(true)} disabled={state === "loading" || state === "waiting"}>
          {state === "loading" || state === "waiting" ? <Loader2 className={styles.spin} /> : <RefreshCw />}
          Actualizar
        </button>
      </header>

      {state === "waiting" ? (
        <p className={styles.notice}><Loader2 className={styles.spin} /> Esperando que termine el análisis activo…</p>
      ) : null}

      {state === "error" ? (
        <p className={styles.error}><AlertTriangle /> {error}</p>
      ) : null}

      {state === "idle" && !metrics ? (
        <p className={styles.notice}>Todavía no existe un análisis V4.1 guardado para este avatar.</p>
      ) : null}

      {metrics ? (
        <>
          <div className={styles.metricGrid}>
            <article><span>Confianza baja</span><strong>{metrics.lowConfidenceCount}</strong><small>Desacuerdo o evidencia insuficiente</small></article>
            <article><span>Proyección incompatible</span><strong>{metrics.projectionMismatchCount}</strong><small>Contradicción objetiva de cámara, región o geometría</small></article>
            <article><span>Vistas insuficientes</span><strong>{metrics.insufficientViewsCount}</strong><small>Existe evidencia, pero no alcanza el mínimo</small></article>
            <article><span>Sin evidencia visual</span><strong>{metrics.noVisualEvidenceCount}</strong><small>Ninguna vista válida para ese punto</small></article>
            <article><span>Topología inválida</span><strong>{metrics.topologyInvalidCount}</strong><small>La geometría no soporta la cadena solicitada</small></article>
            <article><span>Revisión manual</span><strong>{metrics.manualReviewRequiredCount}</strong><small>No encaja en un rechazo técnico automático</small></article>
          </div>

          <div className={styles.handGrid}>
            <article>
              <span>Mano izquierda</span>
              <strong>{labelMode(metrics.leftFingerRigMode)}</strong>
              <small>{metrics.leftVerifiedBranches} ramas geométricas verificadas</small>
            </article>
            <article>
              <span>Mano derecha</span>
              <strong>{labelMode(metrics.rightFingerRigMode)}</strong>
              <small>{metrics.rightVerifiedBranches} ramas geométricas verificadas</small>
            </article>
          </div>

          <p className={styles.run}><CheckCircle2 /> Run {metrics.runId}</p>
        </>
      ) : null}
    </section>
  );
}
