"""CLOUVA Avatar Analyzer V4 entrypoint layered safely over retained V3.2.

V3.2 remains available and is executed first on the same temporary Blender copy.
V4 adds the adaptive camera pass, projection self-test, optional-module isolation,
confidence calibration, joint corridors and versioned rig-profile result.
"""
from __future__ import annotations

import gc
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
from analyzer_v4_bootstrap import resolve_camera_vector_values
from anatomy_bvh import build_anatomy_bvh
from anatomy_segmenter_v3 import segment_anatomy_v3
from camera_projection_self_test_v4 import filter_invalid_views, validate_manifest
from diagnostic_builder import build_diagnostic_glb
from multiview_renderer_v4 import cleanup_render_proxies, render_multiview_v4
from preflight_v4 import run_preflight

VERSION = ANALYZER_VERSION
REQUESTED_PROFILE_ENV = "CLOUVA_REQUESTED_RIG_PROFILE"
REANALYSIS_ENV = "CLOUVA_REANALYSIS_OPERATION"
PHASE_ENV = "CLOUVA_AVATAR_ANALYZER_V4_PHASE"


def _args():
    if "--" not in sys.argv:
        raise RuntimeError("Missing Blender script arguments")
    values = sys.argv[sys.argv.index("--") + 1:]
    if len(values) < 2:
        raise RuntimeError("Usage: avatar_analyzer_v4.py input.glb output_directory")
    return Path(values[0]).resolve(), Path(values[1]).resolve()


def _write(path: Path, payload):
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _body_vectors(analysis: dict):
    values, diagnostics = resolve_camera_vector_values(analysis)
    analysis.setdefault("diagnostics", {})["v4CameraBootstrap"] = diagnostics
    if diagnostics["missing"]:
        raise RuntimeError(f"V4 camera rig missing body vectors: {', '.join(diagnostics['missing'])}")
    return {
        name: Vector(tuple(components))
        for name, components in values.items()
    }


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


def _upgrade_from_v32(
    input_path: Path,
    output_dir: Path,
    legacy_analysis: dict,
    legacy_report: dict,
    started: float,
):
    requested_profile = os.environ.get(REQUESTED_PROFILE_ENV, "body_only").strip() or "body_only"
    requested_operation = os.environ.get(REANALYSIS_ENV, "").strip() or None
    calibration, v4_attempt = _refresh_optional_modules(legacy_analysis, output_dir)
    analysis = upgrade_analysis_v4(
        legacy_analysis,
        requested_rig_profile=requested_profile,
        camera_calibration=calibration,
        config=DEFAULT_CONFIG,
    )
    diagnostic_build = build_diagnostic_glb(
        output_dir / "diagnostic_landmarks.glb",
        _real_meshes(),
        analysis.get("landmarks") or {},
        float((analysis.get("dimensions") or {}).get("height") or 1.0),
        include_all_states=True,
    )
    analysis.setdefault("diagnostics", {})["v4Upgrade"] = {
        "version": VERSION,
        "requestedRigProfile": requested_profile,
        "optionalReanalysis": v4_attempt,
        "requestedReanalysisOperation": requested_operation,
        "executedAsCleanPipeline": True,
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
        "diagnosticBuild": diagnostic_build,
        "legacyV32Preserved": True,
        "durationMs": max(1, int((time.perf_counter() - started) * 1000)),
    })
    _write(report_path, report)
    print(f"[clouva-avatar-analyzer-v4] {json.dumps(report, separators=(',', ':'))}", flush=True)
    return analysis, report


def _restore_clean_analysis_scene(input_path: Path):
    meshes = analyzer_v32.autorig_v16.import_original_fresh(input_path)
    memory_guard = analyzer_v32.prepare_analysis_meshes(meshes)
    analyzer_v32.autorig_v16._IMPORT_REPORT["analysisMemoryGuard"] = memory_guard
    analyzer_v32.canonicalize_temporary_copy(meshes)
    return meshes


def run(input_path: Path, output_dir: Path):
    started = time.perf_counter()
    phase = os.environ.get(PHASE_ENV, "").strip().lower()
    if phase == "base":
        result = analyzer_v32.run(input_path, output_dir)
        print("[clouva-avatar-analyzer-v4] base phase completed", flush=True)
        return result
    if phase == "upgrade":
        analysis_path = output_dir / "avatar_analysis.json"
        report_path = output_dir / "diagnostic_report.json"
        if not analysis_path.is_file() or not report_path.is_file():
            raise RuntimeError("V4 upgrade phase requires completed V3.2 output")
        legacy_analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
        legacy_report = json.loads(report_path.read_text(encoding="utf-8"))
        _restore_clean_analysis_scene(input_path)
        return _upgrade_from_v32(
            input_path,
            output_dir,
            legacy_analysis,
            legacy_report,
            started,
        )

    legacy_analysis, legacy_report = analyzer_v32.run(input_path, output_dir)
    gc.collect()
    return _upgrade_from_v32(
        input_path,
        output_dir,
        legacy_analysis,
        legacy_report,
        started,
    )


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
