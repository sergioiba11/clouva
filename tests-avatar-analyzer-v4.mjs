import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("V4.1 visualizer exposes the real GLB, evidence and professional controls", () => {
  const source = read("./components/library/AvatarAnalyzerV4Diagnostics.tsx");
  for (const token of [
    'createElement("model-viewer"',
    "versionContract",
    "Cuerpo",
    "Cara",
    "Mano izquierda",
    "Mano derecha",
    "Articulaciones internas",
    "Triángulos de frontera",
    "Siguiente error",
    "Pantalla completa",
    "Comparar automático / manual",
    "Body rig",
    "Export Unreal",
    "Corregir análisis",
    "Analizar y riggear",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("V4 API remains side-by-side with V3.2 and reanalysis uses a clean source", () => {
  const source = read("./worker/garment-rig/app_v18.py");
  assert.match(source, /import app_v17 as v32/);
  assert.match(source, /\/avatar\/analyze-v4/);
  assert.match(source, /\/avatar\/complete-rig-v4/);
  assert.match(source, /legacyV32Preserved/);
  assert.match(source, /_rerun_cached_source_v4/);
  assert.match(source, /executedAsCleanPipeline/);
  assert.match(source, /ANALYZER_RESULT_STALE/);
});

test("confidence, states, readiness and profiles are versioned", () => {
  const source = read("./worker/garment-rig/analyzer_v4_contract.py");
  for (const token of [
    "views == 0",
    "inliers == 0",
    "verified_visual_geometry",
    "verified_geometry_fallback",
    "verified_single_view_depth",
    "topology_invalid",
    "body_only",
    "full_humanoid",
    "bodyRigReady",
    "leftHandBaseReady",
    "leftFingerRigReady",
    "diagnostic_fingerprint",
    "APPROVED_STATES",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("technical passes preserve exact surface evidence", () => {
  const source = read("./worker/garment-rig/technical_passes.py");
  for (const token of [
    "world_position.npy",
    "valid_mask.npy",
    "primary_region_id.npy",
    "primary_region_weight.npy",
    "secondary_region_mask.npy",
    "triangle_id.npy",
    "barycentric.npy",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("boundary triangles are shared instead of discarded by majority", () => {
  const bvh = read("./worker/garment-rig/anatomy_bvh.py");
  const semantics = read("./worker/garment-rig/anatomy_semantics.py");
  assert.ok(bvh.includes("secondary_regions"));
  assert.ok(bvh.includes("global_triangle_id"));
  assert.ok(bvh.includes("boundary"));
  assert.ok(semantics.includes("adjacent_boundary"));
  assert.doesNotMatch(bvh, /def _majority_region/);
});

test("shared version contract drives backend and frontend", () => {
  const version = JSON.parse(read("./worker/garment-rig/avatar_analyzer_version.json"));
  assert.equal(version.analyzerVersion, "clouva-avatar-analyzer-v4.1");
  assert.equal(version.mapVersion, "clouva-anatomical-map-v4.1");
  assert.equal(version.frontendVersion, "clouva-avatar-visualizer-v4.1");
});
