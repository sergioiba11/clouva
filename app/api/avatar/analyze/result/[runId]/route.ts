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
  ANATOMY_REGIONS_INSUFFICIENT: "La segmentación no reunió suficiente geometría en algunas regiones anatómicas.",
  LANDMARK_TECHNICAL_PASS_MISMATCH: "La evidencia visual y los pases técnicos no coincidieron para este landmark.",
  LANDMARK_REGION_BVH_MISS: "El rayo del landmark no impactó la región anatómica esperada.",
  FACE_REQUIRED_LANDMARKS_NOT_VERIFIED: "Faltan landmarks esenciales del rostro por verificar.",
  LEFT_HAND_REQUIRES_REVIEW: "La mano izquierda necesita revisión antes de crear huesos de dedos.",
  RIGHT_HAND_REQUIRES_REVIEW: "La mano derecha necesita revisión antes de crear huesos de dedos.",
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
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
  const next = { ...record, name: typeof record.name === "string" ? record.name : name };
  if (!region || region === "unknown" || region === "unassigned") {
    const inferred = inferredRegion(name);
    if (inferred) next.region = inferred;
  }
  return next;
}

function warningSignature(record: JsonRecord) {
  return [
    record.code,
    record.landmark,
    record.region,
    record.side,
    record.finger,
    record.message,
  ].map((value) => String(value ?? "")).join("|");
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, JsonRecord>();
  for (const raw of value) {
    const record = asRecord(raw);
    if (!record) continue;
    const signature = warningSignature(record);
    const existing = grouped.get(signature);
    const view = typeof record.view === "string" ? record.view : null;
    if (existing) {
      existing.occurrences = Number(existing.occurrences ?? 1) + 1;
      const views = Array.isArray(existing.views) ? [...existing.views] : [];
      if (view && !views.includes(view)) views.push(view);
      if (views.length) existing.views = views;
      continue;
    }
    const code = typeof record.code === "string" ? record.code : "ANALYZER_WARNING";
    const side = record.side === "left" ? " izquierda" : record.side === "right" ? " derecha" : "";
    grouped.set(signature, {
      ...record,
      code,
      message: typeof record.message === "string" && record.message.trim()
        ? record.message
        : `${WARNING_MESSAGES[code] ?? "El analizador registró evidencia que necesita revisión."}${side}`,
      occurrences: 1,
      ...(view ? { views: [view] } : {}),
    });
  }
  return [...grouped.values()];
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
    const response = await fetchAvatarAnalyzerWorker(`/avatar/analyze/result/${runId}`);
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
