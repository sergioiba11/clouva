import { ChevronLeft, ChevronRight, Crosshair, ExternalLink, Save } from "lucide-react";
import {
  confidenceOf,
  failureStageLabel,
  getInternalPosition,
  getLandmarkType,
  getSurfacePosition,
  numberLabel,
  percent,
  readableName,
  stateLabel,
  vectorLabel,
} from "./view-model";
import type { LandmarkRecord } from "./types";
import styles from "./avatar-analyzer-wizard.module.css";

export function LandmarkInspector({
  name,
  record,
  onPrev,
  onNext,
  onCenter,
  onStartCorrection,
  evidenceUrl,
}: {
  name: string | null;
  record?: LandmarkRecord;
  onPrev?: () => void;
  onNext?: () => void;
  onCenter?: () => void;
  onStartCorrection?: () => void;
  evidenceUrl?: string | null;
}) {
  if (!name || !record) {
    return (
      <aside className={styles.inspector}>
        <p className={styles.muted}>Tocá un punto del holograma para inspeccionar su evidencia.</p>
      </aside>
    );
  }

  const isInternal = getLandmarkType(record) === "internal_joint";
  const surface = getSurfacePosition(record);
  const internal = getInternalPosition(record);
  const blocking = record.blocking ?? !record.accepted;

  return (
    <aside className={styles.inspector}>
      <div className={styles.inspectorHeader}>
        <div>
          <span className={styles.kicker}>LANDMARK</span>
          <h3>{readableName(name)}</h3>
          <code>{name}</code>
        </div>
        <span className={`${styles.statePill} ${blocking ? styles.pillBlocked : styles.pillOk}`}>
          {stateLabel(record)}
        </span>
      </div>

      <div className={styles.inspectorControls}>
        <button type="button" onClick={onPrev} disabled={!onPrev}><ChevronLeft /> Anterior</button>
        <button type="button" onClick={onNext} disabled={!onNext}><ChevronRight /> Siguiente</button>
        <button type="button" onClick={onCenter} disabled={!onCenter}><Crosshair /> Centrar punto</button>
      </div>

      <dl className={styles.inspectorGrid}>
        <div><dt>Región</dt><dd>{readableName(record.region || "unknown")}</dd></div>
        <div><dt>Tipo</dt><dd>{isInternal ? "Articulación interna" : "Punto de superficie"}</dd></div>
        <div><dt>Aceptado</dt><dd>{record.accepted ? "Sí" : "No"}</dd></div>
        <div><dt>Bloqueante</dt><dd>{blocking ? "Sí" : "No"}</dd></div>
        <div><dt>Confianza</dt><dd>{percent(confidenceOf(record))}</dd></div>
        <div><dt>Vistas confirmadas</dt><dd>{record.requiresVisualViews === false ? "No requiere" : (record.viewsConfirmed ?? 0)}</dd></div>
        <div><dt>Inliers</dt><dd>{record.triangulationInliers ?? 0}</dd></div>
        <div><dt>Ray residual</dt><dd>{numberLabel(record.rayResidual)}</dd></div>
        <div><dt>Depth residual</dt><dd>{numberLabel(record.depthResidual)}</dd></div>
        <div><dt>Método</dt><dd>{record.method || "—"}</dd></div>
        <div><dt>Etapa fallida</dt><dd>{failureStageLabel(record.failureStage)}</dd></div>
        <div><dt>Motivos de rechazo</dt><dd>{(record.rejectionReasons || []).map(readableName).join(", ") || "—"}</dd></div>
        <div><dt>Posición superficial</dt><dd>{vectorLabel(surface)}</dd></div>
        <div><dt>Posición interna</dt><dd>{vectorLabel(internal)}</dd></div>
      </dl>

      <div className={styles.inspectorActions}>
        <button type="button" onClick={onStartCorrection} disabled={!onStartCorrection}>
          <Save /> Corregir {isInternal ? "articulación interna" : "punto superficial"}
        </button>
        {evidenceUrl ? (
          <a href={evidenceUrl} target="_blank" rel="noreferrer"><ExternalLink /> Ver evidencia</a>
        ) : null}
      </div>
    </aside>
  );
}
