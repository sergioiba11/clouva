"""CLOUVA Avatar Analyzer V4.2 Blender entrypoint.

Initial runs build and persist geometry once. Incremental runs import the cached
canonical GLB, reconstruct segmentation/BVH from stored labels, execute only the
requested modules, replace their evidence and rebuild profile/diagnostic output.
The original user GLB is never modified.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time
import traceback
import uuid

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16 as autorig_v16
import avatar_analyzer as v32
from analysis_memory_guard import prepare_analysis_meshes
from analyzer_v4_contract import DEFAULT_CONFIG, upgrade_analysis_v4
from analyzer_v42_incremental import (
    ANALYZER_VERSION,
    MAP_VERSION,
    MODULE_VERSIONS,
    build_cache_key,
    build_incremental_plan,
    canonical_profile,
    merge_incremental_analysis,
    stable_hash,
    write_module_result,
)
from anatomy_bvh import build_anatomy_bvh
from anatomy_segmenter import AnatomySegmentation, VertexSample, segment_anatomy
from anatomy_segmenter_v3 import segment_anatomy_v3
from body_analyzer import analyze_body
from body_measurements_v42 import calculate_body_measurements_v42
from canonical_orientation import add_original_positions, canonicalize_temporary_copy
import diagnostic_builder
from diagnostic_builder import build_diagnostic_glb
from face_analyzer_v42 import analyze_face_module_v42
from hand_analyzer_v42 import analyze_hand_module_v42
from limb_centerline import refine_limb_joints
from multiview_renderer_v42 import cleanup_render_proxies, render_multiview_v42

REQUESTED_PROFILE_ENV = "CLOUVA_REQUESTED_RIG_PROFILE"
PHASE_ENV = "CLOUVA_AVATAR_ANALYZER_V42_PHASE"
PLAN_ENV = "CLOUVA_INCREMENTAL_PLAN_JSON"
PREVIOUS_ANALYSIS_ENV = "CLOUVA_PREVIOUS_ANALYSIS_PATH"
BASE_CACHE_DIR_ENV = "CLOUVA_BASE_CACHE_DIR"
JOB_STATUS_PATH_ENV = "CLOUVA_ANALYZER_JOB_STATUS_PATH"
DETECTOR_VERSION = os.environ.get("CLOUVA_LANDMARK_DETECTOR_VERSION", "mediapipe-0.10.14")

# V4.1 forgot internal geometry in the diagnostic builder's approved-state set.
diagnostic_builder.APPROVED_STATES.add("verified_internal_geometry")


def _args():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) < 2:
        raise RuntimeError("Usage: avatar_analyzer_v42.py input.glb output_directory")
    return Path(values[0]).resolve(), Path(values[1]).resolve()


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path, fallback=None):
    if not path.is_file():
        return deepcopy(fallback)
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _vectors(payload: dict):
    return {
        str(name): Vector(tuple(float(component) for component in value))
        for name, value in (payload or {}).items()
        if isinstance(value, (list, tuple)) and len(value) == 3
    }


def _job_update(status: str, progress: float, current_module: str | None, **extra):
    raw = os.environ.get(JOB_STATUS_PATH_ENV)
    if not raw:
        return
    path = Path(raw)
    existing = _read_json(path, {}) or {}
    now = time.time()
    payload = {
        **existing,
        "status": status,
        "progress": max(0.0, min(1.0, float(progress))),
        "currentModule": current_module,
        "startedAt": existing.get("startedAt") or now,
        "updatedAt": now,
        **extra,
    }
    if status == "completed":
        payload["completedAt"] = now
    _write_json(path, payload)


def _duration(started: float):
    return round((time.perf_counter() - started) * 1000.0, 3)


def _export_canonical_glb(path: Path, meshes):
    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for obj in meshes:
        if obj.name in bpy.context.scene.objects:
            obj.select_set(True)
            selected.append(obj)
    if not selected:
        raise RuntimeError("No canonical meshes available for base cache export")
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_apply=False,
        export_extras=True,
    )
    if not path.is_file() or path.stat().st_size < 1024:
        raise RuntimeError("Canonical analysis GLB export failed")


def _triangle_map(anatomy_bvh):
    geometry = getattr(anatomy_bvh, "global_geometry", None)
    if geometry is None:
        return []
    return [
        {
            "triangleId": int(item.global_triangle_id),
            "primaryRegion": item.primary_region,
            "secondaryRegions": list(item.secondary_regions),
            "regionWeights": dict(item.region_weights),
            "sourceObject": item.source_object,
            "sourcePolygon": int(item.source_polygon),
            "sourceVertices": list(item.source_vertices),
            "component": item.component,
        }
        for item in geometry.metadata
    ]


def _serialize_segmentation(segmentation):
    return {
        "version": "clouva-persistent-segmentation-v4.2",
        "labels": segmentation.labels,
        "measurements": segmentation.measurements,
        "diagnostics": segmentation.diagnostics,
        "refinedVectors": {name: _vec(value) for name, value in segmentation.refined_vectors.items()},
    }


def _restore_segmentation(meshes, payload: dict):
    labels = {str(name): list(values) for name, values in (payload.get("labels") or {}).items()}
    samples = {}
    for obj in meshes:
        object_labels = labels.get(obj.name) or []
        if len(object_labels) != len(obj.data.vertices):
            raise RuntimeError(
                f"Persistent segmentation mismatch for {obj.name}: {len(object_labels)} labels / {len(obj.data.vertices)} vertices"
            )
        normal_matrix = obj.matrix_world.to_3x3()
        for vertex in obj.data.vertices:
            region = str(object_labels[vertex.index])
            point = obj.matrix_world @ vertex.co
            normal = normal_matrix @ vertex.normal
            if normal.length > 1e-8:
                normal.normalize()
            samples.setdefault(region, []).append(
                VertexSample(obj.name, int(vertex.index), point, normal, region)
            )
    return AnatomySegmentation(
        labels,
        samples,
        dict(payload.get("measurements") or {}),
        dict(payload.get("diagnostics") or {}),
        _vectors(payload.get("refinedVectors") or {}),
    )


def _base_artifacts(output_dir: Path):
    return {
        "base_geometry": output_dir / "base_geometry.json",
        "canonical_orientation": output_dir / "canonical_orientation.json",
        "body_vectors": output_dir / "body_vectors.json",
        "mesh_classifications": output_dir / "mesh_classifications.json",
        "body_landmarks": output_dir / "body_landmarks.json",
        "body_subsystems": output_dir / "body_subsystems.json",
        "segmentation": output_dir / "segmentation.json",
        "segmentation_labels": output_dir / "segmentation_labels.json",
        "triangle_regions": output_dir / "triangle_region_map.json",
        "limb_centerlines": output_dir / "limb_centerlines.json",
        "body_measurements": output_dir / "body_measurements.json",
        "base_manifest": output_dir / "base_manifest.json",
        "canonical_glb": output_dir / "avatar-analysis-sanitized.glb",
    }


def _coverage_record(manifest, detector_output, projected_count=0):
    names = {str(item.get("name") or "") for item in manifest.get("views") or []}
    detected = [item for item in detector_output.get("views") or [] if str(item.get("name") or "") in names]
    return {
        "renderedViews": len(names),
        "detectorSuccessfulViews": len([item for item in detected if item.get("candidates")]),
        "projectedSuccessfulViews": len(detected) if projected_count else 0,
        "candidateCount": sum(len(item.get("candidates") or []) for item in detected),
        "projectedCandidates": int(projected_count),
        "visualCoverage": min(1.0, len([item for item in detected if item.get("candidates")]) / max(len(names), 1)),
        "geometricCoverage": 1.0 if projected_count else 0.0,
    }


def _initial_metrics():
    names = (
        "downloadMs", "sanitizeMs", "blenderStartupMs", "importMs", "canonicalizationMs",
        "classificationMs", "segmentationMs", "bvhBuildMs", "bodyAnalysisMs", "basePersistenceMs",
        "renderPreflightMs", "renderFinalMs", "detectorMs", "sparseProjectionMs",
        "fullTechnicalPassMs", "handGeometryMs", "fingerBranchMs", "faceAnalysisMs",
        "measurementsMs", "mergeMs", "diagnosticBuildMs", "persistenceMs", "totalMs",
    )
    return {name: 0.0 for name in names}


def _base_analysis(input_path: Path, output_dir: Path):
    metrics = _initial_metrics()
    started_total = time.perf_counter()
    source_sha = _sha256(input_path)
    _job_update("loading_base", 0.08, "base_geometry")

    started = time.perf_counter()
    meshes = autorig_v16.import_original_fresh(input_path)
    memory_guard = prepare_analysis_meshes(meshes)
    autorig_v16._IMPORT_REPORT["analysisMemoryGuard"] = memory_guard
    metrics["importMs"] = _duration(started)

    started = time.perf_counter()
    canonical_orientation = canonicalize_temporary_copy(meshes)
    metrics["canonicalizationMs"] = _duration(started)

    _job_update("building_base_geometry", 0.18, "body")
    started = time.perf_counter()
    body_report, body_vectors, classifications = analyze_body(meshes)
    body_report["orientation"] = canonical_orientation
    metrics["bodyAnalysisMs"] = _duration(started)
    metrics["classificationMs"] = metrics["bodyAnalysisMs"]

    started = time.perf_counter()
    initial_segmentation = segment_anatomy(meshes, classifications, body_vectors, body_report["dimensions"])
    refined_vectors, limb_diagnostics = refine_limb_joints(meshes, initial_segmentation, body_vectors)
    segmentation = segment_anatomy_v3(
        meshes, classifications, refined_vectors, body_report["dimensions"], limb_diagnostics,
    )
    body_report, body_vectors = v32._apply_refined_body_vectors(
        body_report, body_vectors, refined_vectors, limb_diagnostics,
    )
    metrics["segmentationMs"] = _duration(started)

    started = time.perf_counter()
    anatomy_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
    body_report = v32._sanitize_body_landmarks(body_report, body_vectors, segmentation, anatomy_bvh)
    metrics["bvhBuildMs"] = _duration(started)

    body_landmarks = v32.annotate_landmarks(body_report.get("landmarks") or {})
    add_original_positions(body_landmarks, canonical_orientation["inverseCanonicalMatrix"])
    started = time.perf_counter()
    measurements = calculate_body_measurements_v42(segmentation, body_vectors, body_report["dimensions"])
    metrics["measurementsMs"] = _duration(started)

    base_analysis_id = build_cache_key(
        source_sha256=source_sha,
        requested_profile="BODY_BASIC",
        configuration=DEFAULT_CONFIG,
        detector_version=DETECTOR_VERSION,
        module="base_geometry",
    )
    artifacts = _base_artifacts(output_dir)
    started = time.perf_counter()
    _export_canonical_glb(artifacts["canonical_glb"], meshes)
    segmentation_report = segmentation.as_report()
    base_geometry = {
        "version": ANALYZER_VERSION,
        "mapVersion": MAP_VERSION,
        "baseAnalysisId": base_analysis_id,
        "sourceSha256": source_sha,
        "dimensions": body_report["dimensions"],
        "orientation": canonical_orientation,
        "symmetry": body_report.get("symmetry") or {},
        "pose": body_report.get("pose") or {},
        "isHumanoid": bool(body_report.get("isHumanoid")),
        "humanoidConfidence": float(body_report.get("humanoidConfidence") or 0.0),
        "regionBvh": anatomy_bvh.report(),
        "meshCount": len(meshes),
        "vertexCount": sum(len(mesh.data.vertices) for mesh in meshes),
        "polygonCount": sum(len(mesh.data.polygons) for mesh in meshes),
    }
    manifest = {
        "version": MODULE_VERSIONS["base_geometry"],
        "baseAnalysisId": base_analysis_id,
        "sourceSha256": source_sha,
        "analyzerVersion": ANALYZER_VERSION,
        "mapVersion": MAP_VERSION,
        "configurationHash": stable_hash(DEFAULT_CONFIG),
        "cameraRigVersion": "clouva-adaptive-camera-rig-v4.2",
        "detectorVersion": DETECTOR_VERSION,
        "requestedProfile": "BODY_BASIC",
        "canonicalGlb": artifacts["canonical_glb"].name,
        "segmentationSerialized": True,
        "triangleRegionMapSerialized": True,
        "bvhSerializedDirectly": False,
        "createdAt": time.time(),
    }
    _write_json(artifacts["base_geometry"], base_geometry)
    _write_json(artifacts["canonical_orientation"], canonical_orientation)
    _write_json(artifacts["body_vectors"], {name: _vec(value) for name, value in body_vectors.items()})
    _write_json(artifacts["mesh_classifications"], classifications)
    _write_json(artifacts["body_landmarks"], body_landmarks)
    _write_json(artifacts["body_subsystems"], body_report.get("subsystems") or {})
    _write_json(artifacts["segmentation"], segmentation_report)
    _write_json(artifacts["segmentation_labels"], _serialize_segmentation(segmentation))
    _write_json(artifacts["triangle_regions"], {"version": "clouva-triangle-region-map-v4.2", "triangles": _triangle_map(anatomy_bvh)})
    _write_json(artifacts["limb_centerlines"], limb_diagnostics)
    _write_json(artifacts["body_measurements"], measurements)
    _write_json(artifacts["base_manifest"], manifest)
    metrics["basePersistenceMs"] = _duration(started)

    analysis = {
        "version": ANALYZER_VERSION,
        "analyzer_version": "4.2",
        "mapVersion": MAP_VERSION,
        "runId": uuid.uuid4().hex,
        "createdAt": time.time(),
        "source": {
            "filename": input_path.name,
            "sha256": source_sha,
            "meshCount": len(meshes),
            "vertexCount": base_geometry["vertexCount"],
            "polygonCount": base_geometry["polygonCount"],
            "cleanup": dict(autorig_v16._IMPORT_REPORT),
        },
        "baseAnalysisId": base_analysis_id,
        "dimensions": body_report["dimensions"],
        "orientation": canonical_orientation,
        "symmetry": body_report.get("symmetry") or {},
        "pose": body_report.get("pose") or {},
        "isHumanoid": body_report.get("isHumanoid"),
        "humanoidConfidence": body_report.get("humanoidConfidence"),
        "bodyBaseConfidence": body_report.get("humanoidConfidence"),
        "bodyAnalysis": body_report.get("status", "needs_review"),
        "bodySubsystems": body_report.get("subsystems") or {},
        "faceAnalysis": "not_executed",
        "leftHandAnalysis": "not_executed",
        "rightHandAnalysis": "not_executed",
        "meshClassifications": classifications,
        "segmentation": segmentation_report,
        "regionBvh": anatomy_bvh.report(),
        "limbCenterlines": limb_diagnostics,
        "bodyMeasurements": measurements,
        "measurements": measurements.get("measurements") or {},
        "landmarks": body_landmarks,
        "warnings": list(body_report.get("warnings") or []),
        "diagnostics": {"body": body_report, "hands": {}},
        "modules": {
            "base_geometry": manifest,
            "body": {"version": MODULE_VERSIONS["body"], "status": body_report.get("status", "needs_review")},
            "measurements": {"version": MODULE_VERSIONS["measurements"], "status": "completed"},
        },
        "metrics": metrics,
    }
    body_module = {
        "status": body_report.get("status", "needs_review"),
        "bodyAnalysis": body_report.get("status", "needs_review"),
        "bodySubsystems": body_report.get("subsystems") or {},
        "landmarks": body_landmarks,
        "warnings": list(body_report.get("warnings") or []),
    }
    write_module_result(output_dir, "body", body_module, analysis["modules"]["body"])
    write_module_result(output_dir, "measurements", measurements, analysis["modules"]["measurements"])
    metrics["totalMs"] = _duration(started_total)
    return {
        "meshes": meshes,
        "body_report": body_report,
        "body_vectors": body_vectors,
        "classifications": classifications,
        "segmentation": segmentation,
        "anatomy_bvh": anatomy_bvh,
        "analysis": analysis,
        "metrics": metrics,
        "base_dir": output_dir,
    }


def _load_cached_base(input_path: Path, base_dir: Path, previous_analysis_path: Path):
    metrics = _initial_metrics()
    started = time.perf_counter()
    meshes = autorig_v16.import_original_fresh(input_path)
    prepare_analysis_meshes(meshes)
    metrics["importMs"] = _duration(started)
    vectors = _vectors(_read_json(base_dir / "body_vectors.json", {}))
    classifications = _read_json(base_dir / "mesh_classifications.json", {})
    segmentation_payload = _read_json(base_dir / "segmentation_labels.json", {})
    segmentation = _restore_segmentation(meshes, segmentation_payload)
    started = time.perf_counter()
    anatomy_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
    metrics["bvhBuildMs"] = _duration(started)
    analysis = _read_json(previous_analysis_path, {})
    if not analysis:
        raise RuntimeError("Previous V4.2 analysis is required for incremental execution")
    return {
        "meshes": meshes,
        "body_report": (analysis.get("diagnostics") or {}).get("body") or {},
        "body_vectors": vectors,
        "classifications": classifications,
        "segmentation": segmentation,
        "anatomy_bvh": anatomy_bvh,
        "analysis": analysis,
        "metrics": metrics,
        "base_dir": base_dir,
    }


def _run_detector(manifest: dict, output_dir: Path, attempt: str, metrics: dict):
    if not manifest.get("views"):
        return {"version": "skipped", "views": [], "errors": [], "attempt": attempt}, {"skipped": True}
    started = time.perf_counter()
    output, process = v32._run_detector(manifest, output_dir, attempt)
    metrics["detectorMs"] += _duration(started)
    return output, process


def _execute_plan(context: dict, plan: dict, output_dir: Path):
    metrics = context["metrics"]
    analysis = context["analysis"]
    meshes = context["meshes"]
    body_vectors = context["body_vectors"]
    segmentation = context["segmentation"]
    classifications = context["classifications"]
    anatomy_bvh = context["anatomy_bvh"]
    modules = list(plan.get("modules") or [])
    optional_modules = [name for name in modules if name in {"face", "left_hand", "right_hand"}]
    module_results = {}
    manifest = {"views": [], "camerasRendered": 0, "camerasSkipped": 0, "fullTechnicalPassesGenerated": 0}
    detector_output = {"version": "skipped", "views": [], "errors": []}
    detector_process = {"skipped": True}

    if "body" in modules:
        body_landmarks = _read_json(context["base_dir"] / "body_landmarks.json", analysis.get("landmarks") or {})
        module_results["body"] = {
            "status": analysis.get("bodyAnalysis") or "needs_review",
            "bodyAnalysis": analysis.get("bodyAnalysis") or "needs_review",
            "bodySubsystems": analysis.get("bodySubsystems") or {},
            "landmarks": body_landmarks,
            "warnings": [item for item in analysis.get("warnings") or [] if str(item.get("module") or "body") == "body"],
            "manifest": {"version": MODULE_VERSIONS["body"], "module": "body", "status": analysis.get("bodyAnalysis") or "needs_review", "cacheHit": True},
        }

    if "measurements" in modules:
        _job_update("calculating_measurements", 0.62, "measurements")
        started = time.perf_counter()
        measurements = calculate_body_measurements_v42(segmentation, body_vectors, analysis.get("dimensions") or {})
        metrics["measurementsMs"] += _duration(started)
        module_results["measurements"] = {
            "status": "completed",
            "bodyMeasurements": measurements,
            "measurements": measurements.get("measurements") or {},
            "landmarks": {},
            "warnings": [],
            "manifest": {"version": MODULE_VERSIONS["measurements"], "module": "measurements", "status": "completed"},
        }

    if optional_modules:
        _job_update("render_preflight", 0.35, optional_modules[0])
        render_dir = output_dir / "renders_v42"
        started = time.perf_counter()
        manifest = render_multiview_v42(
            render_dir,
            body_vectors,
            float((analysis.get("dimensions") or {}).get("height") or 1.0),
            modules=optional_modules,
            cameras=plan.get("cameras") or None,
            meshes=meshes,
            segmentation=segmentation,
            classifications=classifications,
            anatomy_bvh=anatomy_bvh,
            config=DEFAULT_CONFIG,
        )
        metrics["renderFinalMs"] += _duration(started)
        metrics["fullTechnicalPassMs"] += 0.0
        detector_output, detector_process = _run_detector(manifest, output_dir, "v42_incremental", metrics)

    requested_landmarks = list(plan.get("landmarks") or [])
    if "face" in modules:
        _job_update("analyzing_face", 0.48, "face")
        started = time.perf_counter()
        face = analyze_face_module_v42(
            detector_output, manifest, meshes, classifications, body_vectors,
            float((analysis.get("dimensions") or {}).get("width") or 0.0),
            segmentation, anatomy_bvh,
            requested_landmarks=requested_landmarks or None,
        )
        metrics["faceAnalysisMs"] += _duration(started)
        metrics["sparseProjectionMs"] += float((face.get("projectionMetrics") or {}).get("durationMs") or 0.0)
        module_results["face"] = face
        write_module_result(output_dir, "face", face, face["manifest"])

    for module, side in (("left_hand", "left"), ("right_hand", "right")):
        if module not in modules:
            continue
        _job_update(f"analyzing_{side}_hand", 0.52 if side == "left" else 0.58, module)
        started = time.perf_counter()
        hand, anatomy_bvh = analyze_hand_module_v42(
            detector_output, manifest, classifications, segmentation, meshes, anatomy_bvh, side,
            requested_landmarks=requested_landmarks or None,
        )
        elapsed = _duration(started)
        metrics["handGeometryMs"] += elapsed
        metrics["fingerBranchMs"] += elapsed
        module_results[module] = {
            **hand,
            f"{side}HandAnalysis": hand.get("status"),
            "leftHandAnalysis" if side == "left" else "rightHandAnalysis": hand.get("status"),
        }
        write_module_result(output_dir, module, hand, hand["manifest"])
        analysis.setdefault("diagnostics", {}).setdefault("hands", {})[side] = hand

    context["anatomy_bvh"] = anatomy_bvh
    coverage = dict(analysis.get("detectionCoverage") or {})
    if "face" in module_results:
        coverage["face"] = _coverage_record(manifest, detector_output, len(module_results["face"].get("projectedCandidates") or []))
    if "left_hand" in module_results:
        coverage["leftHand"] = _coverage_record(manifest, detector_output, len(module_results["left_hand"].get("projectedCandidates") or []))
    if "right_hand" in module_results:
        coverage["rightHand"] = _coverage_record(manifest, detector_output, len(module_results["right_hand"].get("projectedCandidates") or []))
    analysis["detectionCoverage"] = coverage
    return module_results, manifest, detector_output, detector_process


def _finalize(context: dict, plan: dict, module_results: dict, manifest: dict, detector_output: dict, detector_process: dict, output_dir: Path):
    metrics = context["metrics"]
    previous = context["analysis"]
    _job_update("merging_evidence", 0.72, "evidence_merge")
    started = time.perf_counter()
    merged = merge_incremental_analysis(previous, module_results, plan)
    orientation = merged.get("orientation") or _read_json(context["base_dir"] / "canonical_orientation.json", {})
    inverse = orientation.get("inverseCanonicalMatrix")
    if inverse:
        for module in module_results.values():
            add_original_positions(module.get("landmarks") or {}, inverse)
    merged["landmarks"] = {
        **(merged.get("landmarks") or {}),
        **{
            name: record
            for module in module_results.values()
            for name, record in (module.get("landmarks") or {}).items()
        },
    }
    upgraded = upgrade_analysis_v4(
        merged,
        requested_rig_profile=canonical_profile(plan.get("requestedProfile")),
        camera_calibration={"invalid_views": [], "all_views_invalid": False, "version": "sparse-v4.2"},
        config=DEFAULT_CONFIG,
    )
    metrics["mergeMs"] += _duration(started)
    upgraded.update({
        "version": ANALYZER_VERSION,
        "analyzer_version": "4.2",
        "mapVersion": MAP_VERSION,
        "runId": uuid.uuid4().hex,
        "createdAt": time.time(),
        "baseAnalysisId": previous.get("baseAnalysisId"),
        "incremental": plan.get("operation") not in {"initial", "rerun_full_pipeline"},
        "incrementalPlan": plan,
        "modulesExecuted": sorted(module_results),
        "modulesSkipped": sorted(set(("body", "face", "left_hand", "right_hand", "measurements")).difference(module_results)),
        "modulesReused": sorted(set((previous.get("modules") or {})).difference(module_results)),
    })
    upgraded.setdefault("diagnostics", {})["detectorProcessV42"] = detector_process
    upgraded["diagnostics"]["cameraManifestV42"] = manifest
    upgraded["diagnostics"].setdefault("hands", (previous.get("diagnostics") or {}).get("hands") or {})
    for module, side in (("left_hand", "left"), ("right_hand", "right")):
        if module in module_results:
            upgraded["diagnostics"]["hands"][side] = module_results[module]
    if "face" in module_results:
        upgraded["diagnostics"]["face"] = module_results["face"]
    upgraded["regionBvh"] = context["anatomy_bvh"].report()

    counters = {
        "camerasRendered": int(manifest.get("camerasRendered") or 0),
        "camerasSkipped": int(manifest.get("camerasSkipped") or 0),
        "fullTechnicalPassesGenerated": int(manifest.get("fullTechnicalPassesGenerated") or 0),
        "sparseProjectionsGenerated": sum(int((value.get("projectionMetrics") or {}).get("sparseProjectionsGenerated") or 0) for value in module_results.values()),
        "raysExecuted": sum(int((value.get("projectionMetrics") or {}).get("raysExecuted") or 0) for value in module_results.values()),
        "modulesExecuted": sorted(module_results),
        "modulesReused": upgraded["modulesReused"],
        "modulesSkipped": upgraded["modulesSkipped"],
        "cacheHits": len(upgraded["modulesReused"]),
        "cacheMisses": len(module_results),
    }
    metrics.update(counters)
    upgraded["metrics"] = {**(upgraded.get("metrics") or {}), **metrics, **counters}
    upgraded["analysisCacheKey"] = build_cache_key(
        source_sha256=str((upgraded.get("source") or {}).get("sha256") or ""),
        requested_profile=canonical_profile(plan.get("requestedProfile")),
        configuration=DEFAULT_CONFIG,
        detector_version=DETECTOR_VERSION,
        module="analysis",
    )

    _job_update("building_diagnostics", 0.84, "diagnostics")
    started = time.perf_counter()
    approved_path = output_dir / "diagnostic-approved.glb"
    full_path = output_dir / "diagnostic-full.glb"
    approved_build = build_diagnostic_glb(
        approved_path,
        context["meshes"],
        upgraded.get("landmarks") or {},
        float((upgraded.get("dimensions") or {}).get("height") or 1.0),
        include_all_states=False,
    )
    full_build = build_diagnostic_glb(
        full_path,
        context["meshes"],
        upgraded.get("landmarks") or {},
        float((upgraded.get("dimensions") or {}).get("height") or 1.0),
        include_all_states=True,
    )
    alias_path = output_dir / "diagnostic_landmarks.glb"
    shutil.copy2(approved_path, alias_path)
    metrics["diagnosticBuildMs"] += _duration(started)

    _job_update("persisting", 0.94, "persistence")
    started = time.perf_counter()
    analysis_path = output_dir / "avatar_analysis.json"
    report_path = output_dir / "diagnostic_report.json"
    metrics["totalMs"] = sum(
        float(value) for key, value in metrics.items()
        if key.endswith("Ms") and key != "totalMs" and isinstance(value, (int, float))
    )
    upgraded["metrics"] = {**(upgraded.get("metrics") or {}), **metrics, **counters}
    report = {
        "version": ANALYZER_VERSION,
        "mapVersion": MAP_VERSION,
        "runId": upgraded["runId"],
        "status": upgraded.get("overall_status") or upgraded.get("status"),
        "baseAnalysisId": upgraded.get("baseAnalysisId"),
        "incrementalPlan": plan,
        "analysisPath": str(analysis_path),
        "diagnosticApprovedGlbPath": str(approved_path),
        "diagnosticFullGlbPath": str(full_path),
        "diagnosticGlbPath": str(alias_path),
        "diagnosticApprovedBuild": approved_build,
        "diagnosticFullBuild": full_build,
        "metrics": upgraded["metrics"],
        "modulesExecuted": counters["modulesExecuted"],
        "modulesReused": counters["modulesReused"],
        "modulesSkipped": counters["modulesSkipped"],
        "limitations": [
            "The analyzer never modifies the original uploaded GLB.",
            "HAND_REPAIR_REQUIRED prepares a future Hand Normalizer contract; no destructive replacement is performed.",
        ],
    }
    _write_json(analysis_path, upgraded)
    _write_json(report_path, report)
    metrics["persistenceMs"] += _duration(started)
    _job_update(
        "completed", 1.0, None,
        runId=upgraded["runId"],
        modulesExecuted=counters["modulesExecuted"],
        modulesSkipped=counters["modulesSkipped"],
        cacheHits=counters["cacheHits"],
        cacheMisses=counters["cacheMisses"],
    )
    print(f"[clouva-avatar-analyzer-v4.2] {json.dumps(report, separators=(',', ':'))}", flush=True)
    return upgraded, report


def run_initial(input_path: Path, output_dir: Path):
    requested_profile = canonical_profile(os.environ.get(REQUESTED_PROFILE_ENV, "BODY_BASIC"))
    plan = build_incremental_plan("initial", requested_profile=requested_profile)
    context = _base_analysis(input_path, output_dir)
    manifests = []
    try:
        module_results, manifest, detector_output, detector_process = _execute_plan(context, plan, output_dir)
        manifests.append(manifest)
        return _finalize(context, plan, module_results, manifest, detector_output, detector_process, output_dir)
    finally:
        for manifest in manifests:
            try:
                cleanup_render_proxies(manifest)
            except Exception:
                pass


def run_incremental(input_path: Path, output_dir: Path):
    base_dir = Path(os.environ.get(BASE_CACHE_DIR_ENV) or "").resolve()
    previous_analysis_path = Path(os.environ.get(PREVIOUS_ANALYSIS_ENV) or "").resolve()
    if not base_dir.is_dir() or not previous_analysis_path.is_file():
        raise RuntimeError("Incremental V4.2 requires cached base directory and previous analysis")
    plan_payload = json.loads(os.environ.get(PLAN_ENV) or "{}")
    if not plan_payload:
        plan_payload = build_incremental_plan(
            os.environ.get("CLOUVA_REANALYSIS_OPERATION") or "reanalyze_body",
            requested_profile=os.environ.get(REQUESTED_PROFILE_ENV, "BODY_BASIC"),
        )
    context = _load_cached_base(input_path, base_dir, previous_analysis_path)
    manifests = []
    try:
        module_results, manifest, detector_output, detector_process = _execute_plan(context, plan_payload, output_dir)
        manifests.append(manifest)
        return _finalize(context, plan_payload, module_results, manifest, detector_output, detector_process, output_dir)
    finally:
        for manifest in manifests:
            try:
                cleanup_render_proxies(manifest)
            except Exception:
                pass


def main():
    input_path, output_dir = _args()
    output_dir.mkdir(parents=True, exist_ok=True)
    if not input_path.is_file():
        raise RuntimeError("Sanitized analysis GLB not found")
    phase = os.environ.get(PHASE_ENV, "initial").strip().lower()
    try:
        if phase in {"incremental", "upgrade"}:
            run_incremental(input_path, output_dir)
        else:
            run_initial(input_path, output_dir)
    except Exception:
        _job_update("failed", 1.0, None, error=traceback.format_exc()[-12000:])
        _write_json(output_dir / "diagnostic_report.json", {
            "version": ANALYZER_VERSION,
            "status": "failed",
            "error": traceback.format_exc(),
        })
        raise


if __name__ == "__main__":
    main()
