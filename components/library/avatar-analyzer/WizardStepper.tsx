"use client";

import {
  CheckCircle2,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Tags,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AssignedAvatarCard } from "./AssignedAvatarCard";
import { AvatarAnalyzerViewer } from "./AvatarAnalyzerViewer";
import { LandmarkInspector } from "./LandmarkInspector";
import { RegionStats } from "./RegionStats";
import type { LandmarkRecord, StageKey } from "./types";
import { processStateLabel, type UseAvatarAnalyzer } from "./useAvatarAnalyzer";
import {
  confidenceOf,
  getHumanRecommendedAction,
  getLandmarkPosition,
  getLandmarkType,
  getLandmarkVisualState,
  getRegionStats,
  landmarkGroup,
  percent,
  readableName,
  stateLabel,
  type BoundingBox,
} from "./view-model";
import styles from "./avatar-analyzer-wizard.module.css";

type WizardStage = "avatar" | "cuerpo" | "manos" | "cara" | "bigdata" | "revision" | "confirmacion";

const WIZARD_STAGES: { key: WizardStage; label: string }[] = [
  { key: "avatar", label: "Avatar asignado" },
  { key: "cuerpo", label: "Cuerpo" },
  { key: "manos", label: "Manos" },
  { key: "cara", label: "Cara" },
  { key: "bigdata", label: "Big Data" },
  { key: "revision", label: "Revisión 360°" },
  { key: "confirmacion", label: "Confirmación" },
];

type LandmarkFilter = "todos" | "superficie" | "articulaciones" | "verificados" | "pendientes" | "bloqueantes";

const FILTERS: { key: LandmarkFilter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "superficie", label: "Superficie" },
  { key: "articulaciones", label: "Articulaciones" },
  { key: "verificados", label: "Verificados" },
  { key: "pendientes", label: "Pendientes" },
  { key: "bloqueantes", label: "Bloqueantes" },
];

function matchesFilter(record: LandmarkRecord, filter: LandmarkFilter): boolean {
  if (filter === "todos") return true;
  if (filter === "superficie") return getLandmarkType(record) === "surface";
  if (filter === "articulaciones") return getLandmarkType(record) === "internal_joint";
  const state = getLandmarkVisualState(record);
  if (filter === "verificados") return state === "verified_surface" || state === "internal_joint";
  if (filter === "pendientes") return state === "needs_review";
  if (filter === "bloqueantes") return state === "blocked";
  return true;
}

function pointBox(point: number[], margin = 0.14): BoundingBox {
  return {
    min: point.map((value) => value - margin),
    max: point.map((value) => value + margin),
  };
}

export function WizardStepper({ analyzer }: { analyzer: UseAvatarAnalyzer }) {
  const [stage, setStage] = useState<WizardStage>("avatar");
  const [handSide, setHandSide] = useState<StageKey>("mano izquierda");
  const [filter, setFilter] = useState<LandmarkFilter>("todos");
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  const regionStats = useMemo(() => getRegionStats(analyzer.landmarks), [analyzer.landmarks]);

  const stageKey: StageKey | "todos" = stage === "cuerpo"
    ? "cuerpo"
    : stage === "manos"
      ? handSide
      : stage === "cara"
        ? "rostro"
        : "todos";

  const regionEntries = useMemo(
    () => Object.entries(analyzer.landmarks)
      .filter(([name]) => stageKey === "todos" || landmarkGroup(name) === stageKey)
      .filter(([, record]) => matchesFilter(record, filter)),
    [analyzer.landmarks, stageKey, filter],
  );

  const selectedInRegion = analyzer.selectedName
    && regionEntries.some(([name]) => name === analyzer.selectedName);
  const focusOverride = selectedInRegion && analyzer.selectedRecord
    ? (() => {
      const position = getLandmarkPosition(analyzer.selectedRecord);
      return position ? pointBox(position) : null;
    })()
    : null;

  const selectAndFocus = (name: string) => {
    analyzer.selectLandmark(name);
    setFocusToken((value) => value + 1);
  };

  const stepNext = () => {
    if (!analyzer.selectedName || !regionEntries.length) return;
    const index = regionEntries.findIndex(([name]) => name === analyzer.selectedName);
    const next = regionEntries[(index + 1 + regionEntries.length) % regionEntries.length];
    if (next) selectAndFocus(next[0]);
  };
  const stepPrev = () => {
    if (!analyzer.selectedName || !regionEntries.length) return;
    const index = regionEntries.findIndex(([name]) => name === analyzer.selectedName);
    const prev = regionEntries[(index - 1 + regionEntries.length) % regionEntries.length];
    if (prev) selectAndFocus(prev[0]);
  };

  const bodyRequiredReady = regionStats.cuerpo.total > 0 && regionStats.cuerpo.blocking === 0;
  const handsEvaluated = (regionStats["mano izquierda"].total + regionStats["mano derecha"].total) > 0;
  const faceEvaluated = regionStats.rostro.total > 0;
  const jobCompleted = analyzer.analysisProcessState === "ready" && Boolean(analyzer.detail);
  const noCriticalErrors = regionStats.cuerpo.blocking === 0;
  const readyToConfirm = jobCompleted && bodyRequiredReady && noCriticalErrors;
  const canAdvance = readyToConfirm && analyzer.manuallyApproved;

  const stageDone: Record<WizardStage, boolean> = {
    avatar: Boolean(analyzer.assignedAvatar),
    cuerpo: regionStats.cuerpo.total > 0,
    manos: handsEvaluated,
    cara: faceEvaluated,
    bigdata: Boolean(analyzer.detail),
    revision: Boolean(analyzer.detail),
    confirmacion: analyzer.manuallyApproved,
  };

  const renderRegionStage = (label: string) => (
    <div className={styles.stageBody}>
      <div className={styles.stageMain}>
        <div className={styles.viewerToggles}>
          <button type="button" aria-pressed={showLandmarks} onClick={() => setShowLandmarks((v) => !v)}>
            {showLandmarks ? <EyeOff /> : <Eye />} {showLandmarks ? "Ocultar puntos" : "Mostrar puntos"}
          </button>
          <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels((v) => !v)}>
            <Tags /> Mostrar etiquetas
          </button>
          <button type="button" aria-pressed={showSkeleton} onClick={() => setShowSkeleton((v) => !v)}>
            Mostrar esqueleto interno
          </button>
          <button type="button" aria-pressed={showWireframe} onClick={() => setShowWireframe((v) => !v)}>
            Wireframe
          </button>
          {stage === "manos" ? (
            <>
              <button type="button" aria-pressed={handSide === "mano izquierda"} onClick={() => setHandSide("mano izquierda")}>
                Mano izquierda
              </button>
              <button type="button" aria-pressed={handSide === "mano derecha"} onClick={() => setHandSide("mano derecha")}>
                Mano derecha
              </button>
            </>
          ) : null}
        </div>
        <div className={styles.filters}>
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={styles.filterChip}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <AvatarAnalyzerViewer
          glbUrl={analyzer.previewUrl}
          landmarks={analyzer.landmarks}
          stage={stageKey}
          dimensions={analyzer.detail?.analysis.dimensions}
          showLandmarks={showLandmarks}
          showLabels={showLabels}
          showSkeleton={showSkeleton}
          showWireframe={showWireframe}
          selectedName={analyzer.selectedName}
          onSelectLandmark={selectAndFocus}
          focusToken={focusToken}
          focusOverride={focusOverride}
          pickMode={pickMode}
          onSurfacePick={(pick) => { void analyzer.saveCorrection(pick.point); setPickMode(false); }}
        />
        <RegionStats label={label} stats={stageKey === "todos" ? regionStats.cuerpo : regionStats[stageKey]} />
        <div className={styles.landmarkList}>
          {regionEntries.map(([name, record]) => (
            <button
              key={name}
              type="button"
              className={styles.landmarkRow}
              aria-pressed={analyzer.selectedName === name}
              onClick={() => selectAndFocus(name)}
            >
              <span>{readableName(name)}</span>
              <span>{stateLabel(record)} · {percent(confidenceOf(record))}</span>
            </button>
          ))}
          {!regionEntries.length ? <p className={styles.muted}>Ningún landmark coincide con este filtro.</p> : null}
        </div>
      </div>
      <LandmarkInspector
        name={analyzer.selectedName || null}
        record={analyzer.selectedRecord}
        onPrev={regionEntries.length > 1 ? stepPrev : undefined}
        onNext={regionEntries.length > 1 ? stepNext : undefined}
        onCenter={analyzer.selectedName ? () => setFocusToken((v) => v + 1) : undefined}
        onStartCorrection={analyzer.selectedName ? () => setPickMode(true) : undefined}
      />
    </div>
  );

  return (
    <div className={styles.shell}>
      <nav className={styles.stepper} aria-label="Etapas del laboratorio holográfico">
        {WIZARD_STAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={styles.stepButton}
            aria-current={stage === item.key ? "step" : undefined}
            data-done={stageDone[item.key]}
            onClick={() => setStage(item.key)}
          >
            <span className={styles.stepBadge}>{stageDone[item.key] ? <CheckCircle2 size={12} /> : WIZARD_STAGES.findIndex((s) => s.key === item.key) + 1}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {stage === "avatar" ? (
        <AssignedAvatarCard
          avatar={analyzer.assignedAvatar}
          avatarState={analyzer.assignedAvatarState}
          lastAnalysis={analyzer.lastAnalysisInfo}
          previewGlbUrl={analyzer.previewUrl}
          analyzerProcessLabel={processStateLabel(analyzer.analysisProcessState)}
        />
      ) : null}

      {stage === "cuerpo" ? renderRegionStage("Cuerpo") : null}
      {stage === "manos" ? renderRegionStage(handSide === "mano izquierda" ? "Mano izquierda" : "Mano derecha") : null}
      {stage === "cara" ? renderRegionStage("Cara") : null}

      {stage === "bigdata" ? (
        <BigDataStage analyzer={analyzer} regionStats={regionStats} />
      ) : null}

      {stage === "revision" ? (
        <div className={styles.stageMain}>
          <div className={styles.viewerToggles}>
            <button type="button" aria-pressed={showSkeleton} onClick={() => setShowSkeleton((v) => !v)}>Mostrar esqueleto interno</button>
            <button type="button" aria-pressed={showWireframe} onClick={() => setShowWireframe((v) => !v)}>Wireframe</button>
          </div>
          <AvatarAnalyzerViewer
            glbUrl={analyzer.previewUrl}
            landmarks={analyzer.landmarks}
            stage="todos"
            dimensions={analyzer.detail?.analysis.dimensions}
            showLandmarks={showLandmarks}
            showSkeleton={showSkeleton}
            showWireframe={showWireframe}
            selectedName={analyzer.selectedName}
            onSelectLandmark={selectAndFocus}
            focusToken={focusToken}
          />
          <div className={styles.bigDataGrid}>
            {Object.entries(regionStats).map(([label, stats]) => (
              <RegionStats key={label} label={readableName(label)} stats={stats} />
            ))}
          </div>
          <WarningsPanel analyzer={analyzer} />
        </div>
      ) : null}

      {stage === "confirmacion" ? <ConfirmationStage analyzer={analyzer} ready={readyToConfirm} canAdvance={canAdvance} /> : null}
    </div>
  );
}

function WarningsPanel({ analyzer }: { analyzer: UseAvatarAnalyzer }) {
  if (!analyzer.warnings.length) return <p className={styles.muted}>No hay advertencias registradas.</p>;
  return (
    <div className={styles.landmarkList}>
      {analyzer.warnings.slice(0, 80).map((warning, index) => (
        <div key={`${warning.code ?? "warning"}-${index}`} className={styles.landmarkRow}>
          <TriangleAlert size={14} />
          <span>{warning.message || readableName(String(warning.code ?? "REVISIÓN_REQUERIDA"))}</span>
        </div>
      ))}
    </div>
  );
}

function BigDataStage({
  analyzer,
  regionStats,
}: {
  analyzer: UseAvatarAnalyzer;
  regionStats: ReturnType<typeof getRegionStats>;
}) {
  const summary = analyzer.effectiveSummary;
  const totals = Object.values(regionStats).reduce((acc, stats) => ({
    total: acc.total + stats.total,
    verified: acc.verified + stats.verified,
    internal: acc.internal + stats.internal,
    surface: acc.surface + stats.surface,
    pending: acc.pending + stats.pending,
    blocking: acc.blocking + stats.blocking,
  }), { total: 0, verified: 0, internal: 0, surface: 0, pending: 0, blocking: 0 });

  return (
    <div className={styles.stageMain}>
      <div className={styles.bigDataGrid}>
        <div className={styles.readinessCard}>
          <h4>Puntos superficiales verificados</h4>
          <div className={styles.readinessScore}>{totals.surface}</div>
        </div>
        <div className={styles.readinessCard}>
          <h4>Articulaciones internas calculadas</h4>
          <div className={styles.readinessScore}>{totals.internal}</div>
        </div>
        <div className={styles.readinessCard}>
          <h4>Puntos pendientes</h4>
          <div className={styles.readinessScore}>{totals.pending}</div>
        </div>
        <div className={`${styles.readinessCard} ${totals.blocking ? styles.blocked : styles.ready}`}>
          <h4>Bloqueantes reales</h4>
          <div className={styles.readinessScore}>{totals.blocking}</div>
        </div>
      </div>

      <div className={styles.bigDataGrid}>
        <div className={`${styles.readinessCard} ${summary?.bodyRigReady ? styles.ready : styles.blocked}`}>
          <h4>Cuerpo básico</h4>
          <div className={styles.readinessScore}>{summary?.bodyRigReady ? "Listo para rig corporal" : "Pendiente"}</div>
          <div className={styles.readinessReason}>Confianza del cuerpo base: {percent(summary?.bodyBaseConfidence ?? summary?.humanoidConfidence)}</div>
        </div>
        <div className={`${styles.readinessCard} ${summary?.requestedProfileReady ?? summary?.rigReadinessApproved ? styles.ready : styles.blocked}`}>
          <h4>Perfil solicitado: {summary?.requestedRigProfile || "BODY_BASIC"}</h4>
          <div className={styles.readinessScore}>Estado del perfil: {(summary?.requestedProfileReady ?? summary?.rigReadinessApproved) ? "Listo" : "Bloqueado"}</div>
          <div className={styles.readinessReason}>Preparación para el perfil: {percent(summary?.rigReadinessScore)}</div>
        </div>
      </div>

      <p className={styles.regionStats}>
        {summary?.bodyRigReady && !(summary?.faceAnalysisReady && summary?.leftFingerRigReady && summary?.rightFingerRigReady)
          ? "Rig corporal disponible · análisis avanzado pendiente."
          : summary?.bodyRigReady ? "Análisis avanzado completo." : "El cuerpo todavía no está listo para el rig."}
      </p>

      <div className={styles.bigDataGrid}>
        <div className={styles.readinessCard}>
          <h4>Landmarks sin evidencia visual</h4>
          <div className={styles.readinessScore}>{summary?.noVisualEvidenceCount ?? 0}</div>
        </div>
        <div className={styles.readinessCard}>
          <h4>Landmarks con vistas insuficientes</h4>
          <div className={styles.readinessScore}>{summary?.insufficientViewsCount ?? 0}</div>
        </div>
        <div className={styles.readinessCard}>
          <h4>Incompatibilidades visuales/técnicas</h4>
          <div className={styles.readinessScore}>{summary?.technicalMismatchCount ?? 0}</div>
        </div>
        <div className={styles.readinessCard}>
          <h4>Landmarks con topología inválida</h4>
          <div className={styles.readinessScore}>{summary?.topologyInvalidCount ?? 0}</div>
        </div>
      </div>

      <div className={styles.bigDataGrid}>
        {([
          ["Rostro", analyzer.coverage.face],
          ["Mano izquierda", analyzer.coverage.leftHand],
          ["Mano derecha", analyzer.coverage.rightHand],
        ] as const).map(([label, record]) => (
          <div key={label} className={styles.readinessCard}>
            <h4>{label}</h4>
            <div className={styles.readinessReason}>
              {record?.rendererStatus === "not_run"
                ? "Fase no ejecutada"
                : `${record?.detectorSuccessfulViews ?? 0}/${record?.renderedViews ?? 0} detectadas · ${record?.framingValidViews ?? 0}/${record?.renderedViews ?? 0} encuadradas`}
            </div>
            <div className={styles.readinessReason}>Visual {percent(record?.visualCoverage)} · Geométrica {percent(record?.geometricCoverage)}</div>
          </div>
        ))}
      </div>
      <p className={styles.muted}>
        0/7 vistas significa que el detector no reconoció esa región en ninguna de las siete cámaras renderizadas.
      </p>

      <p className={styles.regionStats}>
        Próxima acción: {getHumanRecommendedAction(summary?.recommendedNextAction) || "Sin acción recomendada pendiente."}
      </p>

      <details className={styles.advancedPanel}>
        <summary>Panel avanzado (códigos técnicos)</summary>
        <code>{JSON.stringify(summary?.recommendedNextAction ?? null)}</code>
        <code>rigReadinessGates: {(summary?.rigReadinessGates || []).join(", ") || "—"}</code>
      </details>
    </div>
  );
}

function ConfirmationStage({
  analyzer,
  ready,
  canAdvance,
}: {
  analyzer: UseAvatarAnalyzer;
  ready: boolean;
  canAdvance: boolean;
}) {
  return (
    <div className={styles.stageMain}>
      <div className={styles.confirmChecklist}>
        <span className={styles.confirmItem} data-ok={analyzer.analysisProcessState === "ready"}>
          <CheckCircle2 size={14} /> El job terminó realmente ({processStateLabel(analyzer.analysisProcessState)})
        </span>
        <span className={styles.confirmItem} data-ok={Boolean(analyzer.detail)}>
          <CheckCircle2 size={14} /> Existe un resultado válido y persistido
        </span>
        <span className={styles.confirmItem} data-ok={ready}>
          <CheckCircle2 size={14} /> Cuerpo, manos y cara fueron evaluados sin bloqueantes en el cuerpo
        </span>
        <span className={styles.confirmItem} data-ok={analyzer.manuallyApproved}>
          <CheckCircle2 size={14} /> Confirmación manual registrada
        </span>
      </div>

      <div className={`${styles.confirmActions} ${styles.footerBar}`}>
        <button type="button" onClick={() => void analyzer.approveAnalysis()} disabled={!ready || analyzer.approving || analyzer.manuallyApproved}>
          {analyzer.approving ? <Loader2 className={styles.spin} /> : <Save />}
          {analyzer.manuallyApproved ? "Confirmado" : "Confirmar análisis"}
        </button>
        <button type="button" disabled={!canAdvance}>
          <Crosshair /> AVANZAR AL SIGUIENTE PASO
        </button>
      </div>
      {analyzer.approveMessage ? <p className={styles.muted}>{analyzer.approveMessage}</p> : null}
    </div>
  );
}
