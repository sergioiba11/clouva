import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const sourceRoots = ["app", "components", "lib"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const forbiddenRiggingRoute = ["", "openapi", "v1", "rigging"].join("/");

function walk(path) {
  const result = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) result.push(...walk(fullPath));
    else if ([...sourceExtensions].some((extension) => fullPath.endsWith(extension))) result.push(fullPath);
  }
  return result;
}

const sourceFiles = sourceRoots.flatMap(walk);
const rigRoute = readFileSync("app/api/avatar/rig/route.ts", "utf8");
const libraryButton = readFileSync("components/library/ActiveAvatarDownload.tsx", "utf8");
const meshy = readFileSync("lib/meshy.ts", "utf8");
const creatorStudio = readFileSync("components/creator-studio/CreatorStudioSimple.tsx", "utf8");
const workerAutorig = readFileSync("worker/garment-rig/autorig_avatar_v16.py", "utf8");
const workerApp = readFileSync("worker/garment-rig/app_v16.py", "utf8");
const dockerfile = readFileSync("worker/garment-rig/Dockerfile", "utf8");
const analyzer = readFileSync("worker/garment-rig/avatar_analyzer.py", "utf8");
const segmenter = readFileSync("worker/garment-rig/anatomy_segmenter.py", "utf8");
const triangulator = readFileSync("worker/garment-rig/ray_triangulator.py", "utf8");
const fingerCenterline = readFileSync("worker/garment-rig/finger_centerline.py", "utf8");
const handAnalyzer = readFileSync("worker/garment-rig/hand_analyzer.py", "utf8");
const detector2d = readFileSync("worker/garment-rig/landmark_detector_2d.py", "utf8");
const diagnosticBuilder = readFileSync("worker/garment-rig/diagnostic_builder.py", "utf8");
const analyzerPanel = readFileSync("components/library/AvatarAnalyzerPreview.tsx", "utf8");

test("el autorig de avatar no puede volver a llamar la ruta de rigging de Meshy", () => {
  const offenders = sourceFiles.filter((file) => readFileSync(file, "utf8").includes(forbiddenRiggingRoute));
  assert.deepEqual(offenders, [], `Se encontró la ruta prohibida en: ${offenders.join(", ")}`);
  assert.doesNotMatch(rigRoute, /createRiggingTask|getRiggingTask|@\/lib\/meshy/);
});

test("Meshy sigue disponible para generar avatares y prendas", () => {
  assert.match(meshy, /createPreviewTask/);
  assert.match(meshy, /createRefineTask/);
  assert.match(meshy, /createMultiImageTask/);
  assert.match(meshy, /multi-image-to-3d/);
});

test("AUTORIGGEAR AVATAR envía el original limpio al Blender Worker", () => {
  assert.match(libraryButton, /fetch\("\/api\/avatar\/rig"/);
  assert.doesNotMatch(libraryButton, /debug\/rig-official/);
  assert.match(rigRoute, /\/avatar\/complete-rig/);
  assert.match(rigRoute, /completeRigWithWorker\(source\.originalUrl\)/);
  assert.match(rigRoute, /sourceKind: "original-clean-glb"/);
  assert.match(rigRoute, /randomUUID\(\)/);
  assert.match(rigRoute, /jobIsActive\(storedJob, source\)/);
});

test("un avatar terminado no vuelve a riggearse y un trabajo activo no se duplica", () => {
  assert.match(rigRoute, /if \(alreadyRigged && !retry\) \{/);
  assert.match(rigRoute, /const retry = action === "retry"/);
  assert.match(rigRoute, /if \(jobIsActive\(storedJob, source\)\) \{/);
  assert.match(rigRoute, /resumed: true/);
});

test("Blender guarda el resultado en Supabase y actualiza el avatar activo", () => {
  assert.match(rigRoute, /storage\.from\("avatars"\)\.upload/);
  assert.match(rigRoute, /COMPLETE_FILENAME/);
  assert.match(rigRoute, /model_url: publicUrl/);
  assert.match(rigRoute, /is_active: true/);
  assert.match(rigRoute, /avatar_3d_url: publicUrl/);
});

test("la interfaz muestra las cuatro etapas oficiales de Blender", () => {
  for (const label of [
    "Preparando avatar en Blender",
    "Creando esqueleto",
    "Asignando pesos",
    "Listo para Unreal",
  ]) {
    assert.ok(rigRoute.includes(label), `Falta la etapa ${label} en la API`);
    assert.ok(libraryButton.includes(label), `Falta la etapa ${label} en la interfaz`);
  }
});

test("Rehacer rig ejecuta Blender desde el original y no devuelve el rig anterior", () => {
  assert.match(creatorStudio, /action: avatarRigReady \? "retry" : "create"/);
  assert.match(rigRoute, /const createRequested = action === "create" \|\| retry/);
  assert.match(rigRoute, /completeRigWithWorker\(source\.originalUrl\)/);
  assert.match(rigRoute, /retry \? \{ job, profile: null \} : \{ job \}/);
  assert.match(workerAutorig, /import_original_fresh/);
  assert.match(workerAutorig, /oldArmaturesRemoved/);
  assert.match(workerAutorig, /vertexGroupsRemoved/);
});

test("AutoRig V16 crea un Armature nuevo desde CLOUVA_SKELETON_SCHEMA", () => {
  assert.match(workerApp, /autorig_avatar_v16\.py/);
  assert.match(workerAutorig, /create_fresh_schema_armature/);
  assert.match(workerAutorig, /bpy\.data\.armatures\.new\("CLOUVA_SKELETON_SCHEMA"\)/);
  assert.match(workerAutorig, /reusedArmature": False/);
  assert.match(workerAutorig, /canonicalize_and_validate_bones/);
  assert.match(dockerfile, /AutoRig V16 creates a brand-new 24-bone schema armature OK/);
});

test("cada Rehacer rig exige prueba criptográfica de una ejecución nueva", () => {
  assert.match(rigRoute, /EXPECTED_WORKER_RIG_VERSION = "v15-anatomical-landmark-autorig"/);
  assert.match(rigRoute, /proof\.inputSha256 === proof\.outputSha256/);
  assert.match(workerAutorig, /uuid\.uuid4\(\)\.hex/);
  assert.match(workerAutorig, /sha256_file\(output_path\)/);
  assert.match(workerAutorig, /rigVersionId/);
  assert.match(workerApp, /X-Clouva-Rig-Version-Id/);
});

test("AutoRig V16 detecta articulaciones sobre la malla y no escala un rig genérico", () => {
  assert.match(workerAutorig, /class MeshLandmarkDetector/);
  assert.match(workerAutorig, /cross-section-width-plus-limb-axis/);
  assert.match(workerAutorig, /fresh-schema-mesh-landmarks-v16/);
  assert.match(workerAutorig, /target-mesh-distal-axis-and-lateral-spread-v16/);
  assert.match(workerAutorig, /mesh-neck-section-to-crown-v16/);
  assert.match(workerAutorig, /skullBase/);
  assert.doesNotMatch(workerAutorig, /import_reference\(/);
  assert.doesNotMatch(workerAutorig, /fit_reference\(/);
});

test("AutoRig V16 genera pesos nuevos, limita cuatro influencias y prueba articulaciones", () => {
  assert.match(workerAutorig, /bind_geometry_aware_weights/);
  assert.match(workerAutorig, /cleanup_weights_max_four/);
  assert.match(workerAutorig, /maxInfluences": 4/);
  assert.match(workerAutorig, /articulation_smoke_test/);
  assert.match(workerAutorig, /non-destructive-articulation-smoke-test-v16/);
  assert.match(workerAutorig, /poseValidation/);
});

test("el Worker conserva temporalmente el contrato web V15 pero adjunta la prueba real V16", () => {
  assert.match(workerApp, /actualVersion/);
  assert.match(workerApp, /actualRigSource/);
  assert.match(workerApp, /V16_METHOD_SOURCE = "Blender fresh CLOUVA schema"/);
  assert.match(workerApp, /profile\["rigSource"\] = "Blender official Unreal reference"/);
  assert.match(workerApp, /profile\["landmarkFit"\]\["actualMethod"\]/);
  assert.match(workerApp, /weightedRatio.*0\.995/s);
});

test("Avatar Analyzer V2 segmenta regiones antes de buscar superficie", () => {
  assert.match(analyzer, /segment_anatomy/);
  assert.match(analyzer, /named-anatomy-region-nearest-surface-v2/);
  assert.match(segmenter, /upper_arm_l/);
  assert.match(segmenter, /forearm_l/);
  assert.match(segmenter, /hand_l/);
  assert.match(segmenter, /def _refine_arm/);
  assert.match(segmenter, /def _refine_leg/);
  assert.match(segmenter, /signed_lateral/);
  assert.doesNotMatch(analyzer, /same-side-nearest-mesh-anchor-v2/);
});

test("cara y manos usan triangulación en lugar de promediar impactos", () => {
  assert.match(triangulator, /robust_ray_triangulation/);
  assert.match(triangulator, /_least_squares/);
  assert.match(handAnalyzer, /triangulate_landmark/);
  assert.match(handAnalyzer, /segmentation\.hand_measurement/);
  assert.doesNotMatch(handAnalyzer, /body_height\s*\*\s*0\.105/);
  assert.doesNotMatch(handAnalyzer, /fuse_projected/);
});

test("MediaPipe emite exactamente una referencia canónica por articulación de mano", () => {
  assert.match(detector2d, /"handLandmarkCount": len\(HAND_MAP\)/);
  assert.doesNotMatch(detector2d, /"thumb_metacarpal"\s*:/);
  assert.doesNotMatch(detector2d, /"index_metacarpal"\s*:/);
  assert.doesNotMatch(detector2d, /"middle_metacarpal"\s*:/);
  assert.doesNotMatch(detector2d, /"ring_metacarpal"\s*:/);
  assert.doesNotMatch(detector2d, /"pinky_metacarpal"\s*:/);
});

test("cada dedo se refina contra su nube geométrica y se valida topológicamente", () => {
  assert.match(fingerCenterline, /finger_cloud_assignment/);
  assert.match(fingerCenterline, /cross_section_medial_refinement/);
  assert.match(fingerCenterline, /FINGER_CHAINS_CROSS/);
  assert.match(fingerCenterline, /FINGER_LATERAL_ORDER_INVALID/);
  assert.match(fingerCenterline, /hand_scale/);
});

test("el diagnóstico separa superficie, articulaciones internas y rechazados", () => {
  assert.match(diagnosticBuilder, /internal_joint_position/);
  assert.match(diagnosticBuilder, /surface_display_position/);
  assert.match(diagnosticBuilder, /duplicateLandmarksHidden/);
  assert.doesNotMatch(diagnosticBuilder, /BODY_EDGES\s*=/);
  assert.match(analyzerPanel, /Compatibilidad corporal humanoide/);
  assert.match(analyzerPanel, /Superficie verificada/);
  assert.match(analyzerPanel, /Articulaciones internas/);
  assert.match(analyzerPanel, /Candidatos rechazados/);
});
