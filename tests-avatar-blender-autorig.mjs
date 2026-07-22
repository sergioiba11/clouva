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
const analyzerWorker = readFileSync("worker/garment-rig/app_v17.py", "utf8");
const dockerfile = readFileSync("worker/garment-rig/Dockerfile", "utf8");
const analyzer = readFileSync("worker/garment-rig/avatar_analyzer.py", "utf8");
const segmenterV3 = readFileSync("worker/garment-rig/anatomy_segmenter_v3.py", "utf8");
const anatomyBvh = readFileSync("worker/garment-rig/anatomy_bvh.py", "utf8");
const technicalPasses = readFileSync("worker/garment-rig/technical_passes.py", "utf8");
const projector = readFileSync("worker/garment-rig/landmark_projector_3d.py", "utf8");
const triangulator = readFileSync("worker/garment-rig/ray_triangulator.py", "utf8");
const limbCenterline = readFileSync("worker/garment-rig/limb_centerline.py", "utf8");
const geodesics = readFileSync("worker/garment-rig/mesh_geodesics.py", "utf8");
const crossSections = readFileSync("worker/garment-rig/cross_section_analyzer.py", "utf8");
const handTopology = readFileSync("worker/garment-rig/hand_topology_segmenter.py", "utf8");
const medialGraph = readFileSync("worker/garment-rig/hand_medial_graph.py", "utf8");
const branchDetector = readFileSync("worker/garment-rig/finger_branch_detector.py", "utf8");
const handAnalyzer = readFileSync("worker/garment-rig/hand_analyzer.py", "utf8");
const detector2d = readFileSync("worker/garment-rig/landmark_detector_2d.py", "utf8");
const diagnosticBuilder = readFileSync("worker/garment-rig/diagnostic_builder.py", "utf8");
const multiview = readFileSync("worker/garment-rig/multiview_renderer.py", "utf8");
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
  for (const label of ["Preparando avatar en Blender", "Creando esqueleto", "Asignando pesos", "Listo para Unreal"]) {
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

test("Avatar Analyzer V3 proyecta contra BVH exclusivos de la región renderizada", () => {
  assert.match(analyzer, /build_anatomy_bvh/);
  assert.match(anatomyBvh, /class AnatomyBVH/);
  assert.match(anatomyBvh, /BVHTree\.FromPolygons/);
  assert.match(anatomyBvh, /source_polygon/);
  assert.match(anatomyBvh, /source_vertices/);
  assert.match(multiview, /anatomy_bvh\.proxy/);
  assert.match(projector, /if anatomy_bvh is not None:/);
  assert.match(projector, /hit = anatomy_bvh\.ray_cast/);
  assert.match(projector, /exact-region-bvh-plus-technical-pass-v3/);
});

test("cada vista genera profundidad, normales, curvatura e IDs exactos", () => {
  for (const token of ["depth.npy", "normal.npy", "curvature.npy", "region_id.npy", "object_id.npy", "triangle_id.npy"]) {
    assert.ok(technicalPasses.includes(token), `Falta pase técnico ${token}`);
  }
  assert.match(technicalPasses, /anatomy_bvh\.ray_cast/);
  assert.match(projector, /depthResidual/);
  assert.match(projector, /normalCompatibility/);
  assert.match(projector, /regionCompatibility/);
  assert.match(triangulator, /TECHNICAL_EVIDENCE_GATE_FAILED/);
  assert.match(triangulator, /depth_confidence/);
  assert.match(triangulator, /normal_confidence/);
});

test("brazos y piernas usan grafos geodésicos y secciones, no porcentajes finales", () => {
  assert.match(geodesics, /class RegionGraph/);
  assert.match(geodesics, /def dijkstra/);
  assert.match(limbCenterline, /original-mesh-geodesic-centerline/);
  assert.match(crossSections, /choose_joint_section/);
  assert.match(segmenterV3, /preservesExternalRefinedVectors/);
  assert.match(analyzer, /refine_limb_joints/);
  assert.match(limbCenterline, /usesFixedPercentagesAsFinalAnswer/);
});

test("manos topology-first detectan ramas antes de asignar nombres MediaPipe", () => {
  assert.match(medialGraph, /surface-geodesic-distal-maxima-plus-shared-prefix-v3/);
  assert.match(handTopology, /detect_medial_branches/);
  assert.match(branchDetector, /assign_finger_branches/);
  assert.match(handTopology, /apply_finger_region_labels/);
  assert.match(handAnalyzer, /build_anatomy_bvh/);
  assert.match(handAnalyzer, /finger-region-bvh-v3/);
  assert.match(handAnalyzer, /geometry_first_finger_branch/);
  assert.doesNotMatch(handAnalyzer, /body_height\s*\*/);
});

test("MediaPipe usa RGB y bordes y no asigna confianza fija a todos los puntos", () => {
  assert.match(detector2d, /edgePath/);
  assert.match(detector2d, /_agreement_confidence/);
  assert.match(detector2d, /detectorConfidence/);
  assert.match(detector2d, /viewQualityConfidence/);
  assert.doesNotMatch(detector2d, /"visualConfidence": 0\.88/);
  assert.doesNotMatch(detector2d, /"thumb_metacarpal"\s*:/);
});

test("el estado corporal distingue subsistemas y warnings bloqueantes", () => {
  assert.match(analyzer, /body_core/);
  assert.match(analyzer, /left_arm/);
  assert.match(analyzer, /right_leg/);
  assert.match(analyzer, /blockingWarnings/);
  assert.match(analyzer, /nonBlockingWarnings/);
  assert.match(analyzer, /BODY_INTERNAL_JOINT_OUTSIDE_REGION/);
});

test("el diagnóstico V3 se conserva por run_id y acepta correcciones separadas", () => {
  assert.match(analyzerWorker, /RUN_CACHE_ROOT/);
  assert.match(analyzerWorker, /avatar_analysis_corrections\.json/);
  assert.match(analyzerWorker, /\/avatar\/analyze\/result\/\{run_id\}/);
  assert.match(analyzerWorker, /automaticPosition/);
  assert.match(analyzerWorker, /correctedPosition/);
  assert.doesNotMatch(analyzerWorker, /storage\.from\(/);
});

test("el diagnóstico sigue separado de Armature, pesos y avatar oficial", () => {
  assert.doesNotMatch(analyzer, /create_fresh_schema_armature|bind_geometry_aware_weights/);
  assert.match(diagnosticBuilder, /internal_joint_position/);
  assert.match(diagnosticBuilder, /surface_display_position/);
  assert.match(diagnosticBuilder, /duplicateLandmarksHidden/);
  assert.doesNotMatch(diagnosticBuilder, /BODY_EDGES\s*=/);
  assert.match(analyzerPanel, /Compatibilidad corporal/);
  assert.match(analyzerPanel, /Superficie verificada/);
  assert.match(analyzerPanel, /Articulaciones internas/);
  assert.match(analyzerPanel, /Candidatos rechazados/);
});
