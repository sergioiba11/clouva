import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("the holographic wizard replaces the decorative /[runId] visualizer with a single real route", () => {
  assert.ok(!fs.existsSync(new URL("./app/avatar-analyzer-v4/[runId]/page.tsx", import.meta.url)));
  assert.ok(!fs.existsSync(new URL("./components/library/AvatarAnalyzerV4Diagnostics.tsx", import.meta.url)));
  const container = read("./components/library/AvatarAnalyzerPreview.tsx");
  assert.ok(!container.includes("avatar-analyzer-v4/${"), "dead link to the removed professional visualizer route");
});

test("the R3F viewer renders the real GLB with real landmarks and a real skeleton, not a decorative overlay", () => {
  const source = read("./components/library/avatar-analyzer/AvatarAnalyzerViewer.tsx");
  for (const token of [
    "useGLTF",
    "SkeletonHelper",
    "getLandmarkPosition",
    "getLandmarkVisualState",
    "hologramMaterial",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("view-model helpers never mix surface and internal-joint positions and count full regions", () => {
  const source = read("./components/library/avatar-analyzer/view-model.ts");
  assert.ok(source.includes("export function getSurfacePosition"));
  assert.ok(source.includes("export function getInternalPosition"));
  assert.ok(source.includes("export function getLandmarkType"));
  assert.ok(source.includes("export function getRegionStats"));
  assert.ok(source.includes("export function computeStageBoundingBox"));
  // getSurfacePosition() itself must never fall back to internalJointPosition --
  // only getLandmarkPosition() is allowed to combine them, and only per landmark type.
  const surfaceFnBody = source.match(/export function getSurfacePosition\([^{]*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(surfaceFnBody.length > 0, "could not isolate getSurfacePosition body");
  assert.ok(!surfaceFnBody.includes("internalJointPosition"));
});

test("the wizard exposes the required stages, filters and human-readable technical actions", () => {
  const source = read("./components/library/avatar-analyzer/WizardStepper.tsx");
  for (const token of [
    "Avatar asignado",
    "Cuerpo",
    "Manos",
    "Cara",
    "Big Data",
    "Revisión 360°",
    "Confirmación",
    "Superficie",
    "Articulaciones",
    "Bloqueantes",
    "AVANZAR AL SIGUIENTE PASO",
    "getHumanRecommendedAction",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("the landmark inspector exposes the professional inspection controls", () => {
  const source = read("./components/library/avatar-analyzer/LandmarkInspector.tsx");
  for (const token of [
    "Anterior",
    "Siguiente",
    "Centrar punto",
    "Corregir",
    "Ver evidencia",
    "Posición superficial",
    "Posición interna",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("manual corrections never send surface_click and proposed_internal_position for the same surface landmark", () => {
  const source = read("./components/library/avatar-analyzer/useAvatarAnalyzer.ts");
  assert.ok(source.includes("export function buildCorrectionPayload"));
  assert.ok(source.includes('isInternalJoint ? { proposed_internal_position: point } : {}'));
});

test("manual confirmation persists into the existing avatar_analyzer_jobs.summary column, no new table", () => {
  const source = read("./app/api/avatar/analyze/_shared.ts");
  assert.ok(source.includes("export async function approveAnalyzerRun"));
  assert.ok(source.includes('.update({ summary: nextSummary })'));
  const route = read("./app/api/avatar/analyze/result/[runId]/approve/route.ts");
  assert.ok(route.includes("approveAnalyzerRun"));
});

test("V4 API remains side-by-side with V3.2 and reanalysis uses a clean source", () => {
  const source = read("./worker/garment-rig/app_v18.py");
  const persistedCache = read("./worker/garment-rig/app_v17.py");
  assert.match(source, /import app_v17 as v32/);
  assert.match(source, /\/avatar\/analyze-v4/);
  assert.match(source, /\/avatar\/complete-rig-v4/);
  assert.match(source, /legacyV32Preserved/);
  assert.match(source, /_rerun_cached_source_v4/);
  assert.match(source, /_persist_run_v4/);
  assert.match(source, /V4_DURABLE_SUFFIXES/);
  assert.match(source, /clouva-run-staging-/);
  assert.match(source, /ANALYZER_RESULT_STILL_PERSISTING/);
  assert.match(source, /PUBLIC_RESULT_BUDGET_BYTES/);
  assert.doesNotMatch(source, /"acceptedLandmarks": accepted/);
  assert.doesNotMatch(source, /"rejectedLandmarks": rejected/);
  assert.doesNotMatch(source, /shutil\.copytree\(output_dir/);
  assert.match(persistedCache, /incomplete/);
  assert.match(persistedCache, /shutil\.rmtree\(destination/);
  assert.match(source, /executedAsCleanPipeline/);
  assert.match(source, /ANALYZER_RESULT_STALE/);
});

test("confidence, states, readiness and profiles are versioned", () => {
  const source = read("./worker/garment-rig/analyzer_v4_contract.py");
  for (const token of [
    "views == 0",
    "inliers == 0",
    "verified_visual_geometry",
    "verified_geometry_fallback",
    "verified_single_view_depth",
    "topology_invalid",
    "body_only",
    "full_humanoid",
    "bodyRigReady",
    "leftHandBaseReady",
    "leftFingerRigReady",
    "diagnostic_fingerprint",
    "APPROVED_STATES",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("technical passes preserve exact surface evidence", () => {
  const source = read("./worker/garment-rig/technical_passes.py");
  for (const token of [
    "world_position.npy",
    "valid_mask.npy",
    "primary_region_id.npy",
    "primary_region_weight.npy",
    "secondary_region_mask.npy",
    "triangle_id.npy",
    "barycentric.npy",
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

test("boundary triangles are shared instead of discarded by majority", () => {
  const bvh = read("./worker/garment-rig/anatomy_bvh.py");
  const semantics = read("./worker/garment-rig/anatomy_semantics.py");
  assert.ok(bvh.includes("secondary_regions"));
  assert.ok(bvh.includes("global_triangle_id"));
  assert.ok(bvh.includes("boundary"));
  assert.ok(semantics.includes("adjacent_boundary"));
  assert.doesNotMatch(bvh, /def _majority_region/);
});

test("shared version contract drives backend and frontend", () => {
  const version = JSON.parse(read("./worker/garment-rig/avatar_analyzer_version.json"));
  assert.equal(version.analyzerVersion, "clouva-avatar-analyzer-v4.1");
  assert.equal(version.mapVersion, "clouva-anatomical-map-v4.1");
  assert.equal(version.frontendVersion, "clouva-avatar-visualizer-v4.1");
});

test("V4.1 has a permanent in-app entry and the Biblioteca flow calls V4", () => {
  const landing = read("./app/avatar-analyzer-v4/page.tsx");
  const navigation = read("./components/clouva/MinimalNavigation.tsx");
  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");
  const analyzeRoute = read("./app/api/avatar/analyze/route.ts");
  const resultRoute = read("./app/api/avatar/analyze/result/[runId]/route.ts");
  const assetRoute = read("./app/api/avatar/analyze/result/[runId]/asset/[...assetPath]/route.ts");
  const latestRoute = read("./app/api/avatar/analyze/latest/route.ts");

  assert.match(landing, /AvatarAnalyzerPreview/);
  assert.match(navigation, /href: "\/avatar-analyzer-v4"/);
  assert.match(preview, /AVATAR ANALYZER V4\.1/);
  assert.match(preview, /ABRIR ÚLTIMO ANÁLISIS/);
  // The old "ABRIR VISUALIZER PROFESIONAL" link pointed at the now-removed
  // /avatar-analyzer-v4/[runId] duplicate route -- the holographic wizard is
  // inline here now, not a separate page.
  assert.match(preview, /WizardStepper/);
  assert.match(analyzeRoute, /runAnalyzerJob/);
  assert.match(resultRoute, /\/avatar\/analyze-v4\/result/);
  assert.match(assetRoute, /\/avatar\/analyze-v4\/result/);
  assert.match(latestRoute, /avatar_analyzer_v4/);
});

test("Blender Worker provides a software-rendered display for Workbench", () => {
  const dockerfile = read("./worker/garment-rig/Dockerfile");
  const launcher = read("./worker/garment-rig/blender-headless.sh");
  const smokeTest = read("./worker/garment-rig/test_blender_headless_render.py");

  assert.match(dockerfile, /xvfb/);
  assert.match(dockerfile, /xauth/);
  assert.match(dockerfile, /BLENDER_BIN=\/usr\/local\/bin\/blender-headless/);
  assert.match(dockerfile, /test_blender_headless_render\.py/);
  assert.match(launcher, /LIBGL_ALWAYS_SOFTWARE/);
  assert.match(launcher, /GALLIUM_DRIVER/);
  assert.match(launcher, /xvfb-run/);
  assert.match(smokeTest, /BLENDER_WORKBENCH/);
  assert.match(smokeTest, /bpy\.ops\.render\.render/);
});

test("Avatar Analyzer bounds topology, textures and orientation memory", () => {
  const guard = read("./worker/garment-rig/analysis_memory_guard.py");
  const orientation = read("./worker/garment-rig/canonical_orientation.py");
  const analyzer = read("./worker/garment-rig/avatar_analyzer.py");
  const contract = read("./worker/garment-rig/analyzer_v4_contract.py");
  const dockerfile = read("./worker/garment-rig/Dockerfile");

  assert.match(guard, /CLOUVA_AVATAR_ANALYZER_MAX_POLYGONS/);
  assert.match(guard, /MAX_ANALYSIS_POLYGONS/);
  assert.match(guard, /DECIMATE/);
  assert.match(guard, /_release_analysis_images/);
  assert.match(orientation, /MAX_ORIENTATION_POINTS/);
  assert.match(orientation, /obj\.data\.users > 1/);
  assert.match(analyzer, /prepare_analysis_meshes/);
  assert.match(contract, /"body_resolution": 512/);
  assert.match(contract, /"face_crop_resolution": 384/);
  assert.match(contract, /"hand_crop_resolution": 320/);
  assert.match(contract, /"technical_resolution": 192/);
  assert.match(analyzer, /resolution=384, technical_resolution=192/);
  assert.match(analyzer, /resolution=512,\s*technical_resolution=224/);
  assert.match(dockerfile, /test_analysis_memory_guard\.py/);
});

test("Avatar Analyzer sanitizes the GLB before Blender without touching the source", () => {
  const api = read("worker/garment-rig/app_v18.py");
  const sanitizer = read("worker/garment-rig/analysis_glb_sanitizer.py");
  const dockerfile = read("worker/garment-rig/Dockerfile");
  assert.match(api, /sanitize_glb_for_analysis\(input_path, analysis_input_path\)/);
  assert.match(api, /_run_v4_blender_phases\(\s*analysis_input_path,/);
  assert.match(api, /"--", str\(input_path\), str\(output_dir\)/);
  assert.match(api, /_persist_run_v4\(output_dir, analysis, input_path\)/);
  assert.match(sanitizer, /clouvaAnalysisSanitized/);
  assert.match(sanitizer, /primitive\.pop\("material", None\)/);
  assert.match(sanitizer, /"animations",/);
  assert.match(dockerfile, /test_analysis_glb_sanitizer\.py/);
});

test("Avatar Analyzer resets Blender memory between the base and V4 upgrade phases", () => {
  const api = read("worker/garment-rig/app_v18.py");
  const analyzer = read("worker/garment-rig/avatar_analyzer_v4.py");
  assert.match(api, /for phase in \("base", "upgrade"\)/);
  assert.match(api, /V4_PHASE_ENV: phase/);
  assert.match(analyzer, /if phase == "base"/);
  assert.match(analyzer, /if phase == "upgrade"/);
  assert.match(analyzer, /_restore_clean_analysis_scene\(input_path\)/);
});


test("Avatar Analyzer preserves retryable HTTP states and pending jobs across devices", () => {
  const resultRoute = read("./app/api/avatar/analyze/result/[runId]/route.ts");
  const kickoff = read("./app/api/avatar/analyze/route.ts");
  const job = read("./app/api/avatar/analyze/job/[jobId]/route.ts");
  const latest = read("./app/api/avatar/analyze/latest/route.ts");
  const shared = read("./app/api/avatar/analyze/_shared.ts");
  assert.match(resultRoute, /FORWARDED_WORKER_STATUSES/);
  assert.match(resultRoute, /Retry-After/);
  assert.match(resultRoute, /ANALYZER_RESULT_INVALID_JSON/);
  assert.match(kickoff, /persistPendingAnalyzerJob/);
  assert.match(job, /persistCompletedAnalyzerJob/);
  assert.match(job, /getAnalyzerJobForUser/);
  assert.match(latest, /pendingStatus/);
  assert.match(shared, /METADATA_UPDATE_ATTEMPTS/);
  assert.match(shared, /avatar_analyzer_v4_pending/);
});


test("Avatar Analyzer frontend separates process, detail and asset failures", () => {
  // The state machine and retry plumbing now live in the useAvatarAnalyzer
  // hook; the container (AvatarAnalyzerPreview) and the wizard consume it.
  const hook = read("./components/library/avatar-analyzer/useAvatarAnalyzer.ts");
  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");
  const wizard = read("./components/library/avatar-analyzer/WizardStepper.tsx");
  const wizardStyles = read("./components/library/avatar-analyzer/avatar-analyzer-wizard.module.css");
  assert.match(hook, /export type AnalysisProcessState/);
  assert.match(hook, /export type DetailState/);
  assert.match(hook, /export type AssetState/);
  assert.match(hook, /Promise\.all\(\[/);
  assert.match(hook, /DETAIL_MAX_ATTEMPTS/);
  assert.match(preview, /REINTENTAR CARGA DEL DETALLE/);
  assert.match(wizard, /Incompatibilidades visuales\/técnicas/);
  assert.match(preview, /Resultado persistido/);
  assert.doesNotMatch(hook, /if \(error\) return \{ label: "ERROR TÉCNICO"/);
  // Horizontal scroll + safe-area now belong to the wizard's stepper/filters/footer, not a camera-preset bar.
  assert.match(wizardStyles, /overflow-x: auto/);
  assert.match(wizardStyles, /safe-area-inset-bottom/);
});


test("restored Analyzer results retain their compact summary and next action", () => {
  const shared = read("./app/api/avatar/analyze/_shared.ts");
  const latest = read("./app/api/avatar/analyze/latest/route.ts");
  const hook = read("./components/library/avatar-analyzer/useAvatarAnalyzer.ts");
  const wizard = read("./components/library/avatar-analyzer/WizardStepper.tsx");
  assert.match(shared, /summary: args\.summary/);
  assert.match(latest, /summary: asRecord\(stored\.summary\)/);
  assert.match(hook, /setSummary\(latest\.summary/);
  assert.match(wizard, /Próxima acción/);
  assert.match(wizard, /0\/7 vistas significa/);
});


test("requested profile semantics remain separate from advanced modules", () => {
  const contract = read("worker/garment-rig/analyzer_v4_contract.py");
  assert.match(contract, /def evaluate_body_basic_readiness/);
  assert.match(contract, /"requestedProfileReady": requested_supported/);
  assert.match(contract, /"verified_internal_geometry"/);
  assert.match(contract, /"requiresVisualViews": requires_visual_views/);
});

test("technical projection preserves region identity without requiring a recast hit", () => {
  const projector = read("worker/garment-rig/landmark_projector_3d.py");
  assert.match(projector, /technical_projection_identity/);
  assert.match(projector, /"technicalRegion": technical_region/);
  assert.match(projector, /BVH_RECAST_MISS_WITH_VALID_TECHNICAL_POINT/);
});

test("hand renderer includes wrist context and coverage auto-fit", () => {
  const renderer = read("worker/garment-rig/multiview_renderer_v4.py");
  assert.match(renderer, /HAND_TARGET_COVERAGE/);
  assert.match(renderer, /handRetryPerformed/);
  assert.match(renderer, /hand_\{suffix\}_distal/);
});

test("phased results expose real face/hand evidence and the clean source GLB", () => {
  const api = read("worker/garment-rig/app_v18.py");
  const analyzer = read("worker/garment-rig/avatar_analyzer_v4.py");
  const contract = read("worker/garment-rig/analyzer_contract.py");
  const preview = read("components/library/AvatarAnalyzerPreview.tsx");
  const wizard = read("components/library/avatar-analyzer/WizardStepper.tsx");
  assert.match(api, /renders_v4_face/);
  assert.match(api, /renders_v4_hands/);
  assert.match(api, /source\/avatar-original-clean\.glb/);
  assert.match(api, /diagnostic_surface\.glb/);
  assert.match(analyzer, /merge_phase_detection_coverage/);
  assert.match(analyzer, /build_surface_glb/);
  assert.match(contract, /"framingInvalidViews"/);
  assert.match(contract, /"detectorExecutedViews"/);
  // "Mostrar diagnóstico" swapped a whole GLB; the wizard now draws markers
  // itself over the same diagnostic_surface.glb, so the toggle is "Mostrar puntos".
  assert.match(wizard, /Mostrar puntos/);
  assert.match(preview, /CONTINUAR CON CUERPO \+ MANOS SIMPLIFICADAS/);
});

test("mobile analyzer prioritizes requested profile and hides internal correction noise", () => {
  const wizard = read("components/library/avatar-analyzer/WizardStepper.tsx");
  const inspector = read("components/library/avatar-analyzer/LandmarkInspector.tsx");
  assert.match(wizard, /Perfil solicitado/);
  assert.match(wizard, /Listo para rig corporal/);
  // The old single "show everything" toggle became real filter chips.
  assert.match(wizard, /Verificados/);
  assert.match(wizard, /Pendientes/);
  assert.match(inspector, /record\.requiresVisualViews === false \? "No requiere"/);
});

test("cancellation terminates the Blender subprocess and frees the worker lock", () => {
  const api = read("worker/garment-rig/app_v18.py");
  assert.match(api, /class AnalysisCancelled\(Exception\)/);
  assert.match(api, /_RUNNING_JOBS_LOCK = threading\.Lock\(\)/);
  assert.match(api, /def _kill_process_group\(proc: subprocess\.Popen\)/);
  assert.match(api, /os\.killpg\(os\.getpgid\(proc\.pid\), signal\.SIGTERM\)/);
  assert.match(api, /os\.killpg\(os\.getpgid\(proc\.pid\), signal\.SIGKILL\)/);
  assert.match(api, /@app\.post\("\/avatar\/analyze-v4\/job\/\{job_id\}\/cancel"\)/);
  assert.match(api, /if _job_cancel_requested\(job_id\):\s*\n\s*raise AnalysisCancelled\(\)/);
  assert.match(api, /except AnalysisCancelled:\s*\n\s*_write_job_status\(job_id, \{"status": "cancelled"\}\)/);
});

test("cancellation is wired end to end through the API layer and the mobile UI", () => {
  const cancelRoute = read("./app/api/avatar/analyze/job/[jobId]/cancel/route.ts");
  const shared = read("./app/api/avatar/analyze/_shared.ts");
  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");
  const hook = read("./components/library/avatar-analyzer/useAvatarAnalyzer.ts");
  const styles = read("./components/library/avatar-analyzer-preview.module.css");
  assert.match(cancelRoute, /cancelAnalyzerExecution/);
  assert.match(cancelRoute, /requestAnalyzerJobCancellation/);
  assert.match(cancelRoute, /finalizeAnalyzerJobCancellation/);
  assert.match(cancelRoute, /persistCancelledAnalyzerJob/);
  assert.match(shared, /export async function persistCancelledAnalyzerJob/);
  assert.match(shared, /export async function finalizeAnalyzerJobCancellation/);
  assert.match(preview, /CANCELAR ANÁLISIS/);
  assert.match(hook, /cancelRequestedRef/);
  assert.match(hook, /activeJobIdRef/);
  assert.match(hook, /shouldStop: \(\) => boolean/);
  assert.match(hook, /data\.status === "cancelled"/);
  assert.match(hook, /function workerStateLabel/);
  assert.doesNotMatch(hook, /analysisProcessState === "failed" \? "Error" : "Disponible"/);
  assert.match(styles, /\.cancelAction/);
});

test("storage inventory diagnostics classify the run-cache disk without leaking file names", () => {
  const api = read("worker/garment-rig/app_v18.py");
  assert.match(api, /@app\.get\("\/diagnostics\/avatar-analyzer-v4-storage-inventory"\)/);
  assert.match(api, /def _classify_cache_file\(path: Path, run_cache_root: Path\) -> str/);
  assert.match(api, /"glb_source"/);
  assert.match(api, /"glb_diagnostic"/);
  assert.match(api, /"renders"/);
  assert.match(api, /"results_json"/);
  assert.match(api, /incompleteOrAbandonedRuns/);
  assert.match(api, /jobStatusCache/);
});

test("volume-to-GCS migration endpoint is token-gated and verifies checksums before counting a file as uploaded", () => {
  const api = read("worker/garment-rig/app_v18.py");
  const dockerfile = read("worker/garment-rig/Dockerfile");
  assert.match(api, /@app\.post\("\/diagnostics\/avatar-analyzer-v4-migrate-to-gcs"\)/);
  assert.match(api, /CLOUVA_MIGRATION_TOKEN/);
  assert.match(api, /if not expected_token or x_migration_token != expected_token/);
  assert.match(api, /checksum="crc32c"/);
  assert.match(api, /sha256 mismatch after upload/);
  assert.match(api, /CLOUVA_GCS_MIGRATION_CREDENTIALS_JSON/);
  assert.match(dockerfile, /google-cloud-storage==/);
  assert.match(api, /def _run_migration_to_gcs_background\(/);
  assert.match(api, /threading\.Thread\(\s*\n\s*target=_run_migration_to_gcs_background/);
  assert.match(api, /@app\.get\("\/diagnostics\/avatar-analyzer-v4-migrate-to-gcs\/\{migration_job_id\}"\)/);
  assert.match(api, /"migrationJobId": migration_job_id, "status": "running"/);
});
