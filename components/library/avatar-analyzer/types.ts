export type CoverageRecord = {
  expectedViews?: number;
  renderedViews?: number;
  framingValidViews?: number;
  framingInvalidViews?: number;
  detectorExecutedViews?: number;
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
  rendererStatus?: string;
  framingStatus?: string;
  detectorStatus?: string;
  evidenceStatus?: string;
  geometryLimited?: boolean;
  geometryLimitReason?: string;
  maximumHonestProfile?: string;
  handMode?: string;
};

export type DetectionCoverage = {
  face?: CoverageRecord;
  leftHand?: CoverageRecord;
  rightHand?: CoverageRecord;
};

export type AnalysisSummary = {
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

export type WarningRecord = {
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

/** `landmarkType` es un campo canónico que ya envía el worker
 * (hand_analyzer.py, face_analyzer.py, avatar_analyzer.py): distingue un
 * punto de superficie de una articulación interna calculada. No es una
 * heurística nueva -- solo faltaba declararlo en este tipo. */
export type LandmarkRecord = {
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
  landmarkType?: "surface" | "surface_landmark" | "internal_joint" | "derived_internal" | string;
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

export type SubsystemRecord = {
  status?: string;
  required?: string[];
  missingOrInvalid?: string[];
  blockingWarnings?: WarningRecord[];
  nonBlockingWarnings?: WarningRecord[];
};

export type AnalysisPayload = {
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

export type AnalysisDetail = {
  summary: AnalysisSummary;
  analysis: AnalysisPayload;
  acceptedLandmarks?: Record<string, LandmarkRecord>;
  rejectedLandmarks?: Record<string, LandmarkRecord>;
  corrections?: unknown;
  assets?: {
    surfaceGlb?: string;
    sourceGlb?: string;
    diagnosticGlb?: string;
    renders?: string[];
  };
};

export type JobStatus = {
  status: "pending" | "done" | "error" | "cancelled";
  runId?: string;
  summary?: AnalysisSummary;
  detail?: string;
  phase?: string;
  progress?: number;
};

/** Etapas del wizard. "piernas y pies" queda agrupada bajo "cuerpo" en el
 * stepper (Avatar asignado -> Cuerpo -> Manos -> Cara -> Big Data -> Revisión
 * -> Confirmación) pero se mantiene como bucket propio en las estadísticas
 * por región porque el backend ya distingue esos landmarks. */
export type StageKey = "cuerpo" | "rostro" | "mano izquierda" | "mano derecha" | "piernas y pies";

export const STAGE_ORDER: StageKey[] = [
  "cuerpo",
  "rostro",
  "mano izquierda",
  "mano derecha",
  "piernas y pies",
];

/** Identidad real del avatar activo, resuelta server-side por
 * resolveOriginalAvatar()/buildAssignedAvatarInfo() -- nunca "CLOUVA"
 * hardcodeado en el cliente. */
export type AssignedAvatarInfo = {
  avatarId: string | null;
  name: string | null;
  glbPath: string | null;
  rigStatus: string | null;
  updatedAt: string | null;
  source: string | null;
};

export type LatestAnalysisInfo = {
  available?: boolean;
  pending?: boolean;
  avatar?: AssignedAvatarInfo | null;
  runId?: string;
  jobId?: string;
  startedAt?: string;
  pendingStatus?: string;
  pendingError?: string;
  status?: string;
  updatedAt?: string;
  summary?: AnalysisSummary;
  error?: string;
};
