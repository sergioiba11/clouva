import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { buildBlenderJob } = await import("./lib/creator-studio/blender-job.ts");
const creatorSource = readFileSync("./components/creator-studio/CreatorStudioAutomatic.tsx", "utf8");
const bootstrapSource = readFileSync("./components/creator-studio/CreatorStudioBootstrap.tsx", "utf8");

test("las prendas usan el FBX oficial de Unreal como molde automático", () => {
  const job = buildBlenderJob({
    category: "hoodie",
    previewSettings: { automaticFit: true, manualCorrectionEnabled: false },
  });

  assert.equal(job.avatarMoldSource, "official-unreal-fbx");
  assert.equal(job.options.fitSource, "official_unreal_fbx");
  assert.equal(job.options.automaticFit, true);
  assert.equal(job.options.manualCorrectionOptional, true);
  assert.equal(job.options.manualCorrectionEnabled, false);
  assert.equal(job.options.useOfficialAvatarMesh, true);
  assert.equal(job.options.useOfficialAvatarSkeleton, true);
  assert.equal(job.options.useOfficialAvatarWeights, true);
  assert.equal(job.options.normalizeSourcePose, true);
});

test("Creator Studio procesa primero y deja los sliders como corrección opcional", () => {
  assert.match(bootstrapSource, /CreatorStudioAutomatic/);
  assert.match(creatorSource, /Crear molde automático/);
  assert.match(creatorSource, /Molde oficial conectado/);
  assert.match(creatorSource, /official-unreal-fbx/);
  assert.match(creatorSource, /Necesito corregir el calce/);
  assert.match(creatorSource, /Recalcular en Blender/);
  assert.match(creatorSource, /Aprobar molde automático/);
});
