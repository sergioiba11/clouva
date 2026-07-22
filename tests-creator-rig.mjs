import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { buildBlenderJob } = await import("./lib/creator-studio/blender-job.ts");
const { resolveRigProfile, isDeformableCategory, isRigidCategory } = await import("./lib/creator-studio/rig-profiles.ts");
const garmentWorkerV9Source = readFileSync("./worker/garment-rig/rig_garment_v5.py", "utf8");
const garmentWorkerV10Source = readFileSync("./worker/garment-rig/rig_garment_v10.py", "utf8");
const garmentWorkerV11Source = readFileSync("./worker/garment-rig/rig_garment_v11.py", "utf8");
const garmentWorkerV12Source = readFileSync("./worker/garment-rig/rig_garment_v12.py", "utf8");
const garmentWorkerV13Source = readFileSync("./worker/garment-rig/rig_garment_v13.py", "utf8");
const garmentWorkerV14Source = readFileSync("./worker/garment-rig/rig_garment_v14.py", "utf8");
const garmentWorkerV15Source = readFileSync("./worker/garment-rig/rig_garment_v15.py", "utf8");
const garmentWorkerV20Source = readFileSync("./worker/garment-rig/rig_garment_v20.py", "utf8");
const garmentExporterSource = readFileSync("./worker/garment-rig/export_unreal_clean.py", "utf8");
const garmentApiV8Source = readFileSync("./worker/garment-rig/app_v8.py", "utf8");
const workerInspectorApiSource = readFileSync("./worker/garment-rig/app_v9.py", "utf8");
const workerInspectorBlenderSource = readFileSync("./worker/garment-rig/inspect_garment.py", "utf8");
const unrealExportRouteSource = readFileSync("./app/api/assets/export-unreal/route.ts", "utf8");
const unrealObjectExportSource = readFileSync("./components/library/UnrealObjectExport.tsx", "utf8");
const garmentDockerfile = readFileSync("./worker/garment-rig/Dockerfile", "utf8");

const workerCopiesAllPython = /COPY \*\.py \.\//.test(garmentDockerfile);

test("hoodie siempre se pesa de nuevo contra el avatar activo", () => {
  const job = buildBlenderJob({ category: "hoodie", templateMode: true, preserveExistingSkinning: true });
  assert.equal(job.operation, "fit_and_rig_reference");
  assert.equal(job.pipelineVersion, "body-mesh-contract-v15");
  assert.equal(job.riggingStrategy, "fresh_transfer_from_active_avatar");
  assert.equal(job.templateMode, false);
  assert.equal(job.options.transferSkinWeights, true);
  assert.equal(job.options.transferVertexGroups, true);
  assert.equal(job.options.attachArmature, true);
  assert.equal(job.options.preserveExistingSkinning, false);
  assert.equal(job.options.fitIncludesLimbSpan, true);
  assert.equal(job.options.validation.requireBilateralSleeveWeights, true);
});

test("pantalón exige cuerpo real y pesos separados para ambas piernas", () => {
  const job = buildBlenderJob({ category: "pants", templateMode: true, preserveExistingSkinning: true });
  assert.equal(job.riggingStrategy, "fresh_transfer_from_active_avatar");
  assert.equal(job.options.fitUsesCanonicalLowerBodyLandmarks, true);
  assert.equal(job.options.fitUsesBodyMeshVolume, true);
  assert.equal(job.options.weightTransfer.separateLeftRightLimbs, true);
  assert.equal(job.options.weightTransfer.sampleCount, 16);
  assert.equal(job.options.validation.requireBilateralLegWeights, true);
  assert.equal(job.options.validation.requireWaistAtHips, true);
  assert.equal(job.options.validation.requireBodyMeshRoundtrip, true);
  assert.equal(job.options.validation.rejectTorsoAlignedPants, true);
});

test("V9 contiene el ajuste corporal base reutilizado por las versiones nuevas", () => {
  assert.match(garmentWorkerV9Source, /def snap_lower_garment\(garment, body_meshes, armature, category, preview_settings\)/);
  assert.match(garmentWorkerV9Source, /desired_width/);
  assert.match(garmentWorkerV9Source, /desired_depth/);
  assert.match(garmentWorkerV9Source, /clouvaCrossSectionNormalization/);
});

test("V10 convierte unidades extremas sin pisos artificiales", () => {
  assert.match(garmentWorkerV10Source, /def exact_scale_factor/);
  assert.match(garmentWorkerV10Source, /1e-8 <= factor <= 1e8/);
  assert.match(garmentWorkerV10Source, /def scale_vertices_in_world/);
  assert.match(garmentWorkerV10Source, /for pass_index in range\(6\)/);
  assert.match(garmentWorkerV10Source, /clouvaUnitScaleNormalization/);
  assert.doesNotMatch(garmentWorkerV10Source, /0\.03, 20\.0/);
  assert.doesNotMatch(garmentWorkerV10Source, /0\.5, 2\.0/);
});

test("V11 ajusta y valida contra una sola caja corporal", () => {
  assert.match(garmentWorkerV11Source, /desired_width = target_size\.x \* width_factor/);
  assert.match(garmentWorkerV11Source, /desired_depth = target_size\.y \* depth_factor/);
  assert.doesNotMatch(garmentWorkerV11Source, /leg_length \* 0\.12/);
  assert.doesNotMatch(garmentWorkerV11Source, /leg_length \* 0\.10/);
  assert.match(garmentWorkerV11Source, /singleLowerBodyVolumeContract/);
  assert.match(garmentWorkerV11Source, /expectedRatios/);
});

test("V12 no parenta la prenda a un armature escalado y valida el GLB reabierto", () => {
  assert.match(garmentWorkerV12Source, /garment\.parent = None/);
  assert.match(garmentWorkerV12Source, /armature_modifier_world_space/);
  assert.match(garmentWorkerV12Source, /clouvaPreExportSize/);
  assert.match(garmentWorkerV12Source, /clouvaPreExportCenter/);
  assert.match(garmentWorkerV12Source, /def validate_roundtrip_v12/);
  assert.match(garmentWorkerV12Source, /size_errors/);
  assert.match(garmentWorkerV12Source, /center_errors/);
  assert.match(garmentWorkerV12Source, /garment_height_ratio/);
});

test("V13 resuelve piernas por jerarquía y usa REST pose con cintura fija en Hips", () => {
  assert.match(garmentWorkerV13Source, /def descendants_with_depth/);
  assert.match(garmentWorkerV13Source, /head_local/);
  assert.match(garmentWorkerV13Source, /tail_local/);
  assert.match(garmentWorkerV13Source, /choose_descendant/);
  assert.match(garmentWorkerV13Source, /left_up_leg/);
  assert.match(garmentWorkerV13Source, /right_up_leg/);
  assert.match(garmentWorkerV13Source, /hips\.z/);
  assert.doesNotMatch(garmentWorkerV13Source, /max\(left_up\.z, right_up\.z, hips\.z\)/);
  assert.match(garmentWorkerV13Source, /clouvaRestLowerLandmarks/);
});

test("V14 acepta pelvis estilizadas sin quitar validación jerárquica", () => {
  assert.match(garmentWorkerV14Source, /def lower_landmarks_v14/);
  assert.match(garmentWorkerV14Source, /minimum_segment/);
  assert.match(garmentWorkerV14Source, /left_upper_segment/);
  assert.match(garmentWorkerV14Source, /right_lower_segment/);
  assert.match(garmentWorkerV14Source, /hipDropRatios/);
  assert.match(garmentWorkerV14Source, /clouvaStylizedPelvisCompatible/);
  assert.doesNotMatch(garmentWorkerV14Source, /Un muslo quedó demasiado lejos de Hips/);
  assert.doesNotMatch(garmentWorkerV14Source, /leg_length \* 0\.30/);
});

test("V15 usa la malla corporal como fuente de verdad para escala y roundtrip", () => {
  assert.match(garmentWorkerV15Source, /def lower_body_contract/);
  assert.match(garmentWorkerV15Source, /body_points_world/);
  assert.match(garmentWorkerV15Source, /clouvaAvatarBodyHeight/);
  assert.match(garmentWorkerV15Source, /clouvaBodyTargetMin/);
  assert.match(garmentWorkerV15Source, /clouvaBodyTargetMax/);
  assert.match(garmentWorkerV15Source, /def validate_roundtrip_v15/);
  assert.match(garmentWorkerV15Source, /El pantalón volvió a quedar gigante respecto del cuerpo real/);
  assert.doesNotMatch(garmentWorkerV15Source, /waist\.z - left_foot\.z/);
  assert.equal(workerCopiesAllPython, true);
});

test("V43 mantiene la referencia visible del avatar activo", () => {
  assert.match(garmentDockerfile, /CLOUVA_RIG_VERSION=v43/);
  assert.match(garmentDockerfile, /CLOUVA_UNREAL_MOLD_RIG=v2/);
  assert.match(garmentApiV8Source, /def run_fresh_garment_rig/);
  assert.match(garmentApiV8Source, /def resolve_user_avatar_url/);
  assert.match(garmentApiV8Source, /CLOUVA_AVATAR_REFERENCE_PATH/);
  assert.match(garmentApiV8Source, /freshRigApplied/);
  assert.match(garmentExporterSource, /def _measure_avatar_reference/);
  assert.match(garmentExporterSource, /def prepare_wearable_object_v28/);
  assert.match(garmentExporterSource, /avatarReferenceNormalized/);
  assert.match(garmentExporterSource, /def _repair_collapsed_garment_volume/);
  assert.match(garmentExporterSource, /def validate_fbx_roundtrip_v28/);
  assert.match(garmentWorkerV20Source, /def validate_upper_volume_v27/);
  assert.match(garmentWorkerV20Source, /clouvaFinalDimensions/);
});

test("V30 evita doble rigging y separa Meshy original de prenda ajustada", () => {
  assert.match(garmentDockerfile, /CLOUVA_GARMENT_SOURCE_ROUTING=v30/);
  assert.match(garmentApiV8Source, /GARMENT_SOURCE_ROUTING_VERSION = "v30-single-pass"/);
  assert.match(garmentApiV8Source, /source_already_rigged: bool = False/);
  assert.match(garmentApiV8Source, /if not request\.source_already_rigged/);
  assert.match(garmentApiV8Source, /X-Clouva-Fresh-Rig/);
  assert.match(unrealExportRouteSource, /source_already_rigged: sourceAlreadyRigged/);
  assert.match(unrealExportRouteSource, /single-pass-auto-rig/);
  assert.doesNotMatch(unrealExportRouteSource, /finalizeClothingItem/);
});

test("Inspector V2 y el estudio visual mantienen el diagnóstico real", () => {
  assert.equal(workerCopiesAllPython, true);
  assert.match(garmentDockerfile, /CLOUVA_WORKER_INSPECTOR=v2/);
  assert.match(workerInspectorApiSource, /v2-single-pass-awareness/);
  assert.match(workerInspectorApiSource, /preserve-existing-rig/);
  assert.match(workerInspectorApiSource, /Meshy original listo/);
  assert.match(workerInspectorBlenderSource, /rawGarmentReadyForRig/);
  assert.match(workerInspectorBlenderSource, /sourceKind/);
  assert.match(workerInspectorBlenderSource, /Meshy original: el Worker creará el esqueleto/);
  assert.doesNotMatch(unrealObjectExportSource, /<SmartTryOnViewer/);
  assert.match(unrealObjectExportSource, /RealGarmentReview/);
  assert.match(unrealObjectExportSource, /REVISAR CON BLENDER/);
  assert.match(unrealObjectExportSource, /INSPECTOR TÉCNICO DEL WORKER/);
  assert.match(unrealObjectExportSource, /APROBAR PRENDA/);
  assert.match(unrealObjectExportSource, /Frente/);
  assert.match(unrealObjectExportSource, /Espalda/);
  assert.match(unrealObjectExportSource, /Caminar/);
  assert.match(unrealObjectExportSource, /Herramientas activas/);
  assert.match(unrealObjectExportSource, /Recorrido de esta prenda/);
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
