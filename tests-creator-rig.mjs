import assert from "node:assert/strict";
import { test } from "node:test";

const { buildBlenderJob } = await import("./lib/creator-studio/blender-job.ts");
const { resolveRigProfile, isDeformableCategory, isRigidCategory } = await import("./lib/creator-studio/rig-profiles.ts");

test("objeto crudo usa el worker para transferir pesos y vincular Armature", () => {
  const job = buildBlenderJob({ category: "hoodie", templateMode: false, autoWeight: true });
  assert.equal(job.operation, "fit_and_rig_reference");
  assert.equal(job.pipelineVersion, "smart-rig-v3");
  assert.equal(job.riggingStrategy, "transfer_from_avatar");
  assert.equal(job.options.transferSkinWeights, true);
  assert.equal(job.options.transferVertexGroups, true);
  assert.equal(job.options.attachArmature, true);
  assert.equal(job.options.preserveExistingSkinning, false);
  assert.equal(job.options.fitIncludesLimbSpan, true);
  assert.equal(job.options.validation.requireBilateralSleeveWeights, true);
});

test("plantilla conserva skinning y topología en el worker existente", () => {
  const job = buildBlenderJob({
    category: "hoodie",
    templateMode: true,
    templateId: "hoodie-base-v1",
    sourceStoragePath: "user/hoodie/base.glb",
  });
  assert.equal(job.operation, "fit_and_rig_reference");
  assert.equal(job.riggingStrategy, "preserve_existing_skinning");
  assert.equal(job.options.transferSkinWeights, false);
  assert.equal(job.options.transferVertexGroups, false);
  assert.equal(job.options.attachArmature, false);
  assert.equal(job.options.preserveExistingSkinning, true);
  assert.equal(job.options.preserveTopology, true);
});

test("preserveExistingSkinning activa modo plantilla aunque falte templateMode", () => {
  const job = buildBlenderJob({ preserveExistingSkinning: true, autoWeight: true });
  assert.equal(job.templateMode, true);
  assert.equal(job.options.transferSkinWeights, false);
});

test("la validación exige armature, pesos y poses", () => {
  const job = buildBlenderJob({ category: "baggy" });
  assert.equal(job.options.validation.requireArmature, true);
  assert.equal(job.options.validation.requireWeightedVertices, true);
  assert.deepEqual(job.options.validation.animationTests, ["tpose", "idle", "walk", "run"]);
  assert.equal(job.options.maxBoneInfluences, 4);
  assert.equal(job.options.weightTransfer.sampleCount, 12);
});

test("hoodie activa el pipeline deformable con brazos y antebrazos", () => {
  const profile = resolveRigProfile("hoodie");
  assert.equal(profile.pipeline, "garment");
  assert.equal(profile.mode, "deformable");
  assert.equal(profile.workerCategory, "hoodie");
  assert.ok(profile.requiredBones.includes("Upper Arms"));
  assert.ok(profile.requiredBones.includes("Lower Arms"));
  assert.equal(isDeformableCategory("hoodie"), true);
  assert.equal(isRigidCategory("hoodie"), false);
});

test("gorra activa exclusivamente el pipeline rígido de cabeza", () => {
  const profile = resolveRigProfile("gorra");
  assert.equal(profile.pipeline, "object");
  assert.equal(profile.mode, "rigid");
  assert.equal(profile.anchorKey, "head");
  assert.equal(isRigidCategory("gorra"), true);
});

test("categorías laterales permiten elegir mano", () => {
  assert.equal(resolveRigProfile("pulseras").sided, true);
  assert.equal(resolveRigProfile("anillos").sided, true);
  assert.equal(resolveRigProfile("cadena").sided, false);
});
