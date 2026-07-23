"""CLOUVA Avatar Analyzer V3.2 Blender entrypoint.

The analyzer works on a fresh temporary copy, canonicalizes it non-destructively,
creates an evidence-rich anatomical map and never creates the production rig.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import traceback
import uuid
from pathlib import Path

from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16 as autorig_v16
from analyzer_contract import (
    ANALYZER_VERSION,
    annotate_landmarks,
    build_detection_coverage,
    calculate_rig_readiness,
    critical_landmarks_verified,
    landmark_metrics,
)
from anatomy_bvh import build_anatomy_bvh
from analysis_memory_guard import prepare_analysis_meshes
from anatomy_segmenter import segment_anatomy
from anatomy_segmenter_v3 import segment_anatomy_v3
from body_analyzer import analyze_body
from canonical_orientation import add_original_positions, canonicalize_temporary_copy
from diagnostic_builder import build_diagnostic_glb
from face_analyzer import analyze_face
from hand_analyzer import analyze_hands
from limb_centerline import refine_limb_joints
from multiview_renderer_v32 import cleanup_render_proxies, render_multiview_v32

VERSION = ANALYZER_VERSION
AUX_PYTHON = os.environ.get("CLOUVA_AUX_PYTHON", "/usr/local/bin/python3")
DETECTOR_SCRIPT = Path(os.environ.get(
    "CLOUVA_LANDMARK_DETECTOR_SCRIPT",
    SCRIPT_DIR / "landmark_detector_2d.py",
))
DETECTOR_TIMEOUT_SECONDS = int(os.environ.get("CLOUVA_LANDMARK_DETECTOR_TIMEOUT_SECONDS", "180"))


def _args():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) < 2:
        raise RuntimeError("Usage: avatar_analyzer.py input.glb output_directory")
    return Path(values[0]).resolve(), Path(values[1]).resolve()


def _sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload):
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _warning_key(item: dict):
    return tuple(str(item.get(name) or "") for name in (
        "code", "landmark", "name", "region", "side", "finger", "message", "attempt",
    ))


def _dedupe_warnings(items):
    grouped = {}
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        key = _warning_key(raw)
        view = raw.get("view")
        if key not in grouped:
            grouped[key] = {
                **raw,
                "occurrences": int(raw.get("occurrences") or 1),
                "views": list(raw.get("views") or ([view] if view else [])),
            }
            grouped[key].pop("view", None)
            continue
        item = grouped[key]
        item["occurrences"] = int(item.get("occurrences") or 1) + int(raw.get("occurrences") or 1)
        views = item.setdefault("views", [])
        for candidate in list(raw.get("views") or ([view] if view else [])):
            if candidate and candidate not in views:
                views.append(candidate)
    return list(grouped.values())


def _run_detector(manifest: dict, output_dir: Path, attempt: str):
    request_path = output_dir / f"detector_request_{attempt}.json"
    response_path = output_dir / f"detector_output_{attempt}.json"
    _write_json(request_path, {"version": VERSION, "attempt": attempt, "views": manifest.get("views", [])})
    if not DETECTOR_SCRIPT.is_file():
        return {
            "version": "unavailable", "views": [], "attempt": attempt,
            "errors": [{"code": "DETECTOR_SCRIPT_MISSING", "path": str(DETECTOR_SCRIPT), "attempt": attempt}],
        }, {"returnCode": None, "stdout": "", "stderr": "detector script missing"}
    command = [AUX_PYTHON, str(DETECTOR_SCRIPT), str(request_path), str(response_path)]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True,
            timeout=DETECTOR_TIMEOUT_SECONDS, cwd=str(output_dir),
            env={**os.environ, "PYTHONPATH": str(SCRIPT_DIR)},
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "version": "timeout", "views": [], "attempt": attempt,
            "errors": [{"code": "MEDIAPIPE_TIMEOUT", "seconds": DETECTOR_TIMEOUT_SECONDS, "attempt": attempt}],
        }, {"returnCode": None, "stdout": exc.stdout or "", "stderr": exc.stderr or ""}
    diagnostics = {
        "attempt": attempt, "command": command, "returnCode": result.returncode,
        "stdout": result.stdout[-12000:], "stderr": result.stderr[-12000:],
    }
    if result.returncode != 0 or not response_path.is_file():
        return {
            "version": "failed", "views": [], "attempt": attempt,
            "errors": [{
                "code": "MEDIAPIPE_PROCESS_FAILED", "returnCode": result.returncode,
                "message": result.stderr[-2000:] or result.stdout[-2000:], "attempt": attempt,
            }],
        }, diagnostics
    output = json.loads(response_path.read_text(encoding="utf-8"))
    output["attempt"] = attempt
    for error in output.get("errors") or []:
        error.setdefault("attempt", attempt)
    output["errors"] = _dedupe_warnings(output.get("errors") or [])
    return output, diagnostics


def _body_region_map():
    return {
        "shoulder_l": ("upper_arm_l", "torso"),
        "elbow_l": ("upper_arm_l", "forearm_l"),
        "wrist_l": ("forearm_l", "hand_l"),
        "hand_l": ("hand_l",),
        "shoulder_r": ("upper_arm_r", "torso"),
        "elbow_r": ("upper_arm_r", "forearm_r"),
        "wrist_r": ("forearm_r", "hand_r"),
        "hand_r": ("hand_r",),
        "hip_l": ("thigh_l", "pelvis", "torso"),
        "knee_l": ("thigh_l", "calf_l"),
        "ankle_l": ("calf_l", "foot_l"),
        "foot_l": ("foot_l",),
        "hip_r": ("thigh_r", "pelvis", "torso"),
        "knee_r": ("thigh_r", "calf_r"),
        "ankle_r": ("calf_r", "foot_r"),
        "foot_r": ("foot_r",),
    }


def _metadata_region_map():
    return {
        "root": "torso", "pelvis": "torso", "spine_01": "torso",
        "spine_02": "torso", "chest": "torso", "neck": "neck",
        "skull_base": "head", "head_top": "head", "head": "head",
        "clavicle_l": "torso", "clavicle_r": "torso",
        "upperarm_l": "upper_arm_l", "upperarm_r": "upper_arm_r",
        "lowerarm_l": "forearm_l", "lowerarm_r": "forearm_r",
        "thigh_l": "thigh_l", "thigh_r": "thigh_r",
        "calf_l": "calf_l", "calf_r": "calf_r",
        "ball_l": "foot_l", "ball_r": "foot_r",
    }


def _region_cross_section(anatomy_bvh, regions):
    values = []
    for name in regions:
        geometry = getattr(anatomy_bvh, "regions", {}).get(name)
        if geometry is None:
            continue
        bounds = geometry.bounds()
        sizes = sorted(float(value) for value in bounds.get("size", []) if float(value) > 1e-6)
        if sizes:
            values.append(sizes[0])
    return max(values, default=0.0)


def _joint_threshold(name: str, height: float, hand_scale: float, anatomy_bvh, regions):
    ratio = 0.055
    if name.startswith("shoulder_"):
        ratio = 0.075
    elif name.startswith(("elbow_", "hip_", "knee_")):
        ratio = 0.065
    elif name.startswith(("wrist_", "ankle_")):
        ratio = 0.060
    elif name.startswith(("hand_", "foot_")):
        ratio = 0.070
    local_cross_section = _region_cross_section(anatomy_bvh, regions)
    local_allowance = local_cross_section * 0.78
    hand_allowance = hand_scale * 0.55 if name.startswith(("wrist_", "hand_")) else 0.0
    return min(max(height * ratio, local_allowance, hand_allowance), height * 0.14)


def _apply_refined_body_vectors(body_report: dict, body_vectors: dict,
                                refined: dict, limb_diagnostics: dict):
    body_vectors.update({name: value.copy() for name, value in refined.items()})
    landmarks = body_report.get("landmarks") or {}
    aliases = {
        "shoulder_l": "shoulder_l", "upperarm_l": "shoulder_l",
        "elbow_l": "elbow_l", "lowerarm_l": "elbow_l",
        "wrist_l": "wrist_l", "hand_l": "hand_l",
        "hip_l": "hip_l", "thigh_l": "hip_l", "knee_l": "knee_l",
        "calf_l": "knee_l", "ankle_l": "ankle_l", "foot_l": "foot_l",
        "shoulder_r": "shoulder_r", "upperarm_r": "shoulder_r",
        "elbow_r": "elbow_r", "lowerarm_r": "elbow_r",
        "wrist_r": "wrist_r", "hand_r": "hand_r",
        "hip_r": "hip_r", "thigh_r": "hip_r", "knee_r": "knee_r",
        "calf_r": "knee_r", "ankle_r": "ankle_r", "foot_r": "foot_r",
    }
    for landmark_name, source_name in aliases.items():
        point = refined.get(source_name)
        item = landmarks.get(landmark_name)
        if point is None or not isinstance(item, dict):
            continue
        item["roughCandidatePosition"] = list(item.get("position") or [])
        item["position"] = _vec(point)
        item["internalJointPosition"] = _vec(point)
        item["refinedFrom"] = source_name
        item["method"] = "geodesic-cross-section-limb-centerline-v3.2"
        item["geometryEvidence"] = limb_diagnostics.get("limbs", {}).get(
            f"{'arm' if source_name.startswith(('shoulder','elbow','wrist','hand')) else 'leg'}_{source_name[-1]}",
            {},
        )
    for suffix in ("l", "r"):
        shoulder = refined.get(f"shoulder_{suffix}")
        if shoulder is not None:
            body_vectors[f"clavicle_{suffix}"] = body_vectors["chest"].lerp(shoulder, 0.45)
            clavicle = landmarks.get(f"clavicle_{suffix}")
            if isinstance(clavicle, dict):
                clavicle["roughCandidatePosition"] = list(clavicle.get("position") or [])
                clavicle["position"] = _vec(body_vectors[f"clavicle_{suffix}"])
                clavicle["internalJointPosition"] = list(clavicle["position"])
                clavicle["method"] = "chest-to-geodesic-shoulder-internal-v3.2"
    body_report["refinedBodyAxesApplied"] = True
    body_report["refinedBodyVectors"] = {name: _vec(value) for name, value in refined.items()}
    body_report["limbCenterlineEvidence"] = limb_diagnostics
    return body_report, body_vectors


def _subsystem_requirements():
    return {
        "body_core": ["pelvis", "spine_01", "spine_02", "chest", "neck", "head"],
        "left_arm": ["shoulder_l", "elbow_l", "wrist_l", "hand_l"],
        "right_arm": ["shoulder_r", "elbow_r", "wrist_r", "hand_r"],
        "left_leg": ["hip_l", "knee_l", "ankle_l", "foot_l"],
        "right_leg": ["hip_r", "knee_r", "ankle_r", "foot_r"],
    }


def _sanitize_body_landmarks(body_report: dict, body_vectors: dict,
                             segmentation, anatomy_bvh):
    landmarks = body_report.get("landmarks") or {}
    height = max(float((body_report.get("dimensions") or {}).get("height") or 0.0), 1e-5)
    blocking = []
    non_blocking = []
    hidden_internal = {
        "root", "pelvis", "spine_01", "spine_02", "chest", "neck",
        "skull_base", "head_top", "head", "clavicle_l", "clavicle_r",
        "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r",
        "thigh_l", "thigh_r", "calf_l", "calf_r", "ball_l", "ball_r",
    }
    metadata_regions = _metadata_region_map()
    for name, item in landmarks.items():
        if not isinstance(item, dict) or "position" not in item:
            continue
        raw_confidence = float(item.get("rawConfidence", item.get("confidence", 0.0)))
        item["name"] = name
        item["rawConfidence"] = raw_confidence
        item["finalConfidence"] = raw_confidence
        item["internalJointPosition"] = list(item["position"])
        item["landmarkType"] = "internal_joint"
        item["internalAccepted"] = raw_confidence >= 0.40
        item["surfaceAccepted"] = False
        item["accepted"] = item["internalAccepted"]
        item["verified"] = item["internalAccepted"]
        item["display"] = False
        item["methods"] = [
            "v16_body_seed", "anatomy_region_segmentation",
            "geodesic_cross_section_refinement" if item.get("roughCandidatePosition") is not None else "central_body_estimate",
        ]
        if name in metadata_regions:
            item["region"] = metadata_regions[name]
            item.setdefault("surfaceRegion", metadata_regions[name])
        if name in hidden_internal:
            item["diagnosticReason"] = "INTERNAL_JOINT_STORED_SEPARATELY"

    for name, regions in _body_region_map().items():
        item = landmarks.get(name)
        if not item or "position" not in item:
            blocking.append({"code": "BODY_JOINT_MISSING", "landmark": name, "failureStage": "body"})
            continue
        internal = Vector(tuple(float(value) for value in item["position"]))
        nearest = anatomy_bvh.nearest(internal, regions)
        measurement_side = "left" if name.endswith("_l") else "right"
        hand_scale = float(segmentation.hand_measurement(measurement_side).get("handScale") or 0.0)
        threshold = _joint_threshold(name, height, hand_scale, anatomy_bvh, regions)
        distance = float(nearest["distance"]) if nearest else float("inf")
        confidence = float(item.get("rawConfidence", item.get("confidence", 0.0)))
        distance_valid = nearest is not None and distance <= threshold
        confidence_valid = confidence >= 0.40
        internal_accepted = bool(distance_valid and confidence_valid)
        item["region"] = regions[0]
        item["surfaceRegion"] = nearest.get("region") if nearest else regions[0]
        item["surfaceDistance"] = distance if distance != float("inf") else None
        item["validationThreshold"] = threshold
        item["validationUsesLocalCrossSection"] = True
        item["internalAccepted"] = internal_accepted
        item["surfaceAccepted"] = internal_accepted and nearest is not None
        item["accepted"] = internal_accepted
        item["verified"] = internal_accepted
        item["display"] = bool(item["surfaceAccepted"])
        item["displayEdge"] = False
        item["surfaceDisplayPosition"] = _vec(nearest["location"] if nearest else internal)
        item["displayPosition"] = list(item["surfaceDisplayPosition"])
        item["surfaceMethod"] = "boundary-aware-named-region-bvh-v3.2"
        if not distance_valid:
            item.setdefault("rejectionReasons", []).append("BODY_INTERNAL_JOINT_OUTSIDE_REGION")
            item["failureStage"] = "body_region_validation"
            blocking.append({
                "code": "BODY_INTERNAL_JOINT_OUTSIDE_REGION", "landmark": name,
                "allowedRegions": list(regions), "surfaceRegion": item.get("surfaceRegion"),
                "regionDistance": item.get("surfaceDistance"), "threshold": threshold,
                "failureStage": "body_region_validation",
            })
        elif not confidence_valid:
            item.setdefault("rejectionReasons", []).append("BODY_JOINT_CONFIDENCE_LOW")
            item["failureStage"] = "body_confidence"
            blocking.append({
                "code": "BODY_JOINT_CONFIDENCE_LOW", "landmark": name,
                "confidence": confidence, "minimumConfidence": 0.40,
                "failureStage": "body_confidence",
            })

    segmentation_report = segmentation.as_report()
    critical_regions = (
        "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
        "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r", "head", "torso",
    )
    empty_regions = [
        name for name in critical_regions
        if int(segmentation_report.get("regions", {}).get(name, {}).get("vertexCount", 0)) < 4
    ]
    if empty_regions:
        non_blocking.append({"code": "ANATOMY_REGIONS_INSUFFICIENT", "regions": empty_regions})

    blocking = _dedupe_warnings(blocking)
    non_blocking = _dedupe_warnings(non_blocking)
    subsystems = {}
    for subsystem, names in _subsystem_requirements().items():
        missing = [name for name in names if name not in landmarks or not landmarks[name].get("internalAccepted", False)]
        subsystem_warnings = [item for item in blocking if item.get("landmark") in names]
        if missing or subsystem_warnings:
            status = "needs_review"
        else:
            local_non_blocking = [item for item in non_blocking if item.get("landmark") in names]
            status = "valid_with_warnings" if local_non_blocking else "valid"
        subsystems[subsystem] = {
            "status": status,
            "required": names,
            "missingOrInvalid": missing,
            "blockingWarnings": subsystem_warnings,
            "nonBlockingWarnings": [item for item in non_blocking if item.get("landmark") in names],
        }
    states = [item["status"] for item in subsystems.values()]
    body_status = "needs_review" if "needs_review" in states else (
        "valid_with_warnings" if "valid_with_warnings" in states else "valid"
    )
    body_report["status"] = body_status
    body_report["blockingWarnings"] = blocking
    body_report["nonBlockingWarnings"] = non_blocking
    body_report["warnings"] = _dedupe_warnings([*blocking, *non_blocking])
    body_report["subsystems"] = subsystems
    body_report["segmentation"] = segmentation_report
    body_report["visibleSurfaceAnchors"] = sum(
        1 for item in landmarks.values() if isinstance(item, dict) and item.get("surfaceAccepted", False)
    )
    return body_report


def _combine_landmarks(body: dict, face: dict, hands: dict):
    combined = dict(body.get("landmarks") or {})
    combined.update(face.get("landmarks") or {})
    combined.update(hands.get("left", {}).get("landmarks") or {})
    combined.update(hands.get("right", {}).get("landmarks") or {})
    return combined


def _attempt_summary(name: str, manifest: dict, detector: dict, face: dict, hands: dict):
    coverage = detector.get("detectionCoverage") or {}
    return {
        "name": name,
        "resolution": manifest.get("resolution"),
        "handFraming": manifest.get("handFraming"),
        "renderedViews": sum(1 for item in manifest.get("views") or [] if item.get("rendered")),
        "invalidFramingViews": [item.get("name") for item in manifest.get("views") or [] if not item.get("framingValid", True)],
        "detectorCoverage": coverage,
        "faceStatus": face.get("status"),
        "leftHandStatus": (hands.get("left") or {}).get("status"),
        "rightHandStatus": (hands.get("right") or {}).get("status"),
    }


def _global_status(body_report: dict, readiness: dict, warnings: list[dict]):
    if not bool(body_report.get("isHumanoid")) or float(body_report.get("humanoidConfidence", 0.0)) < 0.40:
        return "invalid"
    if not readiness.get("approved"):
        return "needs_review"
    return "valid_with_warnings" if warnings else "valid"


def run(input_path: Path, output_dir: Path):
    started = time.perf_counter()
    run_id = uuid.uuid4().hex
    output_dir.mkdir(parents=True, exist_ok=True)
    stages = []
    manifests = []

    def stage(name, stage_started):
        stages.append({"stage": name, "durationMs": max(1, int((time.perf_counter() - stage_started) * 1000))})

    try:
        current = time.perf_counter()
        meshes = autorig_v16.import_original_fresh(input_path)
        memory_guard = prepare_analysis_meshes(meshes)
        autorig_v16._IMPORT_REPORT["analysisMemoryGuard"] = memory_guard
        canonical_orientation = canonicalize_temporary_copy(meshes)
        stage("loading_and_canonicalizing_clean_analysis_copy", current)

        current = time.perf_counter()
        body_report, body_vectors, classifications = analyze_body(meshes)
        body_report["orientation"] = canonical_orientation
        initial_segmentation = segment_anatomy(meshes, classifications, body_vectors, body_report["dimensions"])
        refined_vectors, limb_diagnostics = refine_limb_joints(meshes, initial_segmentation, body_vectors)
        segmentation = segment_anatomy_v3(
            meshes, classifications, refined_vectors, body_report["dimensions"], limb_diagnostics,
        )
        body_report, body_vectors = _apply_refined_body_vectors(
            body_report, body_vectors, refined_vectors, limb_diagnostics,
        )
        anatomy_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
        body_report = _sanitize_body_landmarks(body_report, body_vectors, segmentation, anatomy_bvh)
        stage("segmenting_geodesic_limbs_and_building_region_bvh", current)

        current = time.perf_counter()
        initial_render_dir = output_dir / "renders_initial"
        initial_manifest = render_multiview_v32(
            initial_render_dir, body_vectors, float(body_report["dimensions"]["height"]),
            meshes=meshes, segmentation=segmentation, classifications=classifications,
            anatomy_bvh=anatomy_bvh, resolution=512, technical_resolution=256,
            hand_framing=1.72, attempt="initial",
        )
        manifests.append(initial_manifest)
        stage("rendering_initial_rgb_edges_depth_normals_region_ids", current)

        current = time.perf_counter()
        initial_detector, initial_detector_process = _run_detector(initial_manifest, output_dir, "initial")
        initial_face = analyze_face(
            initial_detector, initial_manifest, meshes, classifications, body_vectors,
            float(body_report["dimensions"]["width"]), segmentation, anatomy_bvh,
        )
        initial_hands = analyze_hands(
            initial_detector, initial_manifest, classifications, segmentation, meshes, anatomy_bvh,
        )
        topology_bvh = initial_hands.pop("_anatomy_bvh", anatomy_bvh)
        stage("initial_detection_and_topology_segmentation", current)

        initial_attempt = _attempt_summary("initial", initial_manifest, initial_detector, initial_face, initial_hands)
        initial_coverage = initial_detector.get("detectionCoverage") or {}
        low_hand_evidence = any(int(initial_coverage.get(key) or 0) < 2 for key in ("leftHandViews", "rightHandViews"))
        low_face_evidence = int(initial_coverage.get("faceViews") or 0) < 2

        # Finger labels now exist in segmentation. Remove the initial proxies and
        # regenerate every visual and technical pass from the final regional BVH.
        cleanup_render_proxies(initial_manifest)

        current = time.perf_counter()
        final_render_dir = output_dir / "renders_temporales"
        final_manifest = render_multiview_v32(
            final_render_dir, body_vectors, float(body_report["dimensions"]["height"]),
            meshes=meshes, segmentation=segmentation, classifications=classifications,
            anatomy_bvh=topology_bvh,
            resolution=768 if low_hand_evidence or low_face_evidence else 512,
            technical_resolution=320 if low_hand_evidence or low_face_evidence else 256,
            hand_framing=1.92 if low_hand_evidence else 1.76,
            face_framing=2.08 if low_face_evidence else 1.98,
            attempt="retry" if low_hand_evidence or low_face_evidence else "final",
        )
        manifests.append(final_manifest)
        stage("regenerating_final_images_and_technical_passes", current)

        current = time.perf_counter()
        final_detector, final_detector_process = _run_detector(final_manifest, output_dir, "final")
        face = analyze_face(
            final_detector, final_manifest, meshes, classifications, body_vectors,
            float(body_report["dimensions"]["width"]), segmentation, topology_bvh,
        )
        hands = analyze_hands(
            final_detector, final_manifest, classifications, segmentation, meshes, topology_bvh,
        )
        final_bvh = hands.pop("_anatomy_bvh", topology_bvh)
        stage("final_face_hand_projection_and_triangulation", current)

        final_attempt = _attempt_summary("final", final_manifest, final_detector, face, hands)
        attempts = [initial_attempt, final_attempt]
        landmarks = annotate_landmarks(_combine_landmarks(body_report, face, hands))
        add_original_positions(landmarks, canonical_orientation["inverseCanonicalMatrix"])
        coverage = build_detection_coverage(final_manifest, final_detector, face, hands, attempts)
        readiness = calculate_rig_readiness(
            body_report, face, hands, landmarks, coverage, canonical_orientation,
        )
        warnings = _dedupe_warnings([
            *({**item, "attempt": "initial"} for item in (initial_detector.get("errors") or [])),
            *(body_report.get("warnings") or []),
            *(final_detector.get("errors") or []),
            *(face.get("warnings") or []),
            *(hands.get("warnings") or []),
            *({"code": gate, "failureStage": "rig_readiness", "blocking": True} for gate in readiness.get("gates") or []),
        ])
        status = _global_status(body_report, readiness, warnings)
        metrics = landmark_metrics(landmarks)
        source_sha = _sha256(input_path)
        analysis = {
            "version": VERSION,
            "mapVersion": "clouva-anatomical-map-v3.2",
            "runId": run_id,
            "status": status,
            "source": {
                "filename": input_path.name,
                "sha256": source_sha,
                "meshCount": len(meshes),
                "vertexCount": sum(len(mesh.data.vertices) for mesh in meshes),
                "polygonCount": sum(len(mesh.data.polygons) for mesh in meshes),
                "cleanup": dict(autorig_v16._IMPORT_REPORT),
            },
            "dimensions": body_report["dimensions"],
            "orientation": canonical_orientation,
            "symmetry": body_report["symmetry"],
            "pose": body_report["pose"],
            "isHumanoid": body_report["isHumanoid"],
            "humanoidConfidence": body_report["humanoidConfidence"],
            "bodyBaseConfidence": body_report["humanoidConfidence"],
            "rigReadinessScore": readiness["score"],
            "rigReadinessApproved": readiness["approved"],
            "rigReadinessGates": readiness["gates"],
            "rigReadinessComponents": readiness["components"],
            "criticalLandmarksVerified": critical_landmarks_verified(landmarks),
            "bodyAnalysis": body_report.get("status", "needs_review"),
            "bodySubsystems": body_report.get("subsystems") or {},
            "faceAnalysis": face.get("status"),
            "leftHandAnalysis": hands.get("left", {}).get("status"),
            "rightHandAnalysis": hands.get("right", {}).get("status"),
            "detectionCoverage": coverage,
            "fingerRig": "anatomical_map_ready" if readiness["approved"] else "blocked_by_analyzer",
            "facialRig": "analysis_only",
            "meshClassifications": classifications,
            "segmentation": segmentation.as_report(),
            "regionBvh": final_bvh.report(),
            "limbCenterlines": limb_diagnostics,
            "metrics": metrics,
            "landmarks": landmarks,
            "warnings": warnings,
            "diagnostics": {
                "body": body_report,
                "face": face,
                "hands": hands,
                "initialAttempt": {
                    "summary": initial_attempt,
                    "detector": initial_detector,
                    "detectorProcess": initial_detector_process,
                    "cameraManifest": initial_manifest,
                },
                "finalAttempt": {
                    "summary": final_attempt,
                    "detector": final_detector,
                    "detectorProcess": final_detector_process,
                    "cameraManifest": final_manifest,
                },
                "stages": stages,
            },
        }
        analysis_path = output_dir / "avatar_analysis.json"
        _write_json(analysis_path, analysis)

        current = time.perf_counter()
        diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
        diagnostic_build = build_diagnostic_glb(
            diagnostic_glb, meshes, landmarks, float(body_report["dimensions"]["height"]),
        )
        stage("building_layered_diagnostic_glb", current)

        report = {
            "version": VERSION,
            "runId": run_id,
            "status": status,
            "analysisPath": str(analysis_path),
            "diagnosticGlbPath": str(diagnostic_glb),
            "rendersDirectory": str(final_render_dir),
            "metrics": metrics,
            "rigReadiness": readiness,
            "detectionCoverage": coverage,
            "orientation": canonical_orientation,
            "bodySubsystems": body_report.get("subsystems") or {},
            "diagnosticBuild": diagnostic_build,
            "regionBvh": final_bvh.report(),
            "stageTimings": stages,
            "durationMs": max(1, int((time.perf_counter() - started) * 1000)),
            "limitations": [
                "The analyzer does not create or modify the production Armature.",
                "Fused or texture-only fingers remain needs_review instead of receiving invented joints.",
            ],
        }
        _write_json(output_dir / "diagnostic_report.json", report)
        print(f"[clouva-avatar-analyzer] {json.dumps(report, separators=(',', ':'))}", flush=True)
        return analysis, report
    finally:
        for manifest in manifests:
            try:
                cleanup_render_proxies(manifest)
            except Exception:
                pass


def main():
    input_path, output_dir = _args()
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    try:
        run(input_path, output_dir)
    except Exception:
        output_dir.mkdir(parents=True, exist_ok=True)
        _write_json(output_dir / "diagnostic_report.json", {
            "version": VERSION, "status": "failed", "error": traceback.format_exc(),
        })
        raise


if __name__ == "__main__":
    main()
