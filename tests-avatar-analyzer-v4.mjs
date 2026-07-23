import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("V4 diagnostic UI exposes regions, heatmap and separate actions", () => {
  const source = read("./components/library/AvatarAnalyzerV4Diagnostics.tsx");
  for (const token of [
    "Cuerpo", "Cara", "Mano izquierda", "Mano derecha", "Heatmap",
    "Corregir análisis", "Analizar y riggear", "supported_rig_profiles",
  ]) assert.match(source, new RegExp(token));
});

test("V4 API remains side-by-side with V3.2", () => {
  const source = read("./worker/garment-rig/app_v18.py");
  assert.match(source, /import app_v17 as v32/);
  assert.match(source, /\/avatar\/analyze-v4/);
  assert.match(source, /\/avatar\/complete-rig-v4/);
  assert.match(source, /legacyV32Preserved/);
});

test("confidence and profile gates are versioned", () => {
  const source = read("./worker/garment-rig/analyzer_v4_contract.py");
  for (const token of [
    "views == 0", "inliers == 0", "HAND_TOPOLOGY_LIMITED", "BODY_BASIC",
    "FULL_BODY_HANDS_FACE", "diagnostic_fingerprint", "APPROVED_STATES",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});
