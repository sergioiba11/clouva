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
const analyzerRoute = readFileSync("app/api/avatar/analyze/route.ts", "utf8");
const libraryButton = readFileSync("components/library/ActiveAvatarDownload.tsx", "utf8");
const analyzerPanel = readFileSync("components/library/AvatarAnalyzerPreview.tsx", "utf8");
const libraryPage = readFileSync("app/biblioteca/page.tsx", "utf8");
const meshy = readFileSync("lib/meshy.ts", "utf8");
const creatorStudio = readFileSync("components/creator-studio/CreatorStudioSimple.tsx", "utf8");
const workerAutorig = readFileSync("worker/garment-rig/autorig_avatar_v16.py", "utf8");
const workerApp = readFileSync("worker/garment-rig/app_v16.py", "utf8");
const analyzerWorker = readFileSync("worker/garment-rig/app_v17.py", "utf8");
const analyzerScript = readFileSync("worker/garment-rig/avatar_analyzer.py", "utf8");
const bodyAnalyzer = readFileSync("worker/garment-rig/body_analyzer.py", "utf8");
const faceAnalyzer = readFileSync("worker/garment-rig/face_analyzer.py", "utf8");
const handAnalyzer = readFileSync("worker/garment-rig/hand_analyzer.py", "utf8");
const detector2d = readFileSync("worker/garment-rig/landmark_detector_2d.py", "utf8");
const projector3d = readFileSync("worker/garment-rig/landmark_projector_3d.py", "utf8");
const diagnosticBuilder = readFileSync("worker/garment-rig/diagnostic_builder.py", "utf8");
const dockerfile = readFileSync("worker/garment-rig/Dockerfile", "utf8");

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

test("Avatar Analyzer queda separado del Armature y produce diagnóstico multivista", () => {
  assert.match(analyzerWorker, /@app\.post\("\/avatar\/analyze"\)/);
  assert.match(analyzerWorker, /@app\.post\("\/avatar\/analyze-preview"\)/);
  assert.match(analyzerWorker, /"X-Clouva-Rig-Modified": "false"/);
  assert.match(analyzerScript, /fingerRig": "not_connected_phase1"/);
  assert.match(analyzerScript, /facialRig": "not_connected_phase1"/);
  assert.doesNotMatch(analyzerScript, /create_fresh_schema_armature|bind_geometry_aware_weights/);
  for (const output of ["avatar_analysis.json", "diagnostic_report.json", "diagnostic_landmarks.glb", "renders_temporales"]) {
    assert.ok(analyzerScript.includes(output) || analyzerWorker.includes(output), `Falta salida ${output}`);
  }
});

test("cara y manos usan MediaPipe como candidatos y Blender confirma sobre la malla real", () => {
  assert.match(detector2d, /FaceLandmarker/);
  assert.match(detector2d, /HandLandmarker/);
  assert.match(detector2d, /HAND_MAP/);
  assert.match(projector3d, /scene\.ray_cast/);
  assert.match(projector3d, /rejectedHits/);
  assert.match(faceAnalyzer, /mediapipe-face-landmarker-plus-mesh-raycast-v1/);
  assert.match(handAnalyzer, /mediapipe-hand-landmarker-plus-mesh-raycast-v1/);
  assert.match(diagnosticBuilder, /export_extras=True/);
  assert.match(dockerfile, /mediapipe==0\.10\.14/);
  assert.match(dockerfile, /face_landmarker\.task/);
  assert.match(dockerfile, /hand_landmarker\.task/);
});

test("el mapa corporal incluye los nombres canónicos que necesitará Skeleton Planner", () => {
  for (const name of [
    "root", "pelvis", "spine_01", "spine_02", "chest", "neck", "head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "thigh_l", "calf_l", "foot_l", "ball_l",
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r", "thigh_r", "calf_r", "foot_r", "ball_r",
  ]) {
    assert.ok(bodyAnalyzer.includes(`"${name}"`), `Falta landmark canónico ${name}`);
  }
});

test("Biblioteca expone ANALIZAR AVATAR y muestra el GLB diagnóstico sin guardar otro avatar", () => {
  assert.match(libraryPage, /AvatarAnalyzerPreview/);
  assert.match(analyzerPanel, /ANALIZAR AVATAR/);
  assert.match(analyzerPanel, /model-viewer/);
  assert.match(analyzerPanel, /PUNTOS REALES SOBRE LA MALLA/);
  assert.match(analyzerRoute, /resolveOriginalAvatar/);
  assert.match(analyzerRoute, /\/avatar\/analyze-preview/);
  assert.match(analyzerRoute, /model\/gltf-binary/);
  assert.doesNotMatch(analyzerRoute, /storage\.from\("avatars"\)\.upload/);
});
