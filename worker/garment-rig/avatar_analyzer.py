"""CLOUVA Avatar Analyzer Blender entrypoint.

The script analyses and visualises landmarks only. It deliberately does not
create an armature, bind weights, replace the active avatar or export for Unreal.
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

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16 as autorig_v16
from body_analyzer import analyze_body
from diagnostic_builder import build_diagnostic_glb
from face_analyzer import analyze_face
from hand_analyzer import analyze_hands
from multiview_renderer import render_multiview

VERSION = "clouva-avatar-analyzer-v2-strict-surface"
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


def _run_detector(manifest: dict, output_dir: Path):
    request_path = output_dir / "detector_request.json"
    response_path = output_dir / "detector_output.json"
    request = {"version": VERSION, "views": manifest.get("views", [])}
    _write_json(request_path, request)
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


def _world_vertices(meshes, classifications):
    return [
        obj.matrix_world @ vertex.co
        for obj in meshes
        if classifications.get(obj.name) in {"body", "unknown"}
        for vertex in obj.data.vertices
    ]


def _surface_anchor(points, internal: Vector, center_x: float, sign: float,
                    body_width: float, body_height: float):
    """Find a visible surface anchor near a rough internal limb joint.

    The v1 preview drew skeleton-center estimates as green surface points. This
    function constrains the search to the same body side and height, then keeps
    the internal coordinate separately instead of pretending both are equal.
    """
    internal_lateral = sign * (internal.x - center_x)
    minimum_lateral = max(body_width * 0.075, internal_lateral * 0.72)
    candidates = [
        point for point in points
        if sign * (point.x - center_x) >= minimum_lateral
        and abs(float(point.z - internal.z)) <= body_height * 0.085
        and abs(float(point.y - internal.y)) <= body_height * 0.090
    ]
    if not candidates:
        return None, float("inf")
    anchor = min(candidates, key=lambda point: (point - internal).length)
    return anchor, (anchor - internal).length


def _sanitize_body_landmarks(meshes, body_report: dict, body_vectors: dict, classifications: dict):
    landmarks = body_report.get("landmarks") or {}
    dimensions = body_report.get("dimensions") or {}
    height = max(float(dimensions.get("height") or 0.0), 1e-5)
    width = max(float(dimensions.get("width") or 0.0), 1e-5)
    center_x = float(dimensions.get("center", [0.0])[0])
    points = _world_vertices(meshes, classifications)
    warnings = []

    # These names are schema aliases or skeleton-center nodes, not independent
    # surface detections. Keep them in JSON for Skeleton Planner, never draw them
    # as duplicate green balls.
    hidden_internal = {
        "root", "pelvis", "spine_01", "spine_02", "chest", "neck",
        "skull_base", "head_top", "head", "clavicle_l", "clavicle_r",
        "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r",
        "thigh_l", "thigh_r", "calf_l", "calf_r", "ball_l", "ball_r",
    }
    for name, item in landmarks.items():
        if not isinstance(item, dict):
            continue
        item["landmarkType"] = "internal_joint"
        item["display"] = False
        item["verified"] = float(item.get("confidence", 0.0)) >= 0.40
        if name in hidden_internal:
            item["diagnosticReason"] = "INTERNAL_OR_ALIAS_NOT_A_SURFACE_HIT"

    visible_joint_names = (
        "shoulder_l", "elbow_l", "wrist_l", "hand_l",
        "shoulder_r", "elbow_r", "wrist_r", "hand_r",
        "hip_l", "knee_l", "ankle_l", "foot_l",
        "hip_r", "knee_r", "ankle_r", "foot_r",
    )
    for name in visible_joint_names:
        item = landmarks.get(name)
        if not item or "position" not in item:
            warnings.append({"code": "BODY_JOINT_MISSING", "landmark": name})
            continue
        internal = Vector(tuple(float(value) for value in item["position"]))
        sign = 1.0 if name.endswith("_l") else -1.0
        anchor, distance = _surface_anchor(points, internal, center_x, sign, width, height)
        item["internalPosition"] = list(item["position"])
        item["surfaceDistance"] = distance if distance != float("inf") else None
        item["landmarkType"] = "surface_anchor"
        item["displayEdge"] = False
        verified = (
            anchor is not None
            and distance <= height * 0.055
            and float(item.get("confidence", 0.0)) >= 0.40
        )
        item["verified"] = verified
        item["display"] = verified
        if anchor is not None:
            item["displayPosition"] = [float(anchor.x), float(anchor.y), float(anchor.z)]
            item["surfaceMethod"] = "same-side-nearest-mesh-anchor-v2"
        if not verified:
            item["confidence"] = min(float(item.get("confidence", 0.0)), 0.35)
            warnings.append({
                "code": "BODY_JOINT_NOT_ON_EXPECTED_LIMB",
                "landmark": name,
                "surfaceDistance": item.get("surfaceDistance"),
            })

    body_status = "needs_review" if warnings else "valid"
    body_report["status"] = body_status
    body_report["warnings"] = warnings
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
    detailed = [
        body_report.get("status"),
        face.get("status"),
        hands.get("left", {}).get("status"),
        hands.get("right", {}).get("status"),
    ]
    if any(status == "needs_review" for status in detailed):
        return "needs_review"
    if any(status == "valid_with_warnings" for status in detailed):
        return "valid_with_warnings"
    return "valid"


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
    body_report = _sanitize_body_landmarks(meshes, body_report, body_vectors, classifications)
    stage("detecting_and_validating_body_regions", current)

    current = time.perf_counter()
    manifest = render_multiview(
        renders_dir,
        body_vectors,
        float(body_report["dimensions"]["height"]),
    )
    stage("rendering_multiview", current)

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
    )
    stage("projecting_and_fusing_face", current)

    current = time.perf_counter()
    hands = analyze_hands(
        detector_output,
        manifest,
        classifications,
        float(body_report["dimensions"]["height"]),
    )
    stage("projecting_and_fusing_hands", current)

    landmarks = _combine_landmarks(body_report, face, hands)
    status = _analysis_status(body_report, face, hands)
    warnings = [
        *(body_report.get("warnings") or []),
        *(detector_output.get("errors") or []),
        *(face.get("warnings") or []),
        *(hands.get("warnings") or []),
    ]
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
        "fingerRig": "not_connected_phase1",
        "facialRig": "not_connected_phase1",
        "meshClassifications": classifications,
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
    stage("building_diagnostic_glb", current)

    report = {
        "version": VERSION,
        "runId": run_id,
        "status": status,
        "analysisPath": str(analysis_path),
        "diagnosticGlbPath": str(diagnostic_glb),
        "rendersDirectory": str(renders_dir),
        "diagnosticBuild": diagnostic_build,
        "stageTimings": stages,
        "durationMs": max(1, int((time.perf_counter() - started) * 1000)),
        "limitations": [
            "The analyzer does not create or modify the production Armature.",
            "Only verified surface points are visible in the default GLB.",
            "Internal skeleton estimates and schema aliases remain in JSON but are hidden.",
            "Fused or texture-only fingers cannot produce verified phalange landmarks.",
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
        failure = {
            "version": VERSION,
            "status": "failed",
            "error": traceback.format_exc(),
        }
        _write_json(output_dir / "diagnostic_report.json", failure)
        raise


if __name__ == "__main__":
    main()
