"use client";

import { BrainCircuit, Hand, Loader2, RotateCcw, TriangleAlert, XCircle } from "lucide-react";
import Link from "next/link";
import {
  assetStateLabel,
  detailStateLabel,
  jobPhaseLabel,
  processStateLabel,
  useAvatarAnalyzer,
  workerStateLabel,
} from "./avatar-analyzer/useAvatarAnalyzer";
import { WizardStepper } from "./avatar-analyzer/WizardStepper";
import styles from "./avatar-analyzer-preview.module.css";

/**
 * Laboratorio holográfico del Avatar Analyzer V4.1: este componente es solo
 * el contenedor (auth, arranque/cancelación del job real, mensajes de
 * transporte). Toda la inspección visual vive en ./avatar-analyzer/
 * (useAvatarAnalyzer = estado real del pipeline, WizardStepper = las etapas
 * Avatar asignado -> Cuerpo -> Manos -> Cara -> Big Data -> Revisión ->
 * Confirmación). Usa el análisis ya persistido -- no dispara un análisis
 * nuevo automáticamente.
 */
export function AvatarAnalyzerPreview() {
  const analyzer = useAvatarAnalyzer();
  const { user, authLoading, session, analyzing } = analyzer;

  if (authLoading) return null;
  if (!user) {
    return (
      <section id="avatar-analyzer" className={styles.card} aria-label="Avatar Analyzer CLOUVA">
        <header className={styles.header}>
          <span className={styles.icon}><BrainCircuit /></span>
          <div>
            <small>BLENDER WORKER · AVATAR ANALYZER V4.1</small>
            <h2>Avatar Analyzer V4.1</h2>
            <p>Iniciá sesión para analizar el avatar activo y conservar su último diagnóstico.</p>
          </div>
        </header>
        <Link className={styles.action} href="/login?next=/avatar-analyzer-v4">
          INICIAR SESIÓN
        </Link>
      </section>
    );
  }

  const effectiveSummary = analyzer.effectiveSummary;

  return (
    <section id="avatar-analyzer" className={styles.card} aria-label="Avatar Analyzer CLOUVA">
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.icon}><BrainCircuit /></span>
        <div>
          <small>BLENDER WORKER · AVATAR ANALYZER V4.1</small>
          <h2>Avatar Analyzer V4.1</h2>
          <p>Laboratorio holográfico: usa el análisis ya persistido para inspeccionar cuerpo, manos y cara con evidencia real antes de avanzar hacia Unreal.</p>
        </div>
      </header>

      {analyzer.analysisProcessState !== "idle" || effectiveSummary ? (
        <section className={styles.systemHealth} aria-label="Salud del sistema del Analyzer">
          <div><span>Worker</span><strong>{workerStateLabel(analyzer.analysisProcessState)}</strong></div>
          <div><span>Proceso</span><strong>{processStateLabel(analyzer.analysisProcessState)}</strong></div>
          {analyzing && jobPhaseLabel(analyzer.jobPhase) ? (
            <div><span>Fase</span><strong>{jobPhaseLabel(analyzer.jobPhase)}</strong></div>
          ) : null}
          <div><span>Resultado persistido</span><strong>{effectiveSummary ? "Sí" : analyzer.analysisProcessState === "running" ? "En proceso" : "No"}</strong></div>
          <div><span>Detalle</span><strong>{detailStateLabel(analyzer.detailState)}</strong></div>
          <div><span>GLB diagnóstico</span><strong>{assetStateLabel(analyzer.assetState)}</strong></div>
          <div><span>Reintentos</span><strong>{analyzer.detailRetryCount}</strong></div>
        </section>
      ) : null}

      {analyzer.detailState === "temporarily_unavailable" ? (
        <div className={styles.detailNotice}>
          <div><strong>DETALLE TEMPORALMENTE NO DISPONIBLE</strong><span>El resultado anatómico y el GLB se conservan. No hace falta volver a ejecutar Blender.</span></div>
          <button type="button" onClick={analyzer.retryDetail}>REINTENTAR CARGA DEL DETALLE</button>
        </div>
      ) : null}

      {effectiveSummary ? (
        <WizardStepper analyzer={analyzer} />
      ) : (
        <div className={styles.empty}>
          <BrainCircuit />
          <strong>Diagnóstico visual todavía no ejecutado</strong>
          <span>El GLB original se analiza en una escena limpia y temporal. El rig oficial no se modifica.</span>
        </div>
      )}

      <button
        type="button"
        className={styles.action}
        onClick={() => void analyzer.analyze()}
        disabled={analyzing || !session?.access_token}
      >
        {analyzing ? <Loader2 className={styles.spin} /> : effectiveSummary ? <RotateCcw /> : <BrainCircuit />}
        {analyzing
          ? (jobPhaseLabel(analyzer.jobPhase) ?? "ANALIZANDO ORIENTACIÓN, BVH, TOPOLOGÍA Y COBERTURA…").toUpperCase()
          : effectiveSummary ? "VOLVER A ANALIZAR" : "ANALIZAR AVATAR"}
      </button>

      {analyzing ? (
        <button
          type="button"
          className={styles.cancelAction}
          onClick={analyzer.cancelAnalysis}
          disabled={analyzer.cancelling}
        >
          {analyzer.cancelling ? <Loader2 className={styles.spin} /> : <XCircle />}
          {analyzer.cancelling ? "CANCELANDO…" : "CANCELAR ANÁLISIS"}
        </button>
      ) : null}

      <div className={styles.secondaryActions}>
        <button
          type="button"
          onClick={() => void analyzer.restoreLatest()}
          disabled={analyzer.restoringLatest || analyzing || !session?.access_token}
        >
          {analyzer.restoringLatest ? <Loader2 className={styles.spin} /> : <RotateCcw />}
          {analyzer.restoringLatest ? "ABRIENDO ÚLTIMO ANÁLISIS…" : "ABRIR ÚLTIMO ANÁLISIS"}
        </button>
        {effectiveSummary
          && !(effectiveSummary.requestedProfileReady ?? effectiveSummary.rigReadinessApproved)
          && (effectiveSummary.supportedRigProfiles || []).includes("BODY_HANDS_BASIC")
          && effectiveSummary.requestedRigProfile !== "BODY_HANDS_BASIC" ? (
            <button
              type="button"
              onClick={() => void analyzer.analyze("BODY_HANDS_BASIC")}
              disabled={analyzing || !session?.access_token}
            >
              <Hand /> CONTINUAR CON CUERPO + MANOS SIMPLIFICADAS
            </button>
          ) : null}
      </div>

      {analyzing ? (
        <div className={styles.processing}>
          <span />
          <p>Blender analiza una copia canónica, crea dos pasadas regionales y no genera el rig hasta aprobar el mapa anatómico.</p>
        </div>
      ) : null}

      {analyzer.persistenceNotice ? (
        <p className={styles.notice}><Loader2 className={analyzer.loadingDetail ? styles.spin : undefined} /> {analyzer.persistenceNotice}</p>
      ) : null}
      {analyzer.transportError ? <p className={styles.transportError}><TriangleAlert /> {analyzer.transportError}</p> : null}
      {analyzer.workerErrorMessage ? <p className={styles.error}><TriangleAlert /> {analyzer.workerErrorMessage}</p> : null}
    </section>
  );
}
