"use client";

import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Crosshair,
  Eye,
  ExternalLink,
  Hand,
  Loader2,
  RotateCcw,
  Save,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import {
  createElement,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/auth-provider";
import styles from "./avatar-analyzer-preview.module.css";

type CoverageRecord = {
  renderedViews?: number;
  detectorSuccessfulViews?: number;
  projectedSuccessfulViews?: number;
  triangulatedViews?: number;
  candidateCount?: number;
  projectedCandidates?: number;
  triangulatedLandmarks?: number;
  projectionFailureCount?: number;
  technicalMismatchCount?: number;
  detectorFailureCount?: number;
  visualCoverage?: number;
  geometricCoverage?: number;
};

type DetectionCoverage = {
  face?: CoverageRecord;
  leftHand?: CoverageRecord;
  rightHand?: CoverageRecord;
};

type AnalysisSummary = {
  status: string;
  runId: string;
  analyzerVersion?: string;
  sourceSha256?: string;
  humanoidConfidence?: number;
  bodyBaseConfidence?: number;
  rigReadinessScore?: number;
  rigReadinessApproved?: boolean;
  requestedRigProfile?: string;
  supportedRigProfiles?: string[];
  requestedProfileReady?: boolean;
  requestedProfileBlockingReasons?: Array<{ landmark?: string; state?: string; reasons?: string[] }>;
  advancedAnalysisWarnings?: Array<{ capability?: string; status?: string; blocking?: boolean }>;
  bodyRigReady?: boolean;
  faceAnalysisReady?: boolean;
  leftHandBaseReady?: boolean;
  rightHandBaseReady?: boolean;
  leftFingerRigReady?: boolean;
  rightFingerRigReady?: boolean;
  rigReadinessGates?: string[];
  recommendedNextAction?: string | Record<string, unknown>;
  criticalLandmarksVerified?: boolean;
  bodyAnalysis?: string;
  faceAnalysis?: string;
  leftHandAnalysis?: string;
  rightHandAnalysis?: string;
  landmarkCount?: number;
  verifiedSurfaceLandmarkCount?: number;
  verifiedLandmarkCount?: number;
  internalJointCount?: number;
  rejectedLandmarkCount?: number;
  noVisualEvidenceCount?: number;
  insufficientViewsCount?: number;
  technicalMismatchCount?: number;
  topologyInvalidCount?: number;
  rawLandmarkCount?: number;
  hiddenLandmarkCount?: number;
  warningCount: number;
  detectionCoverage?: DetectionCoverage;
  orientation?: {
    orientationConfidence?: number;
    requiresOrientationReview?: boolean;
    detectedUpAxis?: string;
    detectedFrontAxis?: string;
    mirrored?: boolean;
  };
  rigModified: boolean;
};

type WarningRecord = {
  code?: string;
  landmark?: string;
  name?: string;
  region?: string;
  side?: string;
  finger?: string;
  message?: string;
  occurrences?: number;
  failureStage?: string;
  blocking?: boolean;
  [key: string]: unknown;
};

type LandmarkRecord = {
  name?: string;
  region?: string;
  surfaceRegion?: string;
  accepted?: boolean;
  verified?: boolean;
  display?: boolean;
  blocking?: boolean;
  state?: string;
  evidenceState?: string;
  evidenceType?: string;
  requiresVisualViews?: boolean;
  manualCorrectionRecommended?: boolean;
  manual_verified?: boolean;
  failureStage?: string | null;
  failureCode?: string | null;
  rawConfidence?: number;
  confidence?: number;
  finalConfidence?: number;
  internalJointPosition?: number[];
  surfaceDisplayPosition?: number[];
  displayPosition?: number[];
  position?: number[];
  viewsConfirmed?: number;
  triangulationInliers?: number;
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

type AnalysisPayload = {
  bodySubsystems?: Record<string, SubsystemRecord>;
  landmarks?: Record<string, LandmarkRecord>;
  warnings?: WarningRecord[];
  detectionCoverage?: DetectionCoverage;
  dimensions?: {
    center?: number[];
    boundingBoxMin?: number[];
    boundingBoxMax?: number[];
  };
  metrics?: Record<string, number | Record<string, number>>;
  rigReadinessGates?: string[];
};

type AnalysisDetail = {
  summary: AnalysisSummary;
  analysis: AnalysisPayload;
  acceptedLandmarks?: Record<string, LandmarkRecord>;
  rejectedLandmarks?: Record<string, LandmarkRecord>;
  corrections?: unknown;
  assets?: {
    diagnosticGlb?: string;
    renders?: string[];
  };
};

type CameraPreset = {
  label: string;
  orbit: string;
  targetLandmarks: string[];
  icon?: "face" | "hand";
};

type Point3D = { x: number; y: number; z: number };
type ModelSurfaceResult = { position?: Point3D; normal?: Point3D } | null;

type ModelViewerElement = HTMLElement & {
  cameraOrbit?: string;
  cameraTarget?: string;
  fieldOfView?: string;
  jumpCameraToGoal?: () => void;
  resetTurntableRotation?: () => void;
  positionAndNormalFromPoint?: (x: number, y: number) => ModelSurfaceResult;
};

type LandmarkGroup = "cuerpo" | "rostro" | "mano izquierda" | "mano derecha" | "piernas y pies";

const BODY_TARGETS = ["pelvis", "chest"];
const GROUP_ORDER: LandmarkGroup[] = ["cuerpo", "rostro", "mano izquierda", "mano derecha", "piernas y pies"];

const CAMERA_PRESETS: CameraPreset[] = [
  { label: "Frente", orbit: "0deg 75deg 115%", targetLandmarks: BODY_TARGETS },
  { label: "Espalda", orbit: "180deg 75deg 115%", targetLandmarks: BODY_TARGETS },
  { label: "Lado izquierdo", orbit: "90deg 75deg 115%", targetLandmarks: BODY_TARGETS },
  { label: "Lado derecho", orbit: "-90deg 75deg 115%", targetLandmarks: BODY_TARGETS },
  {
    label: "Rostro",
    orbit: "0deg 72deg 40%",
    targetLandmarks: ["nose_tip", "forehead_center", "chin", "head"],
    icon: "face",
  },
  {
    label: "Mano izquierda",
    orbit: "-65deg 74deg 29%",
    targetLandmarks: ["palm_l", "wrist_l", "middle_01_l", "hand_l"],
    icon: "hand",
  },
  {
    label: "Mano derecha",
    orbit: "65deg 74deg 29%",
    targetLandmarks: ["palm_r", "wrist_r", "middle_01_r", "hand_r"],
    icon: "hand",
  },
];

const STATE_LABELS: Record<string, string> = {
  verified: "Verificado",
  verified_internal_geometry: "Verificado internamente",
  verified_visual_geometry: "Verificado visualmente",
  verified_single_view_depth: "Verificado con profundidad",
  verified_geometry_fallback: "Verificado por geometría",
  low_confidence: "Confianza baja",
  insufficient_views: "Faltan vistas",
  no_visual_evidence: "Sin evidencia visual",
  projection_mismatch: "Proyección incompatible",
  manual_review_required: "Revisión manual requerida",
  technical_mismatch: "Evidencia técnica incompatible",
  topology_invalid: "Topología inválida",
  manually_corrected: "Corregido manualmente",
  unsupported: "No compatible",
};

const FAILURE_LABELS: Record<string, string> = {
  detector: "Detector visual",
  projection: "Proyección sobre la malla",
  triangulation: "Triangulación entre cámaras",
  topology: "Topología de la región",
  validation: "Validación final",
  body_region_validation: "Región corporal",
  body_confidence: "Confianza corporal",
  rig_readiness: "Preparación para rig",
};

function recommendedActionLabel(value?: string | Record<string, unknown>) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return "";
  for (const key of ["message", "action", "operation", "label", "reason"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function statusLabel(value?: string) {
  if (value === "valid") return "Válido";
  if (value === "valid_with_warnings") return "Válido con advertencias";
  if (value === "needs_review") return "Necesita revisión";
  if (value === "invalid") return "Inválido";
  if (value === "orientation_needs_review") return "Revisar orientación";
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
  const occurrences = Number(warning.occurrences ?? 1);
  const suffix = occurrences > 1 ? ` · ${occurrences} evidencias` : "";
  if (warning.message) return `${warning.message}${suffix}`;
  const subject = warning.landmark || warning.name || warning.finger || warning.region || warning.side;
  return `${readableName(warning.code || "REVISIÓN_REQUERIDA")}${subject ? ` · ${readableName(String(subject))}` : ""}${suffix}`;
}

function warningKind(warning: WarningRecord) {
  if (warning.failureStage) return FAILURE_LABELS[String(warning.failureStage)] || readableName(String(warning.failureStage));
  if (warning.landmark || warning.name) return "Abrir landmark";
  if (warning.finger) return `Cadena del dedo ${readableName(String(warning.finger))}`;
  if (warning.side) return `Revisión ${readableName(String(warning.side))}`;
  return "Advertencia regional";
}

function recordPosition(record?: LandmarkRecord) {
  const value = record?.internalJointPosition || record?.position || record?.surfaceDisplayPosition;
  return Array.isArray(value) && value.length === 3 ? value.map(Number) : null;
}

function displayPosition(record?: LandmarkRecord) {
  const value = record?.surfaceDisplayPosition || record?.internalJointPosition || record?.position;
  return Array.isArray(value) && value.length === 3 ? value.map(Number) : null;
}

function confidenceOf(record?: LandmarkRecord) {
  return Number(record?.rawConfidence ?? record?.finalConfidence ?? record?.confidence ?? 0);
}

function stateLabel(record?: LandmarkRecord) {
  if (!record) return "Sin datos";
  const state = record.state || (record.accepted ? "verified" : "low_confidence");
  return STATE_LABELS[state] || readableName(state);
}

function analysisCenter(detail: AnalysisDetail | null) {
  const center = detail?.analysis.dimensions?.center;
  if (Array.isArray(center) && center.length === 3) return center.map(Number);
  const minimum = detail?.analysis.dimensions?.boundingBoxMin;
  const maximum = detail?.analysis.dimensions?.boundingBoxMax;
  if (Array.isArray(minimum) && minimum.length === 3 && Array.isArray(maximum) && maximum.length === 3) {
    return minimum.map((value, index) => (Number(value) + Number(maximum[index])) * 0.5);
  }
  return [0, 0, 0];
}

function targetValue(position: number[]) {
  return `${position[0]}m ${position[1]}m ${position[2]}m`;
}

function cameraTarget(
  landmarks: Record<string, LandmarkRecord>,
  names: string[],
  fallback: number[],
) {
  const positions = names
    .map((name) => displayPosition(landmarks[name]))
    .filter((value): value is number[] => Boolean(value));
  if (!positions.length) return targetValue(fallback);
  const center = [0, 1, 2].map(
    (axis) => positions.reduce((total, position) => total + position[axis], 0) / positions.length,
  );
  return targetValue(center);
}

function numberLabel(value?: number) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "—";
}

function percent(value?: number) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
}

function landmarkGroup(name: string): LandmarkGroup {
  const normalized = name.toLowerCase();
  if (/^(brow|eye|nose|mouth|lip|chin|jaw|cheek|forehead|temple|ear)_/.test(normalized)) return "rostro";
  if (normalized.endsWith("_l") && /^(thumb|index|middle|ring|pinky|palm|wrist)_/.test(normalized)) return "mano izquierda";
  if (normalized.endsWith("_r") && /^(thumb|index|middle|ring|pinky|palm|wrist)_/.test(normalized)) return "mano derecha";
  if (/^(hip|thigh|knee|calf|ankle|foot|ball)_/.test(normalized)) return "piernas y pies";
  return "cuerpo";
}

function groupPreset(group: LandmarkGroup) {
  if (group === "rostro") return CAMERA_PRESETS[4];
  if (group === "mano izquierda") return CAMERA_PRESETS[5];
  if (group === "mano derecha") return CAMERA_PRESETS[6];
  return CAMERA_PRESETS[0];
}

function renderToken(group: LandmarkGroup) {
  if (group === "rostro") return "face_";
  if (group === "mano izquierda") return "hand_l_";
  if (group === "mano derecha") return "hand_r_";
  return "";
}

function compactCoverage(record?: CoverageRecord) {
  if (!record) return "Sin datos";
  return `${record.detectorSuccessfulViews ?? 0}/${record.renderedViews ?? 0} vistas · ${record.projectedSuccessfulViews ?? 0} proyectadas`;
}

type JobStatus = {
  status: "pending" | "done" | "error";
  runId?: string;
  summary?: AnalysisSummary;
  detail?: string;
};

type AnalysisProcessState = "idle" | "starting" | "running" | "summary_ready" | "ready" | "failed";
type DetailState = "idle" | "loading" | "ready" | "retrying" | "temporarily_unavailable" | "failed";
type AssetState = "idle" | "loading" | "ready" | "failed";

type ApiErrorPayload = {
  error?: string;
  code?: string;
  retryable?: boolean;
};

const DETAIL_RETRYABLE_STATUSES = new Set([429, 502, 503]);
const DETAIL_MAX_ATTEMPTS = 5;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readApiError(response: Response): Promise<ApiErrorPayload> {
  const data = await response.json().catch(() => null) as ApiErrorPayload | null;
  return data || {
    error: `No se pudo consultar el diagnóstico (${response.status}).`,
    code: "ANALYZER_HTTP_ERROR",
    retryable: DETAIL_RETRYABLE_STATUSES.has(response.status),
  };
}

function processStateLabel(state: AnalysisProcessState) {
  return {
    idle: "Sin iniciar",
    starting: "Iniciando",
    running: "Analizando",
    summary_ready: "Resultado persistido",
    ready: "Completado",
    failed: "Falló",
  }[state];
}

function detailStateLabel(state: DetailState) {
  return {
    idle: "Sin solicitar",
    loading: "Cargando",
    ready: "Recuperado",
    retrying: "Reintentando",
    temporarily_unavailable: "Temporalmente no disponible",
    failed: "Falló",
  }[state];
}

function assetStateLabel(state: AssetState) {
  return { idle: "Sin solicitar", loading: "Cargando", ready: "Recuperado", failed: "Falló" }[state];
}

const JOB_POLL_INTERVAL_MS = 4000;
const JOB_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const ACTIVE_JOB_KEY = "clouva.avatarAnalyzer.activeJob.v1";

type PersistedJob = { jobId: string; startedAt: number };

function saveActiveJob(job: PersistedJob | null) {
  if (typeof window === "undefined") return;
  if (job) window.localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
  else window.localStorage.removeItem(ACTIVE_JOB_KEY);
}

function loadActiveJob(): PersistedJob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedJob>;
    if (!parsed.jobId || !parsed.startedAt) return null;
    return { jobId: parsed.jobId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

async function pollAnalysisJob(jobId: string, accessToken: string): Promise<JobStatus> {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let response: Response;
    try {
      response = await fetch(`/api/avatar/analyze/job/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch (cause) {
      // La red se corta cuando el celular se bloquea/la pestaña queda en segundo plano.
      // Es transitorio: reintentamos en vez de abortar el análisis en curso.
      console.warn("Avatar Analyzer poll: sin red, reintentando", cause);
      await new Promise((resolve) => window.setTimeout(resolve, JOB_POLL_INTERVAL_MS));
      continue;
    }
    const data = await response.json().catch(() => null) as (JobStatus & { error?: string }) | null;
    if (!data) {
      await new Promise((resolve) => window.setTimeout(resolve, JOB_POLL_INTERVAL_MS));
      continue;
    }
    if (!response.ok) throw new Error(data.error || `No se pudo consultar el estado del análisis (${response.status}).`);
    if (data.status === "done" || data.status === "error") return data;
    await new Promise((resolve) => window.setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
  throw new Error("El análisis está tardando demasiado y se canceló la espera en este dispositivo. Si el celular se bloqueó, esperá un momento y probá \"ABRIR ÚLTIMO ANÁLISIS\".");
}

export function AvatarAnalyzerPreview() {
  const { user, session, loading: authLoading } = useAuth();
  const [analysisProcessState, setAnalysisProcessState] = useState<AnalysisProcessState>("idle");
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [assetState, setAssetState] = useState<AssetState>("idle");
  const [restoringLatest, setRestoringLatest] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [workerErrorMessage, setWorkerErrorMessage] = useState<string | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const [detailRetryCount, setDetailRetryCount] = useState(0);
  const [cameraOrbit, setCameraOrbit] = useState(CAMERA_PRESETS[0].orbit);
  const [cameraTargetValue, setCameraTargetValue] = useState("0m 0m 0m");
  const [activeCamera, setActiveCamera] = useState(CAMERA_PRESETS[0].label);
  const [selectedName, setSelectedName] = useState("");
  const [correction, setCorrection] = useState<[string, string, string]>(["", "", ""]);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);
  const [visualCorrectionMode, setVisualCorrectionMode] = useState(false);
  const [showAllTechnical, setShowAllTechnical] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<LandmarkGroup, boolean>>({
    cuerpo: false,
    rostro: false,
    "mano izquierda": false,
    "mano derecha": false,
    "piernas y pies": false,
  });
  const modelViewerRef = useRef<ModelViewerElement | null>(null);
  const cameraButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const analyzing = analysisProcessState === "starting" || analysisProcessState === "running";
  const loadingDetail = detailState === "loading" || detailState === "retrying";

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
    () => [...rejectedEntries, ...acceptedEntries].sort(([firstName, first], [secondName, second]) => {
      const firstBlocking = first.blocking ?? !first.accepted ? 0 : 1;
      const secondBlocking = second.blocking ?? !second.accepted ? 0 : 1;
      return firstBlocking - secondBlocking || firstName.localeCompare(secondName);
    }),
    [acceptedEntries, rejectedEntries],
  );
  const groupedEntries = useMemo(() => {
    const groups = new Map<LandmarkGroup, [string, LandmarkRecord][]>(GROUP_ORDER.map((group) => [group, []]));
    for (const entry of selectableEntries) {
      const record = entry[1];
      const shouldShow = showAllTechnical
        || Boolean(record.blocking ?? !record.accepted)
        || Boolean(record.manualCorrectionRecommended || record.manual_verified);
      if (shouldShow) groups.get(landmarkGroup(entry[0]))?.push(entry);
    }
    return groups;
  }, [selectableEntries, showAllTechnical]);
  const pendingBreakdown = useMemo(() => GROUP_ORDER
    .map((group) => [group, groupedEntries.get(group)?.filter(([, record]) => record.blocking ?? !record.accepted).length ?? 0] as const)
    .filter(([, count]) => count > 0)
    .map(([group, count]) => `${count} en ${group}`)
    .join(" · "), [groupedEntries]);

  const effectiveSummary = detail?.summary || summary;
  const coverage = detail?.analysis.detectionCoverage || effectiveSummary?.detectionCoverage || {};
  const selectedRecord = landmarks[selectedName];
  const subsystems = Object.entries(detail?.analysis.bodySubsystems || {}) as [string, SubsystemRecord][];
  const warnings = detail?.analysis.warnings || [];
  const fallbackCenter = analysisCenter(detail);

  const viewerState = useMemo(() => {
    if (!effectiveSummary && analysisProcessState === "failed") {
      return { label: "ERROR DEL WORKER", className: styles.badgeError };
    }
    if (analysisProcessState === "starting" || analysisProcessState === "running") {
      return { label: "ANALIZANDO", className: styles.badgeNotice };
    }
    if (!effectiveSummary) return { label: "SIN ANALIZAR", className: styles.badgeEmpty };
    if (detailState === "temporarily_unavailable") {
      return { label: "DETALLE TEMPORALMENTE NO DISPONIBLE", className: styles.badgeNotice };
    }
    if (effectiveSummary.requestedProfileReady ?? effectiveSummary.rigReadinessApproved) {
      return {
        label: effectiveSummary.requestedRigProfile === "BODY_BASIC" ? "RIG CORPORAL LISTO" : "PERFIL SOLICITADO LISTO",
        className: styles.badgeApproved,
      };
    }
    if (effectiveSummary.status === "needs_review") {
      return { label: "NECESITA REVISIÓN", className: styles.badgePartial };
    }
    return { label: "ANÁLISIS PARCIAL", className: styles.badgePartial };
  }, [analysisProcessState, detailState, effectiveSummary]);

  const applyCamera = (orbit: string, target: string) => {
    setCameraOrbit(orbit);
    setCameraTargetValue(target);
    const updateViewer = () => {
      const viewer = modelViewerRef.current;
      if (!viewer) return;
      viewer.cameraOrbit = orbit;
      viewer.cameraTarget = target;
      viewer.fieldOfView = "32deg";
      viewer.setAttribute("camera-orbit", orbit);
      viewer.setAttribute("camera-target", target);
      viewer.setAttribute("field-of-view", "32deg");
      viewer.resetTurntableRotation?.();
      viewer.jumpCameraToGoal?.();
    };
    window.requestAnimationFrame(updateViewer);
    window.setTimeout(updateViewer, 90);
  };

  const applyPreset = (preset: CameraPreset) => {
    setActiveCamera(preset.label);
    applyCamera(preset.orbit, cameraTarget(landmarks, preset.targetLandmarks, fallbackCenter));
    window.setTimeout(() => {
      cameraButtonRefs.current[preset.label]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 0);
  };

  const resetCamera = () => applyPreset(CAMERA_PRESETS[0]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!previewUrl) return;
    const timer = window.setTimeout(resetCamera, 0);
    return () => window.clearTimeout(timer);
  }, [previewUrl, detail]);

  const selectLandmark = (
    name: string,
    source: Record<string, LandmarkRecord> = landmarks,
    focus = true,
  ) => {
    setSelectedName(name);
    const position = recordPosition(source[name]);
    setCorrection(position ? position.map((value) => String(value)) as [string, string, string] : ["", "", ""]);
    setCorrectionMessage(null);
    if (focus) {
      const group = landmarkGroup(name);
      const preset = groupPreset(group);
      applyCamera(preset.orbit, position ? targetValue(position) : cameraTarget(source, preset.targetLandmarks, fallbackCenter));
    }
  };

  const loadAsset = async (runId: string, accessToken: string) => {
    setAssetState("loading");
    try {
      const assetResponse = await fetch(
        `/api/avatar/analyze/result/${runId}/asset/diagnostic_landmarks.glb`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
      );
      if (!assetResponse.ok) throw new Error("El análisis terminó, pero no se pudo abrir su GLB diagnóstico.");
      const blob = await assetResponse.blob();
      if (blob.size < 1024) throw new Error("El diagnóstico llegó vacío.");
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
      setAssetState("ready");
      return true;
    } catch (cause) {
      setAssetState("failed");
      setTransportError(cause instanceof Error ? cause.message : "No se pudo recuperar el GLB diagnóstico.");
      return false;
    }
  };

  const loadDetail = async (runId: string, accessToken: string, manualRetry = false) => {
    setDetailState(manualRetry ? "retrying" : "loading");
    setPersistenceNotice(null);
    setDetailRetryCount(0);
    for (let attempt = 0; attempt < DETAIL_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`/api/avatar/analyze/result/${runId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json().catch(() => null) as AnalysisDetail | null;
          if (!data?.analysis || !data.summary) throw new Error("El diagnóstico llegó incompleto.");
          setDetail(data);
          setSummary(data.summary);
          setDetailState("ready");
          setTransportError(null);
          setPersistenceNotice(null);
          const firstBlocking = Object.keys(data.rejectedLandmarks || {})[0];
          if (firstBlocking) selectLandmark(firstBlocking, data.analysis.landmarks || {}, false);
          return true;
        }
        const apiError = await readApiError(response);
        const retryable = apiError.retryable || DETAIL_RETRYABLE_STATUSES.has(response.status);
        if (!retryable) {
          setDetailState("failed");
          setTransportError(apiError.error || "No se pudo leer el reporte anatómico.");
          return false;
        }
        setDetailState("retrying");
        setDetailRetryCount(attempt + 1);
        setPersistenceNotice(apiError.error || "El diagnóstico todavía se está guardando.");
        const retryAfter = Number(response.headers.get("retry-after"));
        const baseDelay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8000, 700 * (2 ** attempt));
        await wait(baseDelay + Math.round(Math.random() * 350));
      } catch (cause) {
        if (attempt === DETAIL_MAX_ATTEMPTS - 1) {
          setDetailState("temporarily_unavailable");
          setTransportError(cause instanceof Error ? cause.message : "No se pudo recuperar el detalle.");
          return false;
        }
        setDetailState("retrying");
        setDetailRetryCount(attempt + 1);
        await wait(Math.min(8000, 700 * (2 ** attempt)) + Math.round(Math.random() * 350));
      }
    }
    setDetailState("temporarily_unavailable");
    setPersistenceNotice("El análisis está completo, pero el detalle continúa temporalmente inaccesible.");
    return false;
  };

  const runJob = async (jobId: string, startedAt: number = Date.now()) => {
    if (!session?.access_token) return;
    saveActiveJob({ jobId, startedAt });
    setAnalysisProcessState("running");
    setWorkerErrorMessage(null);
    let terminal = false;
    try {
      const job = await pollAnalysisJob(jobId, session.access_token);
      if (job.status === "error" || !job.runId) {
        terminal = true;
        setAnalysisProcessState("failed");
        setWorkerErrorMessage(job.detail || "El Worker no pudo completar el análisis.");
        return;
      }
      terminal = true;
      setSummary(job.summary ?? null);
      setAnalysisProcessState("summary_ready");
      setCameraOrbit(CAMERA_PRESETS[0].orbit);
      setCameraTargetValue(targetValue(fallbackCenter));
      const [assetReady, detailReady] = await Promise.all([
        loadAsset(job.runId, session.access_token),
        loadDetail(job.runId, session.access_token),
      ]);
      if (job.summary || assetReady || detailReady) {
        setAnalysisProcessState("ready");
      } else {
        setAnalysisProcessState("failed");
        setWorkerErrorMessage("El proceso terminó sin un resultado utilizable.");
      }
    } finally {
      if (terminal) saveActiveJob(null);
    }
  };

  const analyze = async () => {
    if (!session?.access_token) return;
    setAnalysisProcessState("starting");
    setDetailState("idle");
    setAssetState("idle");
    setTransportError(null);
    setWorkerErrorMessage(null);
    setPersistenceNotice(null);
    setSummary(null);
    setDetail(null);
    setSelectedName("");
    setCorrectionMessage(null);
    setVisualCorrectionMode(false);
    try {
      const kickoff = await fetch("/api/avatar/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const kickoffData = await kickoff.json().catch(() => ({})) as {
        jobId?: string;
        pendingPersisted?: boolean;
        error?: string;
      };
      if (!kickoff.ok || !kickoffData.jobId) {
        throw new Error(kickoffData.error || `No se pudo iniciar el análisis (${kickoff.status}).`);
      }
      if (kickoffData.pendingPersisted === false) {
        setPersistenceNotice("El job quedó guardado en este dispositivo, pero Supabase no confirmó todavía la recuperación entre dispositivos.");
      }
      await runJob(kickoffData.jobId);
    } catch (cause) {
      console.error("Avatar Analyzer UI failed", cause);
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo analizar el avatar.");
    }
  };

  const resumeAttemptedRef = useRef(false);
  useEffect(() => {
    if (resumeAttemptedRef.current) return;
    if (authLoading || !session?.access_token) return;
    resumeAttemptedRef.current = true;
    const pending = loadActiveJob();
    if (!pending) return;
    if (Date.now() - pending.startedAt >= JOB_POLL_TIMEOUT_MS) return;
    void runJob(pending.jobId, pending.startedAt).catch((cause) => {
      console.error("Avatar Analyzer resume failed", cause);
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo retomar el análisis anterior.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session?.access_token]);

  const restoreLatest = async () => {
    if (!session?.access_token) return;
    setRestoringLatest(true);
    setTransportError(null);
    setWorkerErrorMessage(null);
    try {
      const authorization = { Authorization: `Bearer ${session.access_token}` };
      const latestResponse = await fetch("/api/avatar/analyze/latest", {
        headers: authorization,
        cache: "no-store",
      });
      const latest = await latestResponse.json() as {
        available?: boolean;
        pending?: boolean;
        runId?: string;
        jobId?: string;
        startedAt?: string;
        pendingStatus?: string;
        pendingError?: string;
        summary?: AnalysisSummary;
        error?: string;
      };
      if (!latestResponse.ok) throw new Error(latest.error || "No se pudo buscar el último análisis.");
      if (latest.pending && latest.jobId) {
        if (latest.pendingStatus === "error") {
          setAnalysisProcessState("failed");
          setWorkerErrorMessage(latest.pendingError || "El último job terminó con error.");
          return;
        }
        const startedAt = latest.startedAt ? Date.parse(latest.startedAt) : Date.now();
        setPersistenceNotice("Se recuperó un análisis pendiente desde Supabase.");
        await runJob(latest.jobId, Number.isFinite(startedAt) ? startedAt : Date.now());
        return;
      }
      if (!latest.available || !latest.runId) {
        throw new Error("Este avatar todavía no tiene un análisis V4.1 guardado.");
      }
      setSummary(latest.summary ?? null);
      setAnalysisProcessState("summary_ready");
      const [assetReady, detailReady] = await Promise.all([
        loadAsset(latest.runId, session.access_token),
        loadDetail(latest.runId, session.access_token),
      ]);
      setAnalysisProcessState(assetReady || detailReady ? "ready" : "failed");
    } catch (cause) {
      setAnalysisProcessState("failed");
      setWorkerErrorMessage(cause instanceof Error ? cause.message : "No se pudo abrir el último análisis.");
    } finally {
      setRestoringLatest(false);
    }
  };

  const retryDetail = () => {
    if (!effectiveSummary?.runId || !session?.access_token) return;
    void loadDetail(effectiveSummary.runId, session.access_token, true);
  };

  const pickSurfacePoint = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!visualCorrectionMode || !selectedName) return;
    const result = modelViewerRef.current?.positionAndNormalFromPoint?.(event.clientX, event.clientY);
    const position = result?.position;
    if (!position) {
      setCorrectionMessage("No se encontró superficie en ese punto. Girá el avatar y tocá directamente sobre la región.");
      return;
    }
    setCorrection([String(position.x), String(position.y), String(position.z)]);
    setCorrectionMessage(`Punto visual seleccionado para ${readableName(selectedName)}. Guardalo para registrarlo como corrección manual.`);
    setVisualCorrectionMode(false);
  };

  const saveCorrection = async () => {
    if (!effectiveSummary?.runId || !session?.access_token || !selectedName) return;
    const parsed = correction.map(Number);
    if (parsed.some((value) => !Number.isFinite(value))) {
      setCorrectionMessage("Ingresá tres coordenadas numéricas válidas o seleccioná el punto sobre el avatar.");
      return;
    }
    setSavingCorrection(true);
    setCorrectionMessage(null);
    try {
      const response = await fetch(
        `/api/avatar/analyze/result/${effectiveSummary.runId}/corrections`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requested_rig_profile: "BODY_BASIC",
            corrections: [{
              name: selectedName,
              surface_click: parsed,
              proposed_internal_position: parsed,
              approved: true,
              note: "Corrección manual desde Biblioteca CLOUVA",
            }],
          }),
        },
      );
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la corrección.");
      setCorrectionMessage("Corrección guardada por separado. El análisis automático original no fue modificado.");
    } catch (cause) {
      setCorrectionMessage(cause instanceof Error ? cause.message : "No se pudo guardar la corrección.");
    } finally {
      setSavingCorrection(false);
    }
  };

  const evidenceUrl = (name: string) => {
    if (!effectiveSummary?.runId) return null;
    const group = landmarkGroup(name);
    const token = renderToken(group);
    if (!token) return null;
    const path = (detail?.assets?.renders || []).find((asset) =>
      asset.includes(token) && asset.endsWith(".png") && !asset.includes("_edges") && !asset.includes("silhouette"),
    );
    if (!path) return null;
    return `/api/avatar/analyze/result/${effectiveSummary.runId}/asset/${path}`;
  };

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

  const verified = effectiveSummary?.verifiedLandmarkCount
    ?? effectiveSummary?.verifiedSurfaceLandmarkCount
    ?? effectiveSummary?.landmarkCount
    ?? 0;

  return (
    <section id="avatar-analyzer" className={styles.card} aria-label="Avatar Analyzer CLOUVA">
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.icon}><BrainCircuit /></span>
        <div>
          <small>BLENDER WORKER · AVATAR ANALYZER V4.1</small>
          <h2>Avatar Analyzer V4.1</h2>
          <p>Normaliza una copia temporal, valida cada región y bloquea el AutoRig cuando falta evidencia confiable.</p>
        </div>
      </header>

      {previewUrl ? (
        <>
          <div
            className={`${styles.viewer} ${visualCorrectionMode ? styles.viewerPicking : ""}`}
            onClick={pickSurfacePoint}
          >
            {createElement("model-viewer", {
              ref: (node: Element | null) => {
                modelViewerRef.current = node as ModelViewerElement | null;
              },
              className: styles.model,
              src: previewUrl,
              alt: "Avatar CLOUVA con diagnóstico anatómico",
              "camera-controls": true,
              "camera-orbit": cameraOrbit,
              "camera-target": cameraTargetValue,
              "field-of-view": "32deg",
              "min-camera-orbit": "auto 35deg 18%",
              "max-camera-orbit": "auto 105deg 180%",
              "interaction-prompt": "none",
              "shadow-intensity": "1",
              exposure: "1",
            })}
            <span className={`${styles.viewerBadge} ${viewerState.className}`}>{viewerState.label}</span>
            {visualCorrectionMode ? <span className={styles.pickHint}>TOCÁ LA SUPERFICIE CORRECTA</span> : null}
          </div>
          <div className={styles.cameraBar} aria-label="Vistas del diagnóstico">
            {CAMERA_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.label}
                ref={(node) => { cameraButtonRefs.current[preset.label] = node; }}
                className={activeCamera === preset.label ? styles.cameraActive : undefined}
                aria-pressed={activeCamera === preset.label}
                onClick={() => applyPreset(preset)}
              >
                {preset.icon === "face" ? <Eye /> : preset.icon === "hand" ? <Hand /> : null}
                {preset.label}
              </button>
            ))}
            <button type="button" onClick={resetCamera}><RotateCcw /> Restablecer cámara</button>
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <BrainCircuit />
          <strong>Diagnóstico visual todavía no ejecutado</strong>
          <span>El GLB original se analiza en una escena limpia y temporal. El rig oficial no se modifica.</span>
        </div>
      )}

      {effectiveSummary ? (
        <>
          <div className={styles.primarySummary}>
            <div><span>Perfil solicitado</span><strong>{effectiveSummary.requestedRigProfile || "BODY_BASIC"}</strong></div>
            <div className={(effectiveSummary.requestedProfileReady ?? effectiveSummary.rigReadinessApproved) ? styles.metricApproved : styles.metricBlocked}>
              <span>Estado del perfil</span>
              <strong>{(effectiveSummary.requestedProfileReady ?? effectiveSummary.rigReadinessApproved) ? "Listo para rig corporal" : "Bloqueado"}</strong>
            </div>
            <div><span>Confianza del cuerpo base</span><strong>{percent(effectiveSummary.bodyBaseConfidence ?? effectiveSummary.humanoidConfidence)}</strong></div>
            <div className={(effectiveSummary.requestedProfileReady ?? effectiveSummary.rigReadinessApproved) ? styles.metricApproved : styles.metricBlocked}>
              <span>Preparación para el perfil</span><strong>{percent(effectiveSummary.rigReadinessScore)}</strong>
            </div>
          </div>
          <div className={styles.profileStatusLine}>
            <strong>{effectiveSummary.bodyRigReady ? "Cuerpo válido" : "Cuerpo pendiente"}</strong>
            <span>
              {effectiveSummary.faceAnalysisReady && effectiveSummary.leftFingerRigReady && effectiveSummary.rightFingerRigReady
                ? "Análisis avanzado completo"
                : "Rig corporal disponible · análisis avanzado pendiente"}
            </span>
            <small>{verified} puntos verificados</small>
          </div>
          <details className={styles.technicalDetails}>
            <summary>VER DIAGNÓSTICO TÉCNICO</summary>
            <div className={styles.technicalGrid}>
              <div><span>Landmarks sin evidencia visual</span><strong>{effectiveSummary.noVisualEvidenceCount ?? 0} landmarks</strong></div>
              <div><span>Landmarks con vistas insuficientes</span><strong>{effectiveSummary.insufficientViewsCount ?? 0} landmarks</strong></div>
              <div><span>Incompatibilidades visuales/técnicas</span><strong>{effectiveSummary.technicalMismatchCount ?? 0} landmarks</strong></div>
              <div><span>Landmarks con topología inválida</span><strong>{effectiveSummary.topologyInvalidCount ?? 0} landmarks</strong></div>
              <div><span>Articulaciones internas calculadas</span><strong>{effectiveSummary.internalJointCount ?? 0} articulaciones</strong></div>
            </div>
            <p className={styles.metricExplanation}>
              La confianza corporal mide el cuerpo base. La preparación para rig aplica además los gates bloqueantes.
              La cobertura geométrica puede ser alta aunque el detector visual no reconozca una región en sus vistas.
              0/7 vistas significa que el detector no reconoció esa región en ninguna de las siete cámaras renderizadas.
            </p>
          </details>

          <div className={styles.coverageGrid}>
            {([
              ["Rostro", coverage.face],
              ["Mano izquierda", coverage.leftHand],
              ["Mano derecha", coverage.rightHand],
            ] as const).map(([label, record]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{compactCoverage(record)}</strong>
                <small>
                  Detectadas {record?.detectorSuccessfulViews ?? 0}/{record?.renderedViews ?? 0} · Proyectadas {record?.projectedSuccessfulViews ?? 0}
                </small>
                <small>Visual {percent(record?.visualCoverage)} · Geométrica {percent(record?.geometricCoverage)}</small>
              </article>
            ))}
          </div>

          {!(effectiveSummary.requestedProfileReady ?? effectiveSummary.rigReadinessApproved) ? (
            <p className={styles.error}>
              <TriangleAlert />
              <span>
                El perfil solicitado está bloqueado hasta verificar sus requisitos anatómicos.
                {pendingBreakdown ? ` Pendientes: ${pendingBreakdown}.` : ""}
                {(effectiveSummary.rigReadinessGates || []).length
                  ? ` Bloqueos: ${(effectiveSummary.rigReadinessGates || []).map(readableName).join(", ")}.`
                  : ""}
                {recommendedActionLabel(effectiveSummary.recommendedNextAction)
                  ? ` Próxima acción: ${recommendedActionLabel(effectiveSummary.recommendedNextAction)}.`
                  : ""}
              </span>
            </p>
          ) : (
            <p className={styles.success}>
              <CheckCircle2 />
              {(effectiveSummary.advancedAnalysisWarnings || []).length
                ? "Rig corporal disponible · análisis avanzado pendiente."
                : "Mapa anatómico aprobado para el AutoRig del mismo archivo fuente."}
            </p>
          )}
        </>
      ) : null}

      {loadingDetail ? (
        <div className={styles.processing}><Loader2 className={styles.spin} /><p>Cargando cobertura, estados y motivos exactos… Reintentos: {detailRetryCount}</p></div>
      ) : null}

      {detailState === "temporarily_unavailable" ? (
        <div className={styles.detailNotice}>
          <div><strong>DETALLE TEMPORALMENTE NO DISPONIBLE</strong><span>El resultado anatómico y el GLB se conservan. No hace falta volver a ejecutar Blender.</span></div>
          <button type="button" onClick={retryDetail}>REINTENTAR CARGA DEL DETALLE</button>
        </div>
      ) : null}

      {analysisProcessState !== "idle" || effectiveSummary ? (
        <section className={styles.systemHealth} aria-label="Salud del sistema del Analyzer">
          <div><span>Worker</span><strong>{analysisProcessState === "failed" ? "Error" : "Disponible"}</strong></div>
          <div><span>Proceso</span><strong>{processStateLabel(analysisProcessState)}</strong></div>
          <div><span>Resultado persistido</span><strong>{effectiveSummary ? "Sí" : analysisProcessState === "running" ? "En proceso" : "No"}</strong></div>
          <div><span>Detalle</span><strong>{detailStateLabel(detailState)}</strong></div>
          <div><span>GLB diagnóstico</span><strong>{assetStateLabel(assetState)}</strong></div>
          <div><span>Reintentos</span><strong>{detailRetryCount}</strong></div>
        </section>
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
              <div><small>EVIDENCIA</small><h3>Dónde falló el proceso</h3></div>
              <span>{warnings.length}</span>
            </div>
            <div className={styles.warningList}>
              {warnings.length ? warnings.slice(0, 80).map((warning, index) => {
                const target = String(warning.landmark || warning.name || "");
                return (
                  <button
                    type="button"
                    key={`${warning.code || "warning"}-${warning.side || ""}-${warning.finger || ""}-${target}-${index}`}
                    onClick={() => target && selectLandmark(target)}
                    disabled={!target}
                  >
                    <TriangleAlert />
                    <span><strong>{warningDescription(warning)}</strong><small>{warningKind(warning)}</small></span>
                  </button>
                );
              }) : <p className={styles.muted}>No hay advertencias registradas.</p>}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.widePanel}`}>
            <div className={styles.panelHeader}>
              <div><small>LANDMARKS</small><h3>Evidencia anatómica</h3></div>
              <span>{selectableEntries.length}</span>
            </div>

            <div className={styles.desktopTable}>
              <div className={styles.landmarkTableWrap}>
                <table className={styles.landmarkTable}>
                  <thead>
                    <tr><th>Landmark</th><th>Región</th><th>Estado</th><th>Confianza real</th><th>Vistas</th><th>Etapa</th><th>Motivo</th></tr>
                  </thead>
                  <tbody>
                    {selectableEntries.slice(0, 180).map(([name, record]) => (
                      <tr key={name} className={selectedName === name ? styles.selectedRow : undefined} onClick={() => selectLandmark(name)}>
                        <td>{readableName(name)}</td>
                        <td>{readableName(record.region || "unknown")}</td>
                        <td>{stateLabel(record)}</td>
                        <td>{percent(confidenceOf(record))}</td>
                        <td>{record.viewsConfirmed ?? 0}</td>
                        <td>{record.failureStage ? (FAILURE_LABELS[record.failureStage] || readableName(record.failureStage)) : "—"}</td>
                        <td>{(record.rejectionReasons || []).map(readableName).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.technicalToggleRow}>
              <button type="button" onClick={() => setShowAllTechnical((current) => !current)}>
                {showAllTechnical ? "OCULTAR PUNTOS INTERNOS APROBADOS" : "MOSTRAR TODOS LOS PUNTOS TÉCNICOS"}
              </button>
            </div>
            <div className={styles.mobileLandmarks}>
              {GROUP_ORDER.map((group) => {
                const entries = groupedEntries.get(group) || [];
                const pending = entries.filter(([, record]) => record.blocking ?? !record.accepted).length;
                return (
                  <section key={group} className={styles.landmarkGroup}>
                    <button
                      type="button"
                      className={styles.groupToggle}
                      onClick={() => setOpenGroups((current) => ({ ...current, [group]: !current[group] }))}
                    >
                      <span><strong>{readableName(group)}</strong><small>{entries.length} puntos · {pending} pendientes</small></span>
                      <ChevronDown className={openGroups[group] ? styles.chevronOpen : undefined} />
                    </button>
                    {openGroups[group] ? (
                      <div className={styles.landmarkCards}>
                        {entries.map(([name, record]) => {
                          const evidence = evidenceUrl(name);
                          return (
                            <article key={name} className={selectedName === name ? styles.selectedCard : undefined}>
                              <button type="button" className={styles.cardSelect} onClick={() => selectLandmark(name)}>
                                <span><strong>{readableName(name)}</strong><small>{readableName(record.region || "unknown")}</small></span>
                                <span className={styles.statePill} data-state={record.state || "unknown"}>{stateLabel(record)}</span>
                              </button>
                              <div className={styles.cardMetrics}>
                                <span>Confianza <strong>{percent(confidenceOf(record))}</strong></span>
                                <span>Vistas <strong>{record.requiresVisualViews === false ? "No requiere" : (record.viewsConfirmed ?? 0)}</strong></span>
                                <span>Etapa <strong>{record.requiresVisualViews === false ? "Geometría interna" : record.failureStage ? (FAILURE_LABELS[record.failureStage] || readableName(record.failureStage)) : "Completada"}</strong></span>
                              </div>
                              <p>{(record.rejectionReasons || []).map(readableName).join(", ") || "Sin motivos de rechazo."}</p>
                              <div className={styles.cardActions}>
                                {(record.blocking ?? !record.accepted) && (record.requiresVisualViews !== false || record.manualCorrectionRecommended) ? (
                                  <button type="button" onClick={() => selectLandmark(name)}><Crosshair /> Corregir</button>
                                ) : null}
                                {evidence ? <a href={evidence} target="_blank" rel="noreferrer"><ExternalLink /> Ver evidencia</a> : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </section>

          <section className={`${styles.panel} ${styles.widePanel}`}>
            <div className={styles.panelHeader}>
              <div><small>CORRECCIÓN MANUAL</small><h3>Corregir análisis</h3></div>
              <span>NO MODIFICA EL ORIGINAL</span>
            </div>
            <div className={styles.correctionTools}>
              <button
                type="button"
                className={visualCorrectionMode ? styles.pickActive : undefined}
                disabled={!selectedName || !previewUrl}
                onClick={() => setVisualCorrectionMode((current) => !current)}
              >
                <Crosshair /> {visualCorrectionMode ? "Cancelar selección" : "Seleccionar sobre el avatar"}
              </button>
              <small>Elegí un landmark, activá la selección y tocá la superficie correcta en el visor.</small>
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
                <div><span>Estado</span><strong>{stateLabel(selectedRecord)}</strong></div>
                <div><span>Región</span><strong>{readableName(selectedRecord.region || "unknown")}</strong></div>
                <div><span>Confianza real</span><strong>{percent(confidenceOf(selectedRecord))}</strong></div>
                <div><span>Vistas</span><strong>{selectedRecord.viewsConfirmed ?? 0}</strong></div>
                <div><span>Inliers</span><strong>{selectedRecord.triangulationInliers ?? 0}</strong></div>
                <div><span>Etapa fallida</span><strong>{selectedRecord.failureStage ? (FAILURE_LABELS[selectedRecord.failureStage] || readableName(selectedRecord.failureStage)) : "—"}</strong></div>
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
        {analyzing ? "ANALIZANDO ORIENTACIÓN, BVH, TOPOLOGÍA Y COBERTURA…" : previewUrl ? "VOLVER A ANALIZAR" : "ANALIZAR AVATAR"}
      </button>

      <div className={styles.secondaryActions}>
        <button
          type="button"
          onClick={() => void restoreLatest()}
          disabled={restoringLatest || analyzing || !session?.access_token}
        >
          {restoringLatest ? <Loader2 className={styles.spin} /> : <RotateCcw />}
          {restoringLatest ? "ABRIENDO ÚLTIMO ANÁLISIS…" : "ABRIR ÚLTIMO ANÁLISIS"}
        </button>
        {effectiveSummary?.runId ? (
          <Link href={`/avatar-analyzer-v4/${effectiveSummary.runId}`}>
            <ExternalLink />
            ABRIR VISUALIZER PROFESIONAL
          </Link>
        ) : null}
      </div>

      {analyzing ? (
        <div className={styles.processing}>
          <span />
          <p>Blender analiza una copia canónica, crea dos pasadas regionales y no genera el rig hasta aprobar el mapa anatómico.</p>
        </div>
      ) : null}

      {persistenceNotice ? <p className={styles.notice}><Loader2 className={loadingDetail ? styles.spin : undefined} /> {persistenceNotice}</p> : null}
      {transportError ? <p className={styles.transportError}><TriangleAlert /> {transportError}</p> : null}
      {workerErrorMessage ? <p className={styles.error}><TriangleAlert /> {workerErrorMessage}</p> : null}
    </section>
  );
}
