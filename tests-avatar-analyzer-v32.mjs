import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Analyzer V3.2 preserves raw confidence and explicit evidence states", async () => {
  const triangulator = await read("./worker/garment-rig/ray_triangulator.py");
  const contract = await read("./worker/garment-rig/analyzer_contract.py");
  assert.match(triangulator, /rawFinalConfidence/);
  assert.match(triangulator, /no_visual_evidence/);
  assert.match(triangulator, /insufficient_views/);
  assert.doesNotMatch(triangulator, /min\(final_confidence,\s*0\.39\)/);
  assert.match(contract, /explicit_pre_gate/);
  assert.match(contract, /measured = \[/);
  assert.match(contract, /build_landmark_evidence/);
  assert.match(contract, /classifiedFailure/);
});

test("adaptive projection checks a neighborhood without accepting another region", async () => {
  const projector = await read("./worker/garment-rig/landmark_projector_3d.py");
  assert.match(projector, /adaptive-5x5-region-bvh-technical-pass-v3\.2/);
  assert.match(projector, /requestedPixel/);
  assert.match(projector, /selectedPixel/);
  assert.match(projector, /regionCompatible/);
  assert.match(projector, /LANDMARK_WRONG_REGION/);
});

test("stylized facial signals are visual-only and projection remains strict", async () => {
  const cues = await read("./worker/garment-rig/face_visual_cues.py");
  const renderer = await read("./worker/garment-rig/multiview_renderer_v32.py");
  assert.match(cues, /projectionAllowed": False/);
  assert.match(cues, /EXCLUDED_CLASSES = \{"hair", "clothing", "accessories", "unknown_rejected"\}/);
  assert.match(renderer, /visualOnlyFaceCues/);
  assert.match(renderer, /rgb-and-edges-only-strict-anatomy-bvh-for-final-points/);
  assert.match(renderer, /\("head", "eyes"\)/);
});

test("AutoRig is gated by Analyzer version, readiness and source SHA", async () => {
  const worker = await read("./worker/garment-rig/app_v17.py");
  const route = await read("./app/api/avatar/rig/route.ts");
  const wrapper = await read("./worker/garment-rig/autorig_avatar_v18.py");
  for (const source of [worker, route, wrapper]) {
    assert.match(source, /clouva-avatar-analyzer-v3\.2/);
  }
  assert.match(route, /analyzedInputSha256/);
  assert.match(route, /rigInputSha256/);
  assert.match(route, /criticalLandmarksVerified/);
  assert.match(route, /MIN_RIG_READINESS = 0\.82/);
  assert.match(wrapper, /autorig-v16-plus-approved-analyzer-v3\.2-seeds/);
  assert.match(wrapper, /inventedLandmarks": 0/);
});

test("Biblioteca blocks filename-only rigs", async () => {
  const component = await read("./components/library/ActiveAvatarDownload.tsx");
  assert.match(component, /Rig no aprobado para producción/);
  assert.match(component, /profile\.analyzedInputSha256 !== profile\.rigInputSha256/);
  assert.match(component, /if \(!avatar\?\.validatedRig\) return/);
  assert.doesNotMatch(component, /if \(!avatar \|\| !avatar\.isRigged\) return/);
});

test("Analyzer UI uses dynamic badge and mobile cards", async () => {
  const component = await read("./components/library/AvatarAnalyzerPreview.tsx");
  const css = await read("./components/library/avatar-analyzer-preview.module.css");
  assert.match(component, /Confianza del cuerpo base/);
  assert.match(component, /Preparación para rig/);
  assert.match(component, /ANÁLISIS APROBADO/);
  assert.match(component, /ANÁLISIS PARCIAL/);
  assert.doesNotMatch(component, /SUPERFICIE ANATÓMICA VERIFICADA/);
  assert.doesNotMatch(component, /Compatibilidad corporal/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.desktopTable \{ display: none; \}/);
  assert.match(css, /\.mobileLandmarks \{ display: grid/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("Worker build keeps the existing rig tests and adds V3.2 tests", async () => {
  const dockerfile = await read("./worker/garment-rig/Dockerfile");
  assert.match(dockerfile, /test_avatar_analyzer_v32\.py/);
  assert.match(dockerfile, /autorig_avatar_v18\.py/);
  assert.match(dockerfile, /test_canonical_bind_v43\.py/);
  assert.match(dockerfile, /test_anatomical_fit_v41\.py/);
});
