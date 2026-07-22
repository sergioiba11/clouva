"""CLOUVA Avatar Analyzer phase 1 Blender entrypoint.

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

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16 as autorig_v16
from body_analyzer import analyze_body
from diagnostic_builder import build_diagnostic_glb
from face_analyzer import analyze_face
from hand_analyzer import analyze_hands
from multiview_renderer import render_multiview

VERSION = "clouva-avatar-analyzer-v1-multiview"
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
    request = {
        "version": VERSION,
        "views": manifest.get("views", []),
    }
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
    detailed = [face.get("status"), hands.get("left", {}).get("status"), hands.get("right", {}).get("status")]
    if any(status == "needs_review" for status in detailed):
        return "valid_with_warnings"
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
    stage("detecting_body_regions", current)

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
        "bodyAnalysis": "valid" if body_report["isHumanoid"] else "invalid",
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
            "Phase 1 does not create or modify the production Armature.",
            "Landmarks below confidence 0.40 require visual review.",
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
