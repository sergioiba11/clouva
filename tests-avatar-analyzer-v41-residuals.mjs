import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const residual = readFileSync("worker/garment-rig/analyzer_v41_residuals.py", "utf8");
const renderer = [
  readFileSync("worker/garment-rig/multiview_renderer_v4.py", "utf8"),
  readFileSync("worker/garment-rig/multiview_renderer_v4_base.py", "utf8"),
  readFileSync("worker/garment-rig/hand_framing_v41.py", "utf8"),
  readFileSync("worker/garment-rig/hand_framing_v41_fast.py", "utf8"),
].join("\n");
const entrypoint = readFileSync("worker/garment-rig/avatar_analyzer_v4.py", "utf8");
const panel = readFileSync("components/library/AvatarAnalyzerResidualMetrics.tsx", "utf8");
const page = readFileSync("app/avatar-analyzer-v4/page.tsx", "utf8");

test("V4.1 residual layer is applied before persisted output", () => {
  assert.match(entrypoint, /apply_residual_repairs_v41/);
  assert.match(entrypoint, /analysis = apply_residual_repairs_v41\(analysis\)/);
});

test("finger mode is derived from verified geometry instead of inherited full", () => {
  assert.match(residual, /verified_finger_branch_count/);
  assert.match(residual, /LEGACY_FINGER_RIG_MODE_CONFLICT/);
  assert.match(residual, /if branches >= 5:/);
  assert.match(residual, /if branches >= 2:/);
});

test("low confidence and projection mismatch have separate metrics", () => {
  assert.match(residual, /"lowConfidenceCount"/);
  assert.match(residual, /"projectionMismatchCount"/);
  assert.match(residual, /"technicalMismatchCount": states\.get\("projection_mismatch", 0\)/);
  assert.match(panel, /Confianza baja/);
  assert.match(panel, /Proyección incompatible/);
});

test("hand framing uses verified focus geometry and distal forearm context", () => {
  assert.match(renderer, /focus_points/);
  assert.match(renderer, /distal_forearm_ratio/);
  assert.match(renderer, /focusProxyBounds/);
  assert.match(renderer, /contextProxyBounds/);
  assert.match(renderer, /maximum_retries/);
  assert.match(renderer, /_verified_region/);
  assert.match(renderer, /_clip_polygon_halfspace/);
  assert.match(renderer, /focusSilhouetteCoverage/);
  assert.match(renderer, /existing_exact_technical_silhouette/);
  assert.match(renderer, /duplicateFocusRenderSkipped/);
});

test("mobile analyzer page renders the residual diagnostic panel", () => {
  assert.match(page, /AvatarAnalyzerResidualMetrics/);
  assert.match(panel, /metricGrid/);
  assert.match(panel, /@\/components\/auth-provider/);
});
