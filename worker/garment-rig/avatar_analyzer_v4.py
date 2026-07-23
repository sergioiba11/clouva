"""CLOUVA Avatar Analyzer V4 entrypoint layered safely over retained V3.2.

V3.2 remains available and is executed first on the same temporary Blender copy.
V4 adds the adaptive camera pass, projection self-test, optional-module isolation,
confidence calibration, joint corridors and versioned rig-profile result.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
import traceback

from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import avatar_analyzer as analyzer_v32
from analyzer_v4_contract import ANALYZER_VERSION, DEFAULT_CONFIG, upgrade_analysis_v4
from anatomy_bvh import build_anatomy_bvh
from anatomy_segmenter_v3 import segment_anatomy_v3
from camera_projection_self_test_v4 import filter_invalid_views, validate_manifest
from multiview_renderer_v4 import cleanup_render_proxies, render_multiview_v4
from preflight_v4 import run_preflight

VERSION = ANALYZER_VERSION
REQUESTED_PROFILE_ENV = "CLOUVA_REQUESTED_RIG_PROFILE"


def _args():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) < 2:
        raise RuntimeError("Usage: avatar_analyzer_v4.py input.glb output_directory")
    return Path(values[0]).resolve(), Path(values[1]).resolve()


def _write(path: Path, payload):
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _vector(record):
    if not isinstance(record, dict):
        return None
    value = record.get("internalJointPosition") or record.get("position")
    if not isinstance(value, list) or len(value) != 3:
        return None
    return Vector(tuple(float(component) for component in value))


def _body_vectors(analysis: dict):
    landmarks = analysis.get("landmarks") or {}
    aliases = {
        "root": "root", "pelvis": "pelvis", "spine_01": "spine_01",
        "spine_02": "spine_02", "chest": "chest", "neck": "neck",
        "skull_base": "skull_base", "head_top": "head_top", "head": "head",
        "clavicle_l": "clavicle_l", "clavicle_r": "clavicle_r",
        "shoulder_l": "shoulder_l", "elbow_l": "elbow_l", "wrist_l": "wrist_l", "hand_l": "hand_l",
        "shoulder_r": "shoulder_r", "elbow_r": "elbow_r", "wrist_r": "wrist_r", "hand_r": "hand_r",
        "hip_l": "hip_l", "knee_l": "knee_l", "ankle_l": "ankle_l", "foot_l": "foot_l",
        "hip_r": "hip_r", "knee_r": "knee_r", "ankle_r": "ankle_r", "foot_r": "foot_r",
        "upperarm_l": "shoulder_l", "lowerarm_l": "elbow_l",
        "upperarm_r": "shoulder_r", "lowerarm_r": "elbow_r",
        "thigh_l": "hip_l", "calf_l": "knee_l", "thigh_r": "hip_r", "calf_r": "knee_r",
    }
    result = {}
    for target, source in aliases.items():
        value = _vector(landmarks.get(source))
        if value is not None:
            result[target] = value
    missing = [name for name in ("pelvis", "chest", "neck", "skull_base", "head_top", "wrist_l", "hand_l", "wrist_r", "hand_r") if name not in result]
    if missing:
        raise RuntimeError(f"V4 camera rig missing body vectors: {', '.join(missing)}")
    return result


def _real_meshes():
    import bpy
    return [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and not bool(obj.get("clouva_render_proxy", False))
        and not bool(obj.get("clouva_visual_only", False))
    ]


def _refresh_optional_modules(analysis: dict, output_dir: Path):
    """Run V4 cameras and detectors; return diagnostics without blocking body fallback."""
    manifests = []
    try:
        meshes = _real_meshes()
        preflight = run_preflight(meshes, analysis.get("orientation") or {})
        analysis["preflight"] = preflight
        vectors = _body_vectors(analysis)
        classifications = analysis.get("meshClassifications") or {}
        dimensions = analysis.get("dimensions") or {}
        limb = analysis.get("limbCenterlines") or {}
        segmentation = segment_anatomy_v3(meshes, classifications, vectors, dimensions, limb)
        anatomy_bvh = build_anatomy_bvh(meshes, segmentation, classifications)
        render_dir = output_dir / "renders_v4"
        manifest = render_multiview_v4(
            render_dir,
            vectors,
            float(dimensions.get("height") or 1.0),
            meshes=meshes,
            segmentation=segmentation,
            classifications=classifications,
            anatomy_bvh=anatomy_bvh,
            attempt="v4",
            config=DEFAULT_CONFIG,
        )
        manifests.append(manifest)
        calibration = validate_manifest(manifest, DEFAULT_CONFIG)
        valid_manifest = filter_invalid_views(manifest, calibration)
        detector, detector_process = analyzer_v32._run_detector(valid_manifest, output_dir, "v4")
        face = analyzer_v32.analyze_face(
            detector, valid_manifest, meshes, classifications, vectors,
            float(dimensions.get("width") or 0.0), segmentation, anatomy_bvh,
        )
        hands = analyzer_v32.analyze_hands(
            detector, valid_manifest, classifications, segmentation, meshes, anatomy_bvh,
        )
        final_bvh = hands.pop("_anatomy_bvh", anatomy_bvh)
        landmarks = analysis.setdefault("landmarks", {})
        landmarks.update(face.get("landmarks") or {})
        landmarks.update((hands.get("left") or {}).get("landmarks") or {})
        landmarks.update((hands.get("right") or {}).get("landmarks") or {})
        analysis["faceAnalysis"] = face.get("status")
        analysis["leftHandAnalysis"] = (hands.get("left") or {}).get("status")
        analysis["rightHandAnalysis"] = (hands.get("right") or {}).get("status")
        analysis.setdefault("diagnostics", {})["v4Attempt"] = {
            "cameraManifest": manifest,
            "cameraCalibration": calibration,
            "detector": detector,
            "detectorProcess": detector_process,
            "face": face,
            "hands": hands,
            "regionBvh": final_bvh.report(),
        }
        analysis["segmentation"] = segmentation.as_report()
        analysis["regionBvh"] = final_bvh.report()
        return calibration, {"status": "completed", "manifest": manifest, "detector": detector}
    except Exception:
        failure = traceback.format_exc()
        analysis.setdefault("warnings", []).append({
            "code": "V4_OPTIONAL_REANALYSIS_FAILED",
            "failureStage": "adaptive_multiview_optional_modules",
            "message": failure[-4000:],
            "blocking": False,
        })
        calibration = {
            "version": "clouva-camera-projection-self-test-v4.0",
            "status": "unavailable",
            "valid_views": [],
            "invalid_views": [],
            "all_views_invalid": False,
            "error": failure[-4000:],
        }
        return calibration, {"status": "fallback_to_v3.2", "error": failure[-4000:]}
    finally:
        for manifest in manifests:
            try:
                cleanup_render_proxies(manifest)
            except Exception:
                pass


def run(input_path: Path, output_dir: Path):
    started = time.perf_counter()
    requested_profile = os.environ.get(REQUESTED_PROFILE_ENV, "BODY_BASIC").strip().upper() or "BODY_BASIC"
    legacy_analysis, legacy_report = analyzer_v32.run(input_path, output_dir)
    calibration, v4_attempt = _refresh_optional_modules(legacy_analysis, output_dir)
    analysis = upgrade_analysis_v4(
        legacy_analysis,
        requested_rig_profile=requested_profile,
        camera_calibration=calibration,
        config=DEFAULT_CONFIG,
    )
    analysis.setdefault("diagnostics", {})["v4Upgrade"] = {
        "version": VERSION,
        "requestedRigProfile": requested_profile,
        "optionalReanalysis": v4_attempt,
        "durationMs": max(1, int((time.perf_counter() - started) * 1000)),
    }
    analysis_path = output_dir / "avatar_analysis.json"
    _write(analysis_path, analysis)
    report_path = output_dir / "diagnostic_report.json"
    report = dict(legacy_report)
    report.update({
        "version": VERSION,
        "status": analysis.get("overall_status"),
        "requestedRigProfile": requested_profile,
        "supportedRigProfiles": analysis.get("supported_rig_profiles") or [],
        "cameraCalibration": calibration,
        "topologyCapabilities": analysis.get("topology_capabilities") or {},
        "rootCauses": analysis.get("root_causes") or [],
        "fallbacksUsed": analysis.get("fallbacks_used") or [],
        "blockingReasons": analysis.get("blocking_reasons") or [],
        "recommendedNextAction": analysis.get("recommended_next_action"),
        "diagnosticFingerprint": analysis.get("diagnostic_fingerprint"),
        "legacyV32Preserved": True,
        "durationMs": max(1, int((time.perf_counter() - started) * 1000)),
    })
    _write(report_path, report)
    print(f"[clouva-avatar-analyzer-v4] {json.dumps(report, separators=(',', ':'))}", flush=True)
    return analysis, report


def main():
    input_path, output_dir = _args()
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        run(input_path, output_dir)
    except Exception:
        _write(output_dir / "diagnostic_report.json", {
            "version": VERSION,
            "status": "technical_failure",
            "error": traceback.format_exc(),
        })
        raise


if __name__ == "__main__":
    main()
