import assert from "node:assert/strict";
import { test } from "node:test";

const { buildBlenderJob } = await import("./lib/creator-studio/blender-job.ts");
const { resolveRigProfile, isDeformableCategory, isRigidCategory } = await import("./lib/creator-studio/rig-profiles.ts");

test("hoodie siempre se pesa de nuevo contra el avatar activo", () => {
  const job = buildBlenderJob({ category: "hoodie", templateMode: true, preserveExistingSkinning: true });
  assert.equal(job.operation, "fit_and_rig_reference");
  assert.equal(job.pipelineVersion, "canonical-landmarks-v4");
  assert.equal(job.riggingStrategy, "fresh_transfer_from_active_avatar");
  assert.equal(job.templateMode, false);
  assert.equal(job.options.transferSkinWeights, true);
  assert.equal(job.options.transferVertexGroups, true);
  assert.equal(job.options.attachArmature, true);
  assert.equal(job.options.preserveExistingSkinning, false);
  assert.equal(job.options.fitIncludesLimbSpan, true);
  assert.equal(job.options.validation.requireBilateralSleeveWeights, true);
});

test("pantalón exige cintura en Hips y pesos separados para ambas piernas", () => {
  const job = buildBlenderJob({ category: "pants", templateMode: true, preserveExistingSkinning: true });
  assert.equal(job.riggingStrategy, "fresh_transfer_from_active_avatar");
  assert.equal(job.options.fitUsesCanonicalLowerBodyLandmarks, true);
  assert.equal(job.options.weightTransfer.separateLeftRightLimbs, true);
  assert.equal(job.options.weightTransfer.sampleCount, 16);
  assert.equal(job.options.validation.requireBilateralLegWeights, true);
  assert.equal(job.options.validation.requireWaistAtHips, true);
  assert.equal(job.options.validation.rejectTorsoAlignedPants, true);
});

test("solo una plantilla rígida puede conservar skinning existente", () => {
  const job = buildBlenderJob({
    category: "accessory",
    templateMode: true,
    preserveExistingSkinning: true,
    templateId: "chain-base-v1",
  });
  assert.equal(job.riggingStrategy, "preserve_existing_skinning");
  assert.equal(job.templateMode, true);
  assert.equal(job.options.transferSkinWeights, false);
  assert.equal(job.options.preserveExistingSkinning, true);
  assert.equal(job.options.preserveTopology, true);
});

test("la validación general exige armature, pesos normalizados y poses", () => {
  const job = buildBlenderJob({ category: "pants" });
  assert.equal(job.options.validation.requireArmature, true);
  assert.equal(job.options.validation.requireWeightedVertices, true);
  assert.deepEqual(job.options.validation.animationTests, ["tpose", "idle", "walk", "run"]);
  assert.equal(job.options.maxBoneInfluences, 4);
  assert.equal(job.options.validation.maxUnweightedVertexRatio, 0.005);
});

test("hoodie activa el perfil deformable con brazos y antebrazos", () => {
  const profile = resolveRigProfile("hoodie");
  assert.equal(profile.pipeline, "garment");
  assert.equal(profile.mode, "deformable");
  assert.equal(profile.workerCategory, "hoodie");
  assert.ok(profile.requiredBones.includes("Upper Arms"));
  assert.ok(profile.requiredBones.includes("Lower Arms"));
  assert.equal(isDeformableCategory("hoodie"), true);
  assert.equal(isRigidCategory("hoodie"), false);
});

test("baggy se traduce al perfil de pantalón deformable", () => {
  const profile = resolveRigProfile("baggy");
  assert.equal(profile.pipeline, "garment");
  assert.equal(profile.workerCategory, "pants");
  assert.ok(profile.requiredBones.includes("Hips"));
  assert.ok(profile.requiredBones.includes("Upper Legs"));
  assert.ok(profile.requiredBones.includes("Lower Legs"));
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
