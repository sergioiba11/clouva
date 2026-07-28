import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("V4.1 visualizer exposes the real GLB, evidence and professional controls", () => {
  const source = read("./components/library/AvatarAnalyzerV4Diagnostics.tsx");
  for (const token of [
    'createElement("model-viewer"',
    "versionContract",
    "Cuerpo",
    "Cara",
    "Mano izquierda",
    "Mano derecha",
    "Articulaciones internas",
    "Triángulos de frontera",
    "Siguiente error",
    "Pantalla completa",
    "Comparar automático / manual",
    "Body rig",
    "Export Unreal",
    "Corregir análisis",
    "Analizar y riggear",
  ]) assert.ok(source.includes(token), `missing ${token}`);
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
  assert.match(preview, /ABRIR VISUALIZER PROFESIONAL/);
  assert.match(analyzeRoute, /\/avatar\/analyze-v4-preview/);
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
  assert.match(job, /findAvatarForAnalyzerJob/);
  assert.match(latest, /pendingStatus/);
  assert.match(shared, /METADATA_UPDATE_ATTEMPTS/);
  assert.match(shared, /avatar_analyzer_v4_pending/);
});


test("Avatar Analyzer frontend separates process, detail and asset failures", () => {
  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");
  const styles = read("./components/library/avatar-analyzer-preview.module.css");
  assert.match(preview, /type AnalysisProcessState/);
  assert.match(preview, /type DetailState/);
  assert.match(preview, /type AssetState/);
  assert.match(preview, /Promise\.all\(\[/);
  assert.match(preview, /DETAIL_MAX_ATTEMPTS/);
  assert.match(preview, /REINTENTAR CARGA DEL DETALLE/);
  assert.match(preview, /Incompatibilidades visuales\/técnicas/);
  assert.match(preview, /Resultado persistido/);
  assert.doesNotMatch(preview, /if \(error\) return \{ label: "ERROR TÉCNICO"/);
  assert.match(styles, /scroll-snap-type/);
  assert.match(styles, /cameraActive/);
  assert.match(styles, /safe-area-inset-bottom/);
});


test("restored Analyzer results retain their compact summary and next action", () => {
  const shared = read("./app/api/avatar/analyze/_shared.ts");
  const latest = read("./app/api/avatar/analyze/latest/route.ts");
  const preview = read("./components/library/AvatarAnalyzerPreview.tsx");
  assert.match(shared, /summary: args\.summary/);
  assert.match(latest, /summary: asRecord\(stored\.summary\)/);
  assert.match(preview, /setSummary\(latest\.summary/);
  assert.match(preview, /Próxima acción/);
  assert.match(preview, /0\/7 vistas significa/);
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

test("mobile analyzer prioritizes requested profile and hides internal correction noise", () => {
  const component = read("components/library/AvatarAnalyzerPreview.tsx");
  assert.match(component, /Perfil solicitado/);
  assert.match(component, /Listo para rig corporal/);
  assert.match(component, /MOSTRAR TODOS LOS PUNTOS TÉCNICOS/);
  assert.match(component, /record\.requiresVisualViews === false \? "No requiere"/);
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
  const styles = read("./components/library/avatar-analyzer-preview.module.css");
  assert.match(cancelRoute, /\/avatar\/analyze-v4\/job\/\$\{jobId\}\/cancel/);
  assert.match(cancelRoute, /persistCancelledAnalyzerJob/);
  assert.match(shared, /export async function persistCancelledAnalyzerJob/);
  assert.match(preview, /CANCELAR ANÁLISIS/);
  assert.match(preview, /cancelRequestedRef/);
  assert.match(preview, /activeJobIdRef/);
  assert.match(preview, /shouldStop: \(\) => boolean/);
  assert.match(preview, /data\.status === "cancelled"/);
  assert.match(preview, /function workerStateLabel/);
  assert.doesNotMatch(preview, /analysisProcessState === "failed" \? "Error" : "Disponible"/);
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
});
