import type { LandmarkRecord, StageKey } from "./types";

export { STAGE_ORDER } from "./types";
export type { StageKey } from "./types";

/**
 * Helpers puros y testeables (node --test) para el laboratorio holográfico
 * del Avatar Analyzer. Ninguno inventa un significado nuevo: cada campo que
 * leen ya existe en el contrato del worker (analyzer_v4_contract.py,
 * body_analyzer.py, hand_analyzer.py, face_analyzer.py). Ver
 * C:\Users\CLV\.claude\plans\lovely-twirling-dongarra.md para el contexto.
 */

function toVector3(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === 3 ? value.map(Number) : null;
}

/** Posición de superficie: nunca cae a `internalJointPosition`, para no
 * confundir un punto de piel con una articulación calculada. */
export function getSurfacePosition(record?: LandmarkRecord): number[] | null {
  return toVector3(record?.surfaceDisplayPosition)
    ?? toVector3(record?.displayPosition)
    ?? toVector3(record?.position);
}

/** Posición de articulación interna: solo `internalJointPosition`. */
export function getInternalPosition(record?: LandmarkRecord): number[] | null {
  return toVector3(record?.internalJointPosition);
}

export type LandmarkType = "surface" | "internal_joint";

/** Usa el campo canónico `landmarkType` que ya envía el worker. Los valores
 * `"surface"`/`"surface_landmark"` (y cualquier valor ausente/desconocido)
 * se tratan como superficie; `"internal_joint"`/`"derived_internal"` como
 * articulación interna. */
export function getLandmarkType(record?: LandmarkRecord): LandmarkType {
  const raw = record?.landmarkType;
  if (raw === "internal_joint" || raw === "derived_internal") return "internal_joint";
  return "surface";
}

/** Posición a usar para dibujar el marcador 3D del landmark, respetando su
 * tipo (nunca mezcla superficie con articulación interna como fallback
 * primario -- solo cae a la otra posición si la propia de su tipo falta). */
export function getLandmarkPosition(record?: LandmarkRecord): number[] | null {
  if (getLandmarkType(record) === "internal_joint") {
    return getInternalPosition(record) ?? getSurfacePosition(record);
  }
  return getSurfacePosition(record) ?? getInternalPosition(record);
}

export type LandmarkVisualState =
  | "verified_surface"
  | "internal_joint"
  | "needs_review"
  | "blocked"
  | "selected"
  | "informational";

const NEEDS_REVIEW_STATES = new Set([
  "low_confidence",
  "insufficient_views",
  "manual_review_required",
  "no_visual_evidence",
  "technical_mismatch",
  "projection_mismatch",
]);

/** Estado visual (uno de los 6 colores del laboratorio). Prioriza:
 * seleccionado > bloqueante > revisión recomendada > articulación interna >
 * verificado > informativo. */
export function getLandmarkVisualState(record: LandmarkRecord | undefined, isSelected = false): LandmarkVisualState {
  if (isSelected) return "selected";
  if (!record) return "informational";
  const blocking = record.blocking ?? !record.accepted;
  if (blocking) return "blocked";
  if (NEEDS_REVIEW_STATES.has(record.state ?? "")) return "needs_review";
  if (getLandmarkType(record) === "internal_joint") return "internal_joint";
  return "verified_surface";
}

export const VISUAL_STATE_LEGEND: Record<LandmarkVisualState, { color: string; label: string; shape: "circle" | "diamond" | "triangle" | "square" | "ring" | "dot" }> = {
  verified_surface: { color: "#3ddc84", label: "Superficie aprobada y verificada", shape: "circle" },
  internal_joint: { color: "#4fb8ff", label: "Articulación interna calculada", shape: "diamond" },
  needs_review: { color: "#f5c542", label: "Confianza baja o revisión recomendada", shape: "triangle" },
  blocked: { color: "#ff4d5e", label: "Rechazado / bloqueante", shape: "square" },
  selected: { color: "#b47bff", label: "Seleccionado", shape: "ring" },
  informational: { color: "#9aa0ac", label: "Informativo, no bloqueante", shape: "dot" },
};

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

export function readableName(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\bl\b/g, "izquierda")
    .replace(/\br\b/g, "derecha")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function stateLabel(record?: LandmarkRecord): string {
  if (!record) return "Sin datos";
  const state = record.state || (record.accepted ? "verified" : "low_confidence");
  return STATE_LABELS[state] || readableName(state);
}

export function failureStageLabel(stage?: string | null): string {
  if (!stage) return "—";
  return FAILURE_LABELS[stage] || readableName(stage);
}

export function confidenceOf(record?: LandmarkRecord): number {
  return Number(record?.rawConfidence ?? record?.finalConfidence ?? record?.confidence ?? 0);
}

export function percent(value?: number): string {
  return `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
}

export function numberLabel(value?: number): string {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "—";
}

export function vectorLabel(value?: number[] | null): string {
  return Array.isArray(value) && value.length
    ? value.map((part) => Number(part).toFixed(3)).join(", ")
    : "—";
}

/** Misma clasificación por nombre que usaba AvatarAnalyzerPreview.tsx
 * (landmarkGroup) -- se centraliza acá porque ahora la necesitan tanto el
 * viewer 3D como las estadísticas por región y el wizard. */
export function landmarkGroup(name: string): StageKey {
  const normalized = name.toLowerCase();
  if (/^(brow|eye|nose|mouth|lip|chin|jaw|cheek|forehead|temple|ear)_/.test(normalized)) return "rostro";
  if (normalized.endsWith("_l") && /^(thumb|index|middle|ring|pinky|palm|wrist)_/.test(normalized)) return "mano izquierda";
  if (normalized.endsWith("_r") && /^(thumb|index|middle|ring|pinky|palm|wrist)_/.test(normalized)) return "mano derecha";
  if (/^(hip|thigh|knee|calf|ankle|foot|ball)_/.test(normalized)) return "piernas y pies";
  return "cuerpo";
}

export type RegionStats = {
  total: number;
  verified: number;
  pending: number;
  blocking: number;
  informational: number;
  internal: number;
  surface: number;
};

function emptyStats(): RegionStats {
  return { total: 0, verified: 0, pending: 0, blocking: 0, informational: 0, internal: 0, surface: 0 };
}

/** Conteo real por región: recorre TODOS los landmarks recibidos, nunca una
 * lista ya filtrada por la UI -- así "9 puntos - 9 pendientes" no puede
 * convivir con "37 verificados" en otro panel: son la misma fuente. */
export function getRegionStats(landmarks: Record<string, LandmarkRecord> | undefined): Record<StageKey, RegionStats> {
  const stats = {
    cuerpo: emptyStats(),
    rostro: emptyStats(),
    "mano izquierda": emptyStats(),
    "mano derecha": emptyStats(),
    "piernas y pies": emptyStats(),
  } as Record<StageKey, RegionStats>;
  for (const [name, record] of Object.entries(landmarks ?? {})) {
    const bucket = stats[landmarkGroup(name)];
    bucket.total += 1;
    if (getLandmarkType(record) === "internal_joint") bucket.internal += 1;
    else bucket.surface += 1;
    const state = getLandmarkVisualState(record);
    if (state === "blocked") bucket.blocking += 1;
    else if (state === "needs_review") bucket.pending += 1;
    else if (state === "informational") bucket.informational += 1;
    else bucket.verified += 1;
  }
  return stats;
}

/** Mapa cerrado de códigos técnicos ya vistos en el contrato
 * (analyzer_v4_contract.py: recommended_next_action). Cualquier código no
 * mapeado cae a una versión legible del código crudo -- nunca se rompe con
 * un código nuevo. */
const ACTION_LABELS: Record<string, string> = {
  continue_with_BODY_BASIC_or_reanalyze_optional_modules:
    "Continuar con rig corporal básico o revisar rostro y manos",
  continue_with_BODY_HANDS_BASIC: "Continuar con cuerpo y manos simplificadas",
  continue_with_BODY_BASIC: "Continuar solo con rig corporal básico",
  reanalyze_face: "Volver a analizar solamente el rostro",
  reanalyze_left_hand: "Volver a analizar solamente la mano izquierda",
  reanalyze_right_hand: "Volver a analizar solamente la mano derecha",
  reanalyze_hands: "Volver a analizar ambas manos",
};

export function getHumanRecommendedAction(value?: string | Record<string, unknown> | null): string {
  if (typeof value === "string" && value.trim()) {
    const code = value.trim();
    return ACTION_LABELS[code] ?? readableName(code);
  }
  if (value && typeof value === "object") {
    for (const key of ["message", "action", "operation", "label", "reason"]) {
      const candidate = (value as Record<string, unknown>)[key];
      if (typeof candidate === "string" && candidate.trim()) return getHumanRecommendedAction(candidate);
    }
  }
  return "";
}

export type BoundingBox = { min: number[]; max: number[] };

/** Bbox real para encuadrar la cámara: cuerpo completo usa
 * dimensions.boundingBoxMin/Max (ya calculado por el worker); rostro/manos
 * usan el min/max real de las posiciones de sus propios landmarks. Nunca
 * devuelve un valor si no hay datos reales (la UI debe mostrar un fallback
 * explícito, no un encuadre inventado). */
export function computeStageBoundingBox(
  landmarks: Record<string, LandmarkRecord> | undefined,
  stage: StageKey,
  fallbackDimensions?: { boundingBoxMin?: number[]; boundingBoxMax?: number[] },
): BoundingBox | null {
  const wholeBodyFallback = toVector3(fallbackDimensions?.boundingBoxMin) && toVector3(fallbackDimensions?.boundingBoxMax)
    ? { min: toVector3(fallbackDimensions!.boundingBoxMin)!, max: toVector3(fallbackDimensions!.boundingBoxMax)! }
    : null;
  if (stage === "cuerpo" && wholeBodyFallback) return wholeBodyFallback;

  const positions = Object.entries(landmarks ?? {})
    .filter(([name]) => landmarkGroup(name) === stage)
    .map(([, record]) => getLandmarkPosition(record))
    .filter((position): position is number[] => Boolean(position));

  if (!positions.length) return wholeBodyFallback;

  const min = [0, 1, 2].map((axis) => Math.min(...positions.map((position) => position[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...positions.map((position) => position[axis])));
  return { min, max };
}

/** Distancia de cámara (perspectiva vertical `verticalFovDeg`) para que la
 * altura del bbox ocupe `fillRatio` del alto útil del visor. Reemplaza los
 * porcentajes fijos (115%/40%/29%) que no escalaban entre avatares. */
export function frameCameraDistance(bbox: BoundingBox, verticalFovDeg: number, fillRatio: number): number {
  const height = Math.max(bbox.max[1] - bbox.min[1], 0.05);
  const fovRad = (verticalFovDeg * Math.PI) / 180;
  return (height / Math.max(fillRatio, 0.01)) / (2 * Math.tan(fovRad / 2));
}

export function boundingBoxCenter(bbox: BoundingBox): number[] {
  return [0, 1, 2].map((axis) => (bbox.min[axis] + bbox.max[axis]) / 2);
}

/** Rango de encuadre pedido: cuerpo completo 70-85% del alto útil,
 * rostro/manos 45-70%. Se usa el punto medio de cada rango como objetivo. */
export const STAGE_FILL_RATIO: Record<StageKey, number> = {
  cuerpo: 0.77,
  "piernas y pies": 0.77,
  rostro: 0.58,
  "mano izquierda": 0.58,
  "mano derecha": 0.58,
};
