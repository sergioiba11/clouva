"use client";

import {
  BrainCircuit,
  CheckCircle2,
  Eye,
  Hand,
  Loader2,
  RotateCcw,
  Save,
  TriangleAlert,
} from "lucide-react";
import { createElement, useEffect, useMemo, useState } from "react";
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

type WarningRecord = {
  code?: string;
  landmark?: string;
  region?: string;
  side?: string;
  finger?: string;
  message?: string;
  [key: string]: unknown;
};

type LandmarkRecord = {
  name?: string;
  region?: string;
  surfaceRegion?: string;
  accepted?: boolean;
  display?: boolean;
  confidence?: number;
  finalConfidence?: number;
  internalJointPosition?: number[];
  surfaceDisplayPosition?: number[];
  position?: number[];
  viewsConfirmed?: number;
  rayResidual?: number;
  depthResidual?: number;
  method?: string;
  methods?: string[];
  rejectionReasons?: string[];
};

type SubsystemRecord = {
  status?: string;
  required?: string[];
  missingOrInvalid?: string[];
  blockingWarnings?: WarningRecord[];
  nonBlockingWarnings?: WarningRecord[];
};

type AnalysisDetail = {
  summary: AnalysisSummary;
  analysis: {
    bodySubsystems?: Record<string, SubsystemRecord>;
    landmarks?: Record<string, LandmarkRecord>;
    warnings?: WarningRecord[];
  };
  acceptedLandmarks?: Record<string, LandmarkRecord>;
  rejectedLandmarks?: Record<string, LandmarkRecord>;
  corrections?: unknown;
};

type CameraPreset = {
  label: string;
  orbit: string;
  targetLandmarks?: string[];
  icon?: "face" | "hand";
};

const CAMERA_PRESETS: CameraPreset[] = [
  { label: "Frente", orbit: "0deg 75deg 105%" },
  { label: "Espalda", orbit: "180deg 75deg 105%" },
  { label: "Lado izquierdo", orbit: "90deg 75deg 105%" },
  { label: "Lado derecho", orbit: "-90deg 75deg 105%" },
  { label: "Rostro", orbit: "0deg 75deg 34%", targetLandmarks: ["nose_tip", "head"], icon: "face" },
  { label: "Mano izquierda", orbit: "-65deg 75deg 22%", targetLandmarks: ["palm_l", "wrist_l"], icon: "hand" },
  { label: "Mano derecha", orbit: "65deg 75deg 22%", targetLandmarks: ["palm_r", "wrist_r"], icon: "hand" },
];

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

function statusLabel(value?: string) {
  if (value === "valid") return "Válido";
  if (value === "valid_with_warnings") return "Válido con advertencias";
  if (value === "needs_review") return "Necesita revisión";
  if (value === "invalid") return "Inválido";
  return value || "Sin datos";
}

function readableName(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\bl\b/g, "izquierda")
    .replace(/\br\b/g, "derecha")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function warningDescription(warning: WarningRecord) {
  if (warning.message) return warning.message;
  const subject = warning.landmark || warning.finger || warning.region || warning.side;
  return `${warning.code || "REVISIÓN_REQUERIDA"}${subject ? ` · ${readableName(String(subject))}` : ""}`;
}

function recordPosition(record?: LandmarkRecord) {
  const value = record?.internalJointPosition || record?.position || record?.surfaceDisplayPosition;
  return Array.isArray(value) && value.length === 3 ? value.map(Number) : null;
}

function displayPosition(record?: LandmarkRecord) {
  const value = record?.surfaceDisplayPosition || record?.internalJointPosition || record?.position;
  return Array.isArray(value) && value.length === 3 ? value.map(Number) : null;
}

function cameraTarget(landmarks: Record<string, LandmarkRecord>, names?: string[]) {
  for (const name of names || []) {
    const position = displayPosition(landmarks[name]);
    if (position) return `${position[0]}m ${position[1]}m ${position[2]}m`;
  }
  return "auto auto auto";
}

function numberLabel(value?: number) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "—";
}

export function AvatarAnalyzerPreview() {
  const { user, session, loading: authLoading } = useAuth();
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOrbit, setCameraOrbit] = useState("0deg 75deg 105%");
  const [cameraTargetValue, setCameraTargetValue] = useState("auto auto auto");
  const [selectedName, setSelectedName] = useState("");
  const [correction, setCorrection] = useState<[string, string, string]>(["", "", ""]);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const landmarks = useMemo(
    () => detail?.analysis.landmarks || {},
    [detail],
  );
  const rejectedEntries = useMemo(
    () => Object.entries(detail?.rejectedLandmarks || {}),
    [detail],
  );
  const acceptedEntries = useMemo(
    () => Object.entries(detail?.acceptedLandmarks || {}),
    [detail],
  );
  const selectableEntries = useMemo(
    () => [...rejectedEntries, ...acceptedEntries].sort(([first], [second]) => first.localeCompare(second)),
    [acceptedEntries, rejectedEntries],
  );

  const loadDetail = async (runId: string, accessToken: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/avatar/analyze/result/${runId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const data = await response.json() as AnalysisDetail & { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo leer el reporte anatómico.");
      setDetail(data);
      const firstRejected = Object.keys(data.rejectedLandmarks || {})[0];
      if (firstRejected) selectLandmark(firstRejected, data.analysis.landmarks || {});
    } finally {
      setLoadingDetail(false);
    }
  };

  const analyze = async () => {
    if (!session?.access_token) return;
    setAnalyzing(true);
    setError(null);
    setSummary(null);
    setDetail(null);
    setSelectedName("");
    setCorrectionMessage(null);
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
      const decoded = decodeSummary(response.headers.get("x-clouva-analysis-summary"));
      const blob = await response.blob();
      if (blob.size < 1024) throw new Error("El diagnóstico llegó vacío.");
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setSummary(decoded);
      setCameraOrbit("0deg 75deg 105%");
      setCameraTargetValue("auto auto auto");
      if (decoded?.runId) await loadDetail(decoded.runId, session.access_token);
    } catch (cause) {
      console.error("Avatar Analyzer UI failed", cause);
      setError(cause instanceof Error ? cause.message : "No se pudo analizar el avatar.");
    } finally {
      setAnalyzing(false);
    }
  };

  const selectLandmark = (
    name: string,
    source: Record<string, LandmarkRecord> = landmarks,
  ) => {
    setSelectedName(name);
    const position = recordPosition(source[name]);
    setCorrection(position ? position.map((value) => String(value)) as [string, string, string] : ["", "", ""]);
    setCorrectionMessage(null);
  };

  const usePreset = (preset: CameraPreset) => {
    setCameraOrbit(preset.orbit);
    setCameraTargetValue(cameraTarget(landmarks, preset.targetLandmarks));
  };

  const saveCorrection = async () => {
    if (!summary?.runId || !session?.access_token || !selectedName) return;
    const parsed = correction.map(Number);
    if (parsed.some((value) => !Number.isFinite(value))) {
      setCorrectionMessage("Ingresá tres coordenadas numéricas válidas.");
      return;
    }
    setSavingCorrection(true);
    setCorrectionMessage(null);
    try {
      const response = await fetch(
        `/api/avatar/analyze/result/${summary.runId}/corrections`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            corrections: [{
              name: selectedName,
              corrected_position: parsed,
              approved: true,
              note: "Corrección manual desde Biblioteca CLOUVA",
            }],
            region_decisions: {},
            fused_fingers: [],
          }),
        },
      );
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la corrección.");
      setCorrectionMessage("Corrección guardada separadamente. El análisis automático original no fue modificado.");
    } catch (cause) {
      setCorrectionMessage(cause instanceof Error ? cause.message : "No se pudo guardar la corrección.");
    } finally {
      setSavingCorrection(false);
    }
  };

  if (authLoading || !user) return null;

  const verified = summary?.verifiedSurfaceLandmarkCount ?? summary?.landmarkCount ?? 0;
  const subsystems = Object.entries(detail?.analysis.bodySubsystems || {});
  const warnings = detail?.analysis.warnings || [];
  const selectedRecord = landmarks[selectedName];

  return (
    <section className={styles.card} aria-label="Avatar Analyzer CLOUVA">
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.icon}><BrainCircuit /></span>
        <div>
          <small>BLENDER WORKER · DIAGNÓSTICO V3</small>
          <h2>Avatar Analyzer</h2>
          <p>Segmenta regiones reales, usa BVH por anatomía y valida cuerpo, rostro y cada dedo antes del rig.</p>
        </div>
      </header>

      {previewUrl ? (
        <>
          <div className={styles.viewer}>
            {createElement("model-viewer", {
              className: styles.model,
              src: previewUrl,
              alt: "Avatar CLOUVA con landmarks anatómicos verificados",
              "camera-controls": true,
              "camera-orbit": cameraOrbit,
              "camera-target": cameraTargetValue,
              "shadow-intensity": "1",
              exposure: "1",
            })}
            <span className={styles.viewerBadge}>SUPERFICIE ANATÓMICA VERIFICADA</span>
          </div>
          <div className={styles.cameraBar} aria-label="Vistas del diagnóstico">
            {CAMERA_PRESETS.map((preset) => (
              <button type="button" key={preset.label} onClick={() => usePreset(preset)}>
                {preset.icon === "face" ? <Eye /> : preset.icon === "hand" ? <Hand /> : null}
                {preset.label}
              </button>
            ))}
          </div>
        </>
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
            <div><span>Compatibilidad corporal</span><strong>{Math.round(summary.humanoidConfidence * 100)}%</strong></div>
            <div><span>Superficie verificada</span><strong>{verified}</strong></div>
            <div><span>Articulaciones internas</span><strong>{summary.internalJointCount ?? 0}</strong></div>
            <div><span>Candidatos rechazados</span><strong>{summary.rejectedLandmarkCount ?? 0}</strong></div>
            <div><span>Cuerpo</span><strong>{statusLabel(summary.bodyAnalysis)}</strong></div>
            <div><span>Rostro</span><strong>{statusLabel(summary.faceAnalysis)}</strong></div>
            <div><span>Mano izquierda</span><strong>{statusLabel(summary.leftHandAnalysis)}</strong></div>
            <div><span>Mano derecha</span><strong>{statusLabel(summary.rightHandAnalysis)}</strong></div>
          </div>
          {summary.status === "needs_review" || summary.status === "invalid" ? (
            <p className={styles.error}>
              <TriangleAlert /> Análisis anatómico pendiente de revisión. Todavía no se utilizará para crear el rig.
            </p>
          ) : (
            <p className={styles.success}><CheckCircle2 /> El mapa anatómico superó las validaciones automáticas.</p>
          )}
        </>
      ) : null}

      {loadingDetail ? (
        <div className={styles.processing}><Loader2 className={styles.spin} /><p>Cargando evidencias y motivos de revisión…</p></div>
      ) : null}

      {detail ? (
        <div className={styles.detailGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><small>VALIDACIÓN POR REGIÓN</small><h3>Subsistemas corporales</h3></div>
              <span>{subsystems.length}</span>
            </div>
            <div className={styles.subsystemList}>
              {subsystems.map(([name, subsystem]) => (
                <article key={name}>
                  <div>
                    <strong>{readableName(name)}</strong>
                    <span>{statusLabel(subsystem.status)}</span>
                  </div>
                  {(subsystem.missingOrInvalid || []).length ? (
                    <p>Revisar: {(subsystem.missingOrInvalid || []).map(readableName).join(", ")}</p>
                  ) : <p>Articulaciones esenciales comprobadas.</p>}
                  <small>
                    {(subsystem.blockingWarnings || []).length} bloqueantes · {(subsystem.nonBlockingWarnings || []).length} informativas
                  </small>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><small>EVIDENCIA</small><h3>Motivos de revisión</h3></div>
              <span>{warnings.length}</span>
            </div>
            <div className={styles.warningList}>
              {warnings.length ? warnings.slice(0, 16).map((warning, index) => (
                <button
                  type="button"
                  key={`${warning.code || "warning"}-${index}`}
                  onClick={() => warning.landmark && selectLandmark(warning.landmark)}
                  disabled={!warning.landmark}
                >
                  <TriangleAlert />
                  <span><strong>{warningDescription(warning)}</strong><small>{warning.landmark ? "Abrir landmark" : "Advertencia regional"}</small></span>
                </button>
              )) : <p className={styles.muted}>No hay advertencias registradas.</p>}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.widePanel}`}>
            <div className={styles.panelHeader}>
              <div><small>LANDMARKS</small><h3>Aceptados y rechazados</h3></div>
              <span>{selectableEntries.length}</span>
            </div>
            <div className={styles.landmarkTableWrap}>
              <table className={styles.landmarkTable}>
                <thead><tr><th>Landmark</th><th>Región</th><th>Estado</th><th>Confianza</th><th>Vistas</th><th>Motivo</th></tr></thead>
                <tbody>
                  {selectableEntries.slice(0, 80).map(([name, record]) => (
                    <tr key={name} className={selectedName === name ? styles.selectedRow : undefined} onClick={() => selectLandmark(name)}>
                      <td>{readableName(name)}</td>
                      <td>{readableName(record.region || "unknown")}</td>
                      <td>{record.accepted ? "Aceptado" : "Rechazado"}</td>
                      <td>{Math.round((record.finalConfidence ?? record.confidence ?? 0) * 100)}%</td>
                      <td>{record.viewsConfirmed ?? 0}</td>
                      <td>{(record.rejectionReasons || []).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.widePanel}`}>
            <div className={styles.panelHeader}>
              <div><small>DATASET FUTURO</small><h3>Corregir análisis</h3></div>
              <span>NO MODIFICA EL ORIGINAL</span>
            </div>
            <div className={styles.correctionGrid}>
              <label>
                Landmark
                <select value={selectedName} onChange={(event) => selectLandmark(event.target.value)}>
                  <option value="">Seleccionar…</option>
                  {selectableEntries.map(([name]) => <option value={name} key={name}>{readableName(name)}</option>)}
                </select>
              </label>
              {(["X", "Y", "Z"] as const).map((axis, index) => (
                <label key={axis}>
                  {axis}
                  <input
                    inputMode="decimal"
                    value={correction[index]}
                    onChange={(event) => setCorrection((current) => {
                      const next = [...current] as [string, string, string];
                      next[index] = event.target.value;
                      return next;
                    })}
                  />
                </label>
              ))}
              <button type="button" onClick={() => void saveCorrection()} disabled={!selectedName || savingCorrection}>
                {savingCorrection ? <Loader2 className={styles.spin} /> : <Save />}
                Guardar corrección
              </button>
            </div>
            {selectedRecord ? (
              <div className={styles.landmarkInspector}>
                <div><span>Región</span><strong>{readableName(selectedRecord.region || "unknown")}</strong></div>
                <div><span>Confianza</span><strong>{Math.round((selectedRecord.finalConfidence ?? selectedRecord.confidence ?? 0) * 100)}%</strong></div>
                <div><span>Vistas</span><strong>{selectedRecord.viewsConfirmed ?? 0}</strong></div>
                <div><span>Ray residual</span><strong>{numberLabel(selectedRecord.rayResidual)}</strong></div>
                <div><span>Depth residual</span><strong>{numberLabel(selectedRecord.depthResidual)}</strong></div>
                <div><span>Método</span><strong>{selectedRecord.method || "—"}</strong></div>
              </div>
            ) : null}
            {correctionMessage ? <p className={styles.correctionMessage}>{correctionMessage}</p> : null}
          </section>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.action}
        onClick={() => void analyze()}
        disabled={analyzing || !session?.access_token}
      >
        {analyzing ? <Loader2 className={styles.spin} /> : previewUrl ? <RotateCcw /> : <BrainCircuit />}
        {analyzing ? "ANALIZANDO BVH, TOPOLOGÍA Y PROFUNDIDAD…" : previewUrl ? "VOLVER A ANALIZAR" : "ANALIZAR AVATAR"}
      </button>

      {analyzing ? (
        <div className={styles.processing}>
          <span />
          <p>Blender construye BVH por región, calcula pases técnicos y detecta las ramas reales de cada mano.</p>
        </div>
      ) : null}

      {error ? <p className={styles.error}><TriangleAlert /> {error}</p> : null}
    </section>
  );
}
