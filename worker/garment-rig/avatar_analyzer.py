"""CLOUVA Avatar Analyzer V2 Blender entrypoint.

The analyzer produces anatomy diagnostics only. It never creates an Armature,
binds weights, changes the active avatar or exports a production Unreal asset.
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
from anatomy_segmenter import segment_anatomy
from body_analyzer import analyze_body
from diagnostic_builder import build_diagnostic_glb
from face_analyzer import analyze_face
from hand_analyzer import analyze_hands
from multiview_renderer import render_multiview

VERSION = "clouva-avatar-analyzer-v2-anatomy-triangulation"
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


def _run_detector(manifest: dict, output_dir: Path):
    request_path = output_dir / "detector_request.json"
    response_path = output_dir / "detector_output.json"
    _write_json(request_path, {"version": VERSION, "views": manifest.get("views", [])})
    if not DETECTOR_SCRIPT.is_file():
        return {
            "version": "unavailable",
            "views": [],
            "errors": [{"code": "DETECTOR_SCRIPT_MISSING", "path": str(DETECTOR_SCRIPT)}],
        }, {"returnCode": None, "stdout": "", "stderr": "detector script missing"}
    command = [AUX_PYTHON, str(DETECTOR_SCRIPT), str(request_path), str(response_path)]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=DETECTOR_TIMEOUT_SECONDS,
            cwd=str(output_dir),
            env={**os.environ, "PYTHONPATH": str(SCRIPT_DIR)},
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "version": "timeout",
            "views": [],
            "errors": [{"code": "MEDIAPIPE_TIMEOUT", "seconds": DETECTOR_TIMEOUT_SECONDS}],
        }, {"returnCode": None, "stdout": exc.stdout or "", "stderr": exc.stderr or ""}
    diagnostics = {
        "command": command,
        "returnCode": result.returncode,
        "stdout": result.stdout[-12000:],
        "stderr": result.stderr[-12000:],
    }
    if result.returncode != 0 or not response_path.is_file():
        return {
            "version": "failed",
            "views": [],
            "errors": [{
                "code": "MEDIAPIPE_PROCESS_FAILED",
                "returnCode": result.returncode,
                "message": result.stderr[-2000:] or result.stdout[-2000:],
            }],
        }, diagnostics
    return json.loads(response_path.read_text(encoding="utf-8")), diagnostics


def _body_region_map():
    return {
        "shoulder_l": ("upper_arm_l",),
        "elbow_l": ("upper_arm_l", "forearm_l"),
        "wrist_l": ("forearm_l", "hand_l"),
        "hand_l": ("hand_l",),
        "shoulder_r": ("upper_arm_r",),
        "elbow_r": ("upper_arm_r", "forearm_r"),
        "wrist_r": ("forearm_r", "hand_r"),
        "hand_r": ("hand_r",),
        "hip_l": ("pelvis", "thigh_l"),
        "knee_l": ("thigh_l", "calf_l"),
        "ankle_l": ("calf_l", "foot_l"),
        "foot_l": ("foot_l",),
        "hip_r": ("pelvis", "thigh_r"),
        "knee_r": ("thigh_r", "calf_r"),
        "ankle_r": ("calf_r", "foot_r"),
        "foot_r": ("foot_r",),
    }


def _apply_refined_body_vectors(body_report: dict, body_vectors: dict, segmentation):
    """Replace rough V16 limb candidates with the region-refined anatomical axes.

    The original detector remains useful as a seed, but Skeleton Planner must
    eventually consume the refined internal coordinates, not the first guess.
    Aliases such as upperarm/lowerarm/thigh/calf inherit the same refined joint
    without creating additional visual markers.
    """
    refined = getattr(segmentation, "refined_vectors", {}) or {}
    if not refined:
        return body_report, body_vectors
    body_vectors.update({name: value.copy() for name, value in refined.items()})
    landmarks = body_report.get("landmarks") or {}
    aliases = {
        "shoulder_l": "shoulder_l", "upperarm_l": "shoulder_l",
        "elbow_l": "elbow_l", "lowerarm_l": "elbow_l",
        "wrist_l": "wrist_l", "hand_l": "hand_l",
        "hip_l": "hip_l", "thigh_l": "hip_l",
        "knee_l": "knee_l", "calf_l": "knee_l",
        "ankle_l": "ankle_l", "foot_l": "foot_l",
        "shoulder_r": "shoulder_r", "upperarm_r": "shoulder_r",
        "elbow_r": "elbow_r", "lowerarm_r": "elbow_r",
        "wrist_r": "wrist_r", "hand_r": "hand_r",
        "hip_r": "hip_r", "thigh_r": "hip_r",
        "knee_r": "knee_r", "calf_r": "knee_r",
        "ankle_r": "ankle_r", "foot_r": "foot_r",
    }
    for landmark_name, source_name in aliases.items():
        point = refined.get(source_name)
        item = landmarks.get(landmark_name)
        if point is None or not isinstance(item, dict):
            continue
        previous = list(item.get("position") or [])
        item["roughCandidatePosition"] = previous
        item["position"] = _vec(point)
        item["internalJointPosition"] = _vec(point)
        item["refinedFrom"] = source_name
        item["method"] = "anatomy-segmented-limb-axis-v2.1"
    for suffix in ("l", "r"):
        shoulder = refined.get(f"shoulder_{suffix}")
        if shoulder is not None:
            body_vectors[f"clavicle_{suffix}"] = body_vectors["chest"].lerp(shoulder, 0.45)
            clavicle = landmarks.get(f"clavicle_{suffix}")
            if isinstance(clavicle, dict):
                clavicle["roughCandidatePosition"] = list(clavicle.get("position") or [])
                clavicle["position"] = _vec(body_vectors[f"clavicle_{suffix}"])
                clavicle["internalJointPosition"] = list(clavicle["position"])
                clavicle["method"] = "chest-to-refined-shoulder-internal-v2.1"
    body_report["refinedBodyAxesApplied"] = True
    body_report["refinedBodyVectors"] = {
        name: _vec(value) for name, value in refined.items()
    }
    return body_report, body_vectors


def _sanitize_body_landmarks(meshes, body_report: dict, body_vectors: dict,
                             classifications: dict, segmentation=None):
    """Separate internal body joints from region-restricted display anchors."""
    if segmentation is None:
        segmentation = segment_anatomy(
            meshes,
            classifications,
            body_vectors,
            body_report.get("dimensions") or {},
        )
        body_report, body_vectors = _apply_refined_body_vectors(body_report, body_vectors, segmentation)
    landmarks = body_report.get("landmarks") or {}
    height = max(float((body_report.get("dimensions") or {}).get("height") or 0.0), 1e-5)
    warnings = []
    hidden_internal = {
        "root", "pelvis", "spine_01", "spine_02", "chest", "neck",
        "skull_base", "head_top", "head", "clavicle_l", "clavicle_r",
        "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r",
        "thigh_l", "thigh_r", "calf_l", "calf_r", "ball_l", "ball_r",
    }
    for name, item in landmarks.items():
        if not isinstance(item, dict) or "position" not in item:
            continue
        item["name"] = name
        item["internalJointPosition"] = list(item["position"])
        item["landmarkType"] = "internal_joint"
        item["accepted"] = float(item.get("confidence", 0.0)) >= 0.40
        item["verified"] = item["accepted"]
        item["display"] = False
        item["methods"] = [
            "v16_body_candidate",
            "anatomy_region_segmentation",
            "refined_limb_axis" if item.get("roughCandidatePosition") is not None else "central_body_estimate",
        ]
        if name in hidden_internal:
            item["diagnosticReason"] = "INTERNAL_JOINT_NOT_SURFACE_LANDMARK"

    for name, regions in _body_region_map().items():
        item = landmarks.get(name)
        if not item or "position" not in item:
            warnings.append({"code": "BODY_JOINT_MISSING", "landmark": name})
            continue
        internal = Vector(tuple(float(value) for value in item["position"]))
        sample, distance = segmentation.nearest(internal, regions)
        measurement_side = "left" if name.endswith("_l") else "right"
        hand_scale = float(segmentation.hand_measurement(measurement_side).get("handScale") or 0.0)
        threshold = max(height * 0.045, hand_scale * 0.42 if name.startswith(("wrist_", "hand_")) else 0.0)
        accepted = (
            sample is not None
            and distance <= threshold
            and float(item.get("confidence", 0.0)) >= 0.40
        )
        item["region"] = regions[0]
        item["surfaceRegion"] = sample.region if sample else regions[0]
        item["surfaceDistance"] = float(distance) if distance != float("inf") else None
        item["accepted"] = accepted
        item["verified"] = accepted
        item["display"] = accepted
        item["displayEdge"] = False
        item["surfaceDisplayPosition"] = (
            [float(sample.point.x), float(sample.point.y), float(sample.point.z)]
            if sample else list(item["position"])
        )
        item["displayPosition"] = list(item["surfaceDisplayPosition"])
        item["surfaceMethod"] = "named-anatomy-region-nearest-surface-v2"
        if not accepted:
            item["confidence"] = min(float(item.get("confidence", 0.0)), 0.39)
            item.setdefault("rejectionReasons", []).append("BODY_JOINT_REGION_ANCHOR_INVALID")
            warnings.append({
                "code": "BODY_JOINT_REGION_ANCHOR_INVALID",
                "landmark": name,
                "allowedRegions": list(regions),
                "surfaceRegion": item.get("surfaceRegion"),
                "surfaceDistance": item.get("surfaceDistance"),
                "threshold": threshold,
            })

    critical_regions = (
        "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
        "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r", "head", "torso",
    )
    segmentation_report = segmentation.as_report()
    empty_regions = [
        name for name in critical_regions
        if int(segmentation_report.get("regions", {}).get(name, {}).get("vertexCount", 0)) < 4
    ]
    if empty_regions:
        warnings.append({"code": "ANATOMY_REGIONS_INSUFFICIENT", "regions": empty_regions})
    body_report["status"] = "needs_review" if warnings else "valid"
    body_report["warnings"] = warnings
    body_report["segmentation"] = segmentation_report
    body_report["visibleSurfaceAnchors"] = sum(
        1 for item in landmarks.values() if isinstance(item, dict) and item.get("display", False)
    )
    return body_report


def _combine_landmarks(body: dict, face: dict, hands: dict):
    combined = dict(body.get("landmarks") or {})
    combined.update(face.get("landmarks") or {})
    combined.update(hands.get("left", {}).get("landmarks") or {})
    combined.update(hands.get("right", {}).get("landmarks") or {})
    return combined


def _analysis_status(body_report: dict, face: dict, hands: dict):
    body_valid = bool(body_report.get("isHumanoid")) and float(body_report.get("humanoidConfidence", 0.0)) >= 0.40
    if not body_valid:
        return "invalid"
    states = [
        body_report.get("status"),
        face.get("status"),
        hands.get("left", {}).get("status"),
        hands.get("right", {}).get("status"),
    ]
    if any(state == "invalid" for state in states):
        return "invalid"
    if any(state == "needs_review" for state in states):
        return "needs_review"
    if any(state == "valid_with_warnings" for state in states):
        return "valid_with_warnings"
    return "valid"


def _landmark_metrics(landmarks: dict):
    values = [item for item in landmarks.values() if isinstance(item, dict) and "position" in item]
    return {
        "totalLandmarkRecords": len(values),
        "verifiedSurfaceLandmarkCount": sum(1 for item in values if item.get("display", False) and item.get("accepted", False)),
        "internalJointCount": sum(1 for item in values if item.get("landmarkType") in {"internal_joint", "derived_internal"}),
        "rejectedLandmarkCount": sum(1 for item in values if not item.get("accepted", False)),
        "hiddenLandmarkCount": sum(1 for item in values if not item.get("display", False)),
    }


def run(input_path: Path, output_dir: Path):
    started = time.perf_counter()
    run_id = uuid.uuid4().hex
    output_dir.mkdir(parents=True, exist_ok=True)
    renders_dir = output_dir / "renders_temporales"
    stages = []

    def stage(name, stage_started):
        stages.append({"stage": name, "durationMs": max(1, int((time.perf_counter() - stage_started) * 1000))})

    current = time.perf_counter()
    meshes = autorig_v16.import_original_fresh(input_path)
    stage("loading_scene_and_clean_analysis_copy", current)

    current = time.perf_counter()
    body_report, body_vectors, classifications = analyze_body(meshes)
    segmentation = segment_anatomy(meshes, classifications, body_vectors, body_report["dimensions"])
    body_report, body_vectors = _apply_refined_body_vectors(body_report, body_vectors, segmentation)
    body_report = _sanitize_body_landmarks(
        meshes, body_report, body_vectors, classifications, segmentation,
    )
    stage("segmenting_and_validating_anatomy_regions", current)

    current = time.perf_counter()
    manifest = render_multiview(
        renders_dir,
        body_vectors,
        float(body_report["dimensions"]["height"]),
        meshes=meshes,
        segmentation=segmentation,
        classifications=classifications,
    )
    stage("rendering_isolated_multiview", current)

    current = time.perf_counter()
    detector_output, detector_process = _run_detector(manifest, output_dir)
    stage("detecting_face_and_hands_2d", current)

    current = time.perf_counter()
    face = analyze_face(
        detector_output,
        manifest,
        meshes,
        classifications,
        body_vectors,
        float(body_report["dimensions"]["width"]),
        segmentation,
    )
    stage("triangulating_face_in_segmented_head", current)

    current = time.perf_counter()
    hands = analyze_hands(detector_output, manifest, classifications, segmentation)
    stage("triangulating_and_refining_finger_centerlines", current)

    landmarks = _combine_landmarks(body_report, face, hands)
    status = _analysis_status(body_report, face, hands)
    warnings = [
        *(body_report.get("warnings") or []),
        *(detector_output.get("errors") or []),
        *(face.get("warnings") or []),
        *(hands.get("warnings") or []),
    ]
    metrics = _landmark_metrics(landmarks)
    analysis = {
        "version": VERSION,
        "runId": run_id,
        "status": status,
        "source": {
            "filename": input_path.name,
            "sha256": _sha256(input_path),
            "meshCount": len(meshes),
            "vertexCount": sum(len(mesh.data.vertices) for mesh in meshes),
            "polygonCount": sum(len(mesh.data.polygons) for mesh in meshes),
            "cleanup": dict(autorig_v16._IMPORT_REPORT),
        },
        "dimensions": body_report["dimensions"],
        "orientation": body_report["orientation"],
        "symmetry": body_report["symmetry"],
        "pose": body_report["pose"],
        "isHumanoid": body_report["isHumanoid"],
        "humanoidConfidence": body_report["humanoidConfidence"],
        "bodyAnalysis": body_report.get("status", "needs_review"),
        "faceAnalysis": face.get("status"),
        "leftHandAnalysis": hands.get("left", {}).get("status"),
        "rightHandAnalysis": hands.get("right", {}).get("status"),
        "fingerRig": "not_connected_analysis_only",
        "facialRig": "not_connected_analysis_only",
        "meshClassifications": classifications,
        "segmentation": segmentation.as_report(),
        "metrics": metrics,
        "landmarks": landmarks,
        "warnings": warnings,
        "diagnostics": {
            "body": body_report,
            "face": face,
            "hands": hands,
            "detector": detector_output,
            "detectorProcess": detector_process,
            "cameraManifest": manifest,
            "stages": stages,
        },
    }
    analysis_path = output_dir / "avatar_analysis.json"
    _write_json(analysis_path, analysis)

    current = time.perf_counter()
    diagnostic_glb = output_dir / "diagnostic_landmarks.glb"
    diagnostic_build = build_diagnostic_glb(
        diagnostic_glb,
        meshes,
        landmarks,
        float(body_report["dimensions"]["height"]),
    )
    stage("building_layered_diagnostic_glb", current)

    report = {
        "version": VERSION,
        "runId": run_id,
        "status": status,
        "analysisPath": str(analysis_path),
        "diagnosticGlbPath": str(diagnostic_glb),
        "rendersDirectory": str(renders_dir),
        "metrics": metrics,
        "diagnosticBuild": diagnostic_build,
        "stageTimings": stages,
        "durationMs": max(1, int((time.perf_counter() - started) * 1000)),
        "limitations": [
            "The analyzer does not create or modify the production Armature.",
            "The diagnostic must be visually approved on the active CLOUVA avatar before Skeleton Planner integration.",
            "Texture-only or geometrically fused fingers remain needs_review instead of receiving invented joints.",
        ],
    }
    _write_json(output_dir / "diagnostic_report.json", report)
    print(f"[clouva-avatar-analyzer] {json.dumps(report, separators=(',', ':'))}", flush=True)
    return analysis, report


def main():
    input_path, output_dir = _args()
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    try:
        run(input_path, output_dir)
    except Exception:
        output_dir.mkdir(parents=True, exist_ok=True)
        _write_json(output_dir / "diagnostic_report.json", {
            "version": VERSION,
            "status": "failed",
            "error": traceback.format_exc(),
        })
        raise


if __name__ == "__main__":
    main()
