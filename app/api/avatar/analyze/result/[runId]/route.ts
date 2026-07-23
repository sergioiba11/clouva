import { NextRequest, NextResponse } from "next/server";
import {
  avatarAnalyzerError,
  fetchAvatarAnalyzerWorker,
  requireAvatarAnalyzerUser,
  safeAnalyzerRunId,
} from "@/lib/avatar-analyzer-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

const WARNING_MESSAGES: Record<string, string> = {
  FACE_NOT_DETECTED: "El detector visual no reconoció el rostro en las vistas técnicas.",
  HAND_NOT_DETECTED: "El detector visual no reconoció la mano en las vistas técnicas.",
  BODY_INTERNAL_JOINT_OUTSIDE_REGION: "La articulación interna quedó fuera de la región anatómica esperada.",
  BODY_JOINT_CONFIDENCE_LOW: "La articulación corporal no alcanzó la confianza mínima.",
  ANATOMY_REGIONS_INSUFFICIENT: "La segmentación no reunió suficiente geometría en algunas regiones anatómicas.",
  LANDMARK_TECHNICAL_PASS_MISMATCH: "La evidencia visual y los pases técnicos no coincidieron para este landmark.",
  LANDMARK_REGION_BVH_MISS: "El rayo del landmark no impactó la región anatómica esperada.",
  FACE_REQUIRED_LANDMARKS_NOT_VERIFIED: "Faltan landmarks esenciales del rostro por verificar.",
  LEFT_HAND_REQUIRES_REVIEW: "La mano izquierda necesita revisión antes de crear huesos de dedos.",
  RIGHT_HAND_REQUIRES_REVIEW: "La mano derecha necesita revisión antes de crear huesos de dedos.",
  GEOMETRIC_FINGER_BRANCH_UNAVAILABLE: "No se pudo aislar una rama geométrica confiable para este dedo.",
  INSUFFICIENT_VISUAL_GEOMETRY_AGREEMENT: "Las vistas y la geometría no reunieron coincidencias suficientes para este dedo.",
  FINGER_TOPOLOGY_INVALID: "La cadena anatómica del dedo no superó la validación de tamaño, forma y continuidad.",
  FINGER_CHAINS_CROSS: "Dos cadenas de dedos se cruzaron en la reconstrucción y fueron rechazadas.",
  FINGER_REGION_LABELING_INCOMPLETE: "No se pudieron separar las cinco regiones de dedos con suficiente confianza.",
  FINGER_CENTERLINE_SAMPLING_FAILED: "No se pudo recorrer de forma estable la línea central geométrica del dedo.",
  PALM_GEOMETRY_INSUFFICIENT: "La palma no reunió suficientes puntos verificados para ubicar su centro.",
  EAR_REGION_EMPTY: "No se encontró geometría suficiente en la región de la oreja.",
  EAR_GEOMETRY_INSUFFICIENT: "La geometría lateral de la oreja no fue suficiente.",
  EAR_EVIDENCE_INSUFFICIENT: "La evidencia geométrica y simétrica de la oreja fue insuficiente.",
  FACE_VERTICAL_ORDER_INVALID: "El orden vertical de los landmarks del rostro resultó incoherente.",
  TECHNICAL_EVIDENCE_GATE_FAILED: "El landmark no superó la validación conjunta de profundidad, normales y región.",
};

const FINGER_WARNING_CODES = new Set([
  "GEOMETRIC_FINGER_BRANCH_UNAVAILABLE",
  "INSUFFICIENT_VISUAL_GEOMETRY_AGREEMENT",
  "FINGER_TOPOLOGY_INVALID",
  "FINGER_CENTERLINE_SAMPLING_FAILED",
  "FINGER_SEGMENT_SCALE_INVALID",
  "FINGER_BRANCH_CONFIDENCE_LOW",
  "VISUAL_GEOMETRY_AGREEMENT_LOW",
]);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizedSide(value: unknown) {
  const side = String(value ?? "").toLowerCase();
  if (side === "left" || side === "l" || side === "izquierda") return "left";
  if (side === "right" || side === "r" || side === "derecha") return "right";
  return "";
}

function sideText(value: unknown) {
  const side = normalizedSide(value);
  return side === "left" ? "izquierda" : side === "right" ? "derecha" : "";
}

function inferredFinger(record: JsonRecord) {
  if (typeof record.finger === "string" && record.finger.trim()) return record.finger.trim().toLowerCase();
  const landmark = typeof record.landmark === "string" ? record.landmark.toLowerCase() : "";
  const match = landmark.match(/^(thumb|index|middle|ring|pinky)_/);
  return match?.[1] ?? "";
}

function fingerText(value: string) {
  return {
    thumb: "pulgar",
    index: "índice",
    middle: "medio",
    ring: "anular",
    pinky: "meñique",
  }[value] ?? value.replace(/_/g, " ");
}

function readableCode(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function inferredRegion(name: string) {
  const normalized = name.toLowerCase();
  const side = normalized.endsWith("_l") || /izquierda/.test(normalized) ? "l"
    : normalized.endsWith("_r") || /derecha/.test(normalized) ? "r"
      : null;
  if (/^(brow|eye|nose|mouth|lip|chin|jaw|cheek|forehead|temple|ear)_/.test(normalized)) return "head";
  if (/^ball_/.test(normalized)) return side ? `foot_${side}` : "foot";
  if (/^foot_/.test(normalized)) return side ? `foot_${side}` : "foot";
  if (/^ankle_/.test(normalized)) return side ? `calf_${side}` : "calf";
  if (/^calf_/.test(normalized)) return side ? `calf_${side}` : "calf";
  if (/^knee_/.test(normalized)) return side ? `thigh_${side}` : "thigh";
  if (/^(hip|thigh)_/.test(normalized)) return side ? `thigh_${side}` : "thigh";
  if (/^(wrist|palm|hand)_/.test(normalized)) return side ? `hand_${side}` : "hand";
  if (/^(thumb|index|middle|ring|pinky)_/.test(normalized)) {
    const finger = normalized.split("_")[0];
    return side ? `${finger}_${side}` : finger;
  }
  if (/^elbow_/.test(normalized)) return side ? `forearm_${side}` : "forearm";
  if (/^(shoulder|upperarm)_/.test(normalized)) return side ? `upper_arm_${side}` : "upper_arm";
  return null;
}

function normalizeLandmark(name: string, value: unknown) {
  const record = asRecord(value);
  if (!record) return value;
  const region = typeof record.region === "string" ? record.region.trim().toLowerCase() : "";
  const next: JsonRecord = {
    ...record,
    name: typeof record.name === "string" ? record.name : name,
  };
  if (!region || region === "unknown" || region === "unassigned") {
    const inferred = inferredRegion(name);
    if (inferred) next.region = inferred;
  }
  return next;
}

function warningMessage(code: string, record: JsonRecord) {
  const side = sideText(record.side);
  const finger = inferredFinger(record);
  const base = WARNING_MESSAGES[code];

  if (FINGER_WARNING_CODES.has(code) && finger) {
    return `${base ?? "La cadena anatómica del dedo necesita revisión"} Dedo ${fingerText(finger)}${side ? ` ${side}` : ""}.`;
  }
  if (code === "HAND_NOT_DETECTED" && side) {
    return `El detector visual no reconoció la mano ${side} en las vistas técnicas.`;
  }
  if (code === "FINGER_CHAINS_CROSS" && side) {
    return `Se cruzaron cadenas de dedos en la mano ${side}; esos puntos fueron rechazados.`;
  }
  if (code === "PALM_GEOMETRY_INSUFFICIENT" && side) {
    return `La palma ${side} no reunió suficientes puntos verificados para calcular su centro.`;
  }
  if (code.endsWith("_HAND_REQUIRES_REVIEW") && side) {
    return `La mano ${side} conserva cadenas de dedos pendientes de verificar.`;
  }
  if (base) return base;

  const subject = record.landmark || record.region || record.finger || record.side;
  return subject
    ? `${readableCode(code)} · ${String(subject).replace(/_/g, " ")}.`
    : `${readableCode(code)}.`;
}

function warningSignature(record: JsonRecord) {
  const code = typeof record.code === "string" ? record.code : "ANALYZER_WARNING";
  const side = normalizedSide(record.side);
  const finger = inferredFinger(record);

  if (FINGER_WARNING_CODES.has(code) && finger) return `finger-chain|${side}|${finger}`;
  if (code === "FINGER_CHAINS_CROSS") return `finger-cross|${side}`;
  if (code === "PALM_GEOMETRY_INSUFFICIENT") return `palm|${side}`;
  if (code === "FINGER_REGION_LABELING_INCOMPLETE") return `finger-regions|${side}`;
  if (code.endsWith("_HAND_REQUIRES_REVIEW")) return `hand-summary|${side}`;
  if (code === "HAND_NOT_DETECTED") return `hand-detector|${side}`;
  if (code === "FACE_NOT_DETECTED") return "face-detector";
  if (code === "FACE_REQUIRED_LANDMARKS_NOT_VERIFIED") return "face-required";
  return [
    code,
    record.landmark,
    record.region,
    side,
    finger,
  ].map((value) => String(value ?? "")).join("|");
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, JsonRecord>();

  for (const raw of value) {
    const record = asRecord(raw);
    if (!record) continue;

    const code = typeof record.code === "string" ? record.code : "ANALYZER_WARNING";
    const signature = warningSignature({ ...record, code });
    const existing = grouped.get(signature);
    const view = typeof record.view === "string" ? record.view : null;

    if (existing) {
      existing.occurrences = Number(existing.occurrences ?? 1) + Number(record.occurrences ?? 1);
      const views = Array.isArray(existing.views) ? [...existing.views] : [];
      if (view && !views.includes(view)) views.push(view);
      if (views.length) existing.views = views;

      const codes = Array.isArray(existing.codes) ? [...existing.codes] : [existing.code];
      if (!codes.includes(code)) codes.push(code);
      existing.codes = codes;

      const landmarks = Array.isArray(existing.landmarks) ? [...existing.landmarks] : [];
      if (typeof record.landmark === "string" && !landmarks.includes(record.landmark)) {
        landmarks.push(record.landmark);
      }
      if (landmarks.length) existing.landmarks = landmarks;
      continue;
    }

    grouped.set(signature, {
      ...record,
      code,
      side: normalizedSide(record.side) || record.side,
      finger: inferredFinger(record) || record.finger,
      message: typeof record.message === "string" && record.message.trim()
        ? record.message
        : warningMessage(code, record),
      occurrences: Number(record.occurrences ?? 1),
      codes: [code],
      ...(view ? { views: [view] } : {}),
      ...(typeof record.landmark === "string" ? { landmarks: [record.landmark] } : {}),
    });
  }

  const values = [...grouped.values()];
  const sidesWithSpecificWarnings = new Set(
    values
      .filter((record) => !String(record.code ?? "").endsWith("_HAND_REQUIRES_REVIEW"))
      .map((record) => normalizedSide(record.side))
      .filter(Boolean),
  );

  return values.filter((record) => {
    const code = String(record.code ?? "");
    const side = normalizedSide(record.side);
    return !(code.endsWith("_HAND_REQUIRES_REVIEW") && side && sidesWithSpecificWarnings.has(side));
  });
}

function normalizeSubsystems(value: unknown) {
  const subsystems = asRecord(value);
  if (!subsystems) return value;
  return Object.fromEntries(Object.entries(subsystems).map(([name, raw]) => {
    const subsystem = asRecord(raw);
    if (!subsystem) return [name, raw];
    return [name, {
      ...subsystem,
      blockingWarnings: normalizeWarnings(subsystem.blockingWarnings),
      nonBlockingWarnings: normalizeWarnings(subsystem.nonBlockingWarnings),
    }];
  }));
}

function normalizePayload(value: unknown) {
  const payload = asRecord(value);
  if (!payload) return value;
  const analysis = asRecord(payload.analysis);
  if (!analysis) return value;
  const rawLandmarks = asRecord(analysis.landmarks) ?? {};
  const landmarks = Object.fromEntries(
    Object.entries(rawLandmarks).map(([name, landmark]) => [name, normalizeLandmark(name, landmark)]),
  );
  const acceptedLandmarks: JsonRecord = {};
  const rejectedLandmarks: JsonRecord = {};
  for (const [name, raw] of Object.entries(landmarks)) {
    const landmark = asRecord(raw);
    if (landmark?.accepted === true) acceptedLandmarks[name] = raw;
    else rejectedLandmarks[name] = raw;
  }
  return {
    ...payload,
    analysis: {
      ...analysis,
      landmarks,
      warnings: normalizeWarnings(analysis.warnings),
      bodySubsystems: normalizeSubsystems(analysis.bodySubsystems),
    },
    acceptedLandmarks,
    rejectedLandmarks,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    await requireAvatarAnalyzerUser(request);
    const { runId: rawRunId } = await context.params;
    const runId = safeAnalyzerRunId(rawRunId);
    const response = await fetchAvatarAnalyzerWorker(`/avatar/analyze-v4/result/${runId}`);
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw || `El Worker no pudo devolver el diagnóstico (${response.status})`);
    }
    const data = normalizePayload(JSON.parse(raw));
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: avatarAnalyzerError(cause) }, { status: 422 });
  }
}
