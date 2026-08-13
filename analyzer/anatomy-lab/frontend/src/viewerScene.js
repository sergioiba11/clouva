export const AVATAR_CAMERA = Object.freeze({
  position: [0, 0.92, 3.2],
  fov: 42,
  up: [0, 1, 0],
});

export const AVATAR_ORBIT_TARGET = Object.freeze([0, 0.9, 0]);

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function validateFitPayload(payload) {
  const assetPath = payload?.asset_paths?.glb;
  if (typeof assetPath !== "string" || !assetPath.toLowerCase().endsWith(".glb")) {
    throw new Error("El fitting no devolvió un GLB válido");
  }

  const matrix = payload?.fit?.source_to_avatar_matrix;
  if (!Array.isArray(matrix) || matrix.length !== 4 || matrix.some((row) => (
    !Array.isArray(row) || row.length !== 4 || row.some((value) => !isFiniteNumber(value))
  ))) {
    throw new Error("El fitting devolvió una transformación inválida");
  }

  const scale = payload?.fit?.scale_xyz;
  if (!Array.isArray(scale) || scale.length !== 3 || scale.some((value) => !isFiniteNumber(value) || Number(value) <= 0)) {
    throw new Error("El fitting devolvió una escala inválida");
  }

  return assetPath;
}

export function hasGlbHeader(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  return view.getUint32(0, true) === 0x46546c67
    && view.getUint32(4, true) === 2
    && view.getUint32(8, true) === buffer.byteLength;
}

export function summarizeGarmentResult(result) {
  const fit = result?.fit;
  const readiness = result?.readiness || {};
  const geometry = result?.mesh || result?.analysis?.geometry || {};
  const rawClearance = result?.clearance?.minimum_vertex_body_distance_cm
    ?? result?.clearance?.minimum_cm;

  return {
    fitMode: typeof fit === "string" ? fit : (typeof fit?.mode === "string" ? fit.mode : "-"),
    vertexCount: geometry.vertex_count ?? "-",
    triangleCount: geometry.triangle_count ?? "-",
    libraryConnected: readiness.template_library_connected ?? Boolean(result?.template?.asset_key),
    autoAligned: readiness.auto_alignment_ready ?? readiness.universal_fit_ready ?? Boolean(fit?.source_to_avatar_matrix),
    previewReady: readiness.preview_ready === true,
    clearanceMinimumCm: Number.isFinite(Number(rawClearance)) ? Number(rawClearance) : null,
    finalOutputReady: readiness.universal_fit_ready ?? readiness.meshy_payload_ready ?? false,
  };
}
