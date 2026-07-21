import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { buildBlenderJob } = await import("./lib/creator-studio/blender-job.ts");
const creatorSource = readFileSync("./components/creator-studio/CreatorStudioAutomatic.tsx", "utf8");
const bootstrapSource = readFileSync("./components/creator-studio/CreatorStudioBootstrap.tsx", "utf8");
const simpleStudioSource = readFileSync("./components/creator-studio/CreatorStudioSimple.tsx", "utf8");
const previewSource = readFileSync("./components/creator-studio/ResultRigPreviewV40.tsx", "utf8");
const alignmentSource = readFileSync("./components/creator-studio/result-rig-runtime-alignment.ts", "utf8");
const blenderRouteSource = readFileSync("./app/api/creator-studio/blender/route.ts", "utf8");


test("las prendas usan el FBX oficial de Unreal como molde automático", () => {
  const job = buildBlenderJob({
    category: "hoodie",
    attemptId: "attempt-test",
    forceFreshSource: true,
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
  assert.equal(job.options.normalizeBeforeSkinning, true);
  assert.equal(job.options.canonicalRestPose, true);
  assert.equal(job.options.rejectPostSkinScaleChanges, true);
  assert.equal(job.options.forceFreshSource, true);
  assert.equal(job.options.cleanSceneBeforeImport, true);
  assert.equal(job.options.validation.requireCanonicalRestBind, true);
  assert.equal(job.options.validation.requireUnitLocalScale, true);
  assert.equal(job.attemptId, "attempt-test");
  assert.equal(job.sourcePolicy, "fresh-upload-and-factory-startup");
  assert.equal(job.previewSettings.canonicalBindVersion, 43);
});


test("Creator Studio conserva el molde automático pero monta el flujo simple", () => {
  assert.match(bootstrapSource, /CreatorStudioSimple/);
  assert.doesNotMatch(bootstrapSource, /UnrealObjectExport/);
  assert.doesNotMatch(bootstrapSource, /CreatorStudioAutomatic/);
  assert.match(simpleStudioSource, /Elegir GLB/);
  assert.match(simpleStudioSource, /Riggear avatar/);
  assert.match(simpleStudioSource, /Enviar FBX/);
  assert.match(simpleStudioSource, /Traer data/);
  assert.match(simpleStudioSource, /Riggear GLB/);
  assert.match(simpleStudioSource, /moldSource: "unreal-avatar-snapshot"/);
  assert.match(creatorSource, /official-unreal-fbx/);
});


test("Reintentar molde crea un intento limpio desde el archivo original", () => {
  assert.match(creatorSource, /Reintentar molde automático/);
  assert.match(blenderRouteSource, /randomUUID\(\)/);
  assert.match(blenderRouteSource, /forceFreshSource:\s*true/);
  assert.match(blenderRouteSource, /cache:\s*"no-store"/);
  assert.match(blenderRouteSource, /sourceFile, sourceFile\.name/);
  assert.match(blenderRouteSource, /canonical-rest-bind-v43/);
});


test("el visor alinea el rig completo con el avatar antes de validar escala y bind pose", () => {
  assert.match(alignmentSource, /alignRigToActiveAvatar/);
  assert.match(alignmentSource, /makeScale\(scale, scale, scale\)/);
  assert.match(alignmentSource, /makeRotationFromQuaternion/);
  assert.match(alignmentSource, /source\.hips/);
  assert.match(alignmentSource, /target\.hips/);
  const alignmentIndex = previewSource.indexOf("alignRigToActiveAvatar(rigScene, avatarScene)");
  const boundsIndex = previewSource.indexOf("validateBounds(avatarBounds, initialGarmentBounds)");
  const bindIndex = previewSource.indexOf("compareBindPose(avatarScene, rigScene, avatarHeight)");
  assert.ok(alignmentIndex >= 0);
  assert.ok(boundsIndex > alignmentIndex);
  assert.ok(bindIndex > alignmentIndex);
  assert.doesNotMatch(previewSource, /if \(!isIdentityRoot\(rigScene\)\) throw/);
});
