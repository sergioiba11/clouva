import assert from "node:assert/strict";
import test from "node:test";
import { AVATAR_CAMERA, AVATAR_ORBIT_TARGET, hasGlbHeader, summarizeGarmentResult, validateFitPayload } from "./viewerScene.js";

test("the avatar viewer uses the GLB Y axis as vertical", () => {
  assert.deepEqual(AVATAR_CAMERA.up, [0, 1, 0]);
  assert.equal(AVATAR_CAMERA.position[1], AVATAR_ORBIT_TARGET[1] + 0.02);
  assert.ok(Math.abs(AVATAR_CAMERA.position[2]) > Math.abs(AVATAR_CAMERA.position[1]));
});

test("a finite canonical fitting payload is accepted", () => {
  const payload = {
    asset_paths: { glb: "universal_library_fits/r1_fitted.glb" },
    fit: {
      scale_xyz: [0.55, 0.82, 0.6],
      source_to_avatar_matrix: [
        [-0.55, 0, 0, -0.01],
        [0, 0.6, 0, 0.94],
        [0, 0, -0.82, -0.03],
        [0, 0, 0, 1],
      ],
    },
  };
  assert.equal(validateFitPayload(payload), payload.asset_paths.glb);
});

test("invalid or unbounded fitting transforms are rejected before rendering", () => {
  assert.throws(() => validateFitPayload({ asset_paths: { glb: "fit.glb" }, fit: { scale_xyz: [1, 1, Infinity], source_to_avatar_matrix: [] } }), /transformación|escala/);
  assert.throws(() => validateFitPayload({ asset_paths: { glb: "fit.txt" } }), /GLB/);
});

test("GLB validation checks magic, version and declared byte length", () => {
  const valid = new ArrayBuffer(12);
  const view = new DataView(valid);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 12, true);
  assert.equal(hasGlbHeader(valid), true);
  view.setUint32(8, 99, true);
  assert.equal(hasGlbHeader(valid), false);
});

test("structured universal-fit data is converted to renderable summary values", () => {
  const summary = summarizeGarmentResult({
    template: { asset_key: "creator_reference_assets:r1" },
    analysis: { geometry: { vertex_count: 11107, triangle_count: 19414 } },
    fit: { mode: "oversized", source_to_avatar_matrix: [[1, 0, 0, 0]] },
    clearance: { minimum_cm: 0.1389655 },
    readiness: { universal_fit_ready: true, preview_ready: true },
  });
  assert.deepEqual(summary, {
    fitMode: "oversized",
    vertexCount: 11107,
    triangleCount: 19414,
    libraryConnected: true,
    autoAligned: true,
    previewReady: true,
    clearanceMinimumCm: 0.1389655,
    finalOutputReady: true,
  });
  for (const value of Object.values(summary)) {
    assert.notEqual(typeof value, "object");
  }
});
