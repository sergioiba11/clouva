"""Profile-aware Skeleton Planner bridge for CLOUVA Avatar Analyzer V4.

The production armature/weights remain AutoRig V16. Only landmarks in an approved
V4 state are injected; optional face/finger failures never block BODY_BASIC.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import autorig_avatar_v16 as base
from analyzer_v4_contract import ANALYZER_VERSION, APPROVED_STATES, RIG_PROFILES
from canonical_orientation import canonicalize_temporary_copy

ANALYSIS_ENV = "CLOUVA_ANALYZER_ANALYSIS_PATH"
REQUESTED_PROFILE_ENV = "CLOUVA_REQUESTED_RIG_PROFILE"
EXPECTED_ANALYZER_VERSION = ANALYZER_VERSION


def _analysis_path():
    value = os.environ.get(ANALYSIS_ENV, "").strip()
    if not value:
        raise RuntimeError("AutoRig requires an approved Avatar Analyzer V4 map")
    path = Path(value).resolve()
    if not path.is_file():
        raise RuntimeError("Avatar Analyzer V4 map file is missing")
    return path


def _requested_profile(analysis: dict):
    value = os.environ.get(REQUESTED_PROFILE_ENV, "").strip()
    profile = value or str(analysis.get("requested_rig_profile") or "body_only")
    if profile not in RIG_PROFILES:
        profile = next(
            (candidate for candidate in RIG_PROFILES if candidate.upper() == profile.upper()),
            profile,
        )
    if profile not in RIG_PROFILES:
        raise RuntimeError(f"Unsupported rig profile: {profile}")
    return profile


def _load_analysis(input_path: Path):
    path = _analysis_path()
    analysis = json.loads(path.read_text(encoding="utf-8"))
    if analysis.get("version") != EXPECTED_ANALYZER_VERSION:
        raise RuntimeError(f"AutoRig requires {EXPECTED_ANALYZER_VERSION}")
    requested = _requested_profile(analysis)
    supported = set(analysis.get("supported_rig_profiles") or [])
    if requested not in supported:
        raise RuntimeError(
            f"Avatar Analyzer V4 cannot produce {requested}: {analysis.get('blocking_reasons')}"
        )
    if analysis.get("overall_status") not in {"approved", "approved_with_fallbacks"}:
        raise RuntimeError(f"Avatar Analyzer V4 did not approve the source: {analysis.get('overall_status')}")
    source_sha = str((analysis.get("source") or {}).get("sha256") or "")
    input_sha = base.sha256_file(input_path)
    if not source_sha or source_sha != input_sha:
        raise RuntimeError("Analyzer source SHA-256 does not match AutoRig input")
    if requested in {"BODY_BASIC", "body_only"} and analysis.get("criticalLandmarksVerified") is not True:
        raise RuntimeError("BODY_BASIC critical landmarks were not approved")
    return path, analysis, requested


def _point(record):
    if not isinstance(record, dict) or record.get("state") not in APPROVED_STATES:
        return None
    value = record.get("internalJointPosition") or record.get("position")
    if not isinstance(value, list) or len(value) != 3:
        return None
    return Vector(tuple(float(component) for component in value))


def _seed_detector(analysis: dict, seeded: list[str]):
    original_detect = base.MeshLandmarkDetector.detect
    records = analysis.get("skeleton_planner_input") or analysis.get("landmarks") or {}

    def detected(self):
        landmarks, confidence = original_detect(self)
        central = {
            "pelvis": "pelvis",
            "lowerSpine": "spine_01",
            "midSpine": "spine_02",
            "chest": "chest",
            "neckBase": "neck",
            "skullBase": "skull_base",
            "headTop": "head_top",
        }
        for target, source in central.items():
            value = _point(records.get(source))
            if value is None:
                continue
            landmarks[target] = value
            confidence_key = target if target in confidence else "spine"
            confidence[confidence_key] = max(
                float(confidence.get(confidence_key, 0.0)),
                float((records.get(source) or {}).get("final_confidence") or 0.0),
            )
            seeded.append(source)

        for side, suffix in (("left", "l"), ("right", "r")):
            side_data = landmarks["sides"][side]
            mapping = {
                "shoulder": f"shoulder_{suffix}",
                "elbow": f"elbow_{suffix}",
                "wrist": f"wrist_{suffix}",
                "palmTip": f"hand_{suffix}",
                "hip": f"hip_{suffix}",
                "knee": f"knee_{suffix}",
                "ankle": f"ankle_{suffix}",
            }
            for target, source in mapping.items():
                value = _point(records.get(source))
                if value is not None:
                    side_data[target] = value
                    seeded.append(source)
            axis = side_data["palmTip"] - side_data["shoulder"]
            side_data["armAxisExtent"] = max(float(axis.length), self.height * 0.16)
            side_confidence = confidence.setdefault(side, {})
            for key, source in (
                ("shoulder", mapping["shoulder"]), ("arm", mapping["elbow"]),
                ("wrist", mapping["wrist"]), ("hip", mapping["hip"]),
                ("knee", mapping["knee"]), ("ankle", mapping["ankle"]),
            ):
                if source in seeded:
                    side_confidence[key] = max(
                        float(side_confidence.get(key, 0.0)),
                        float((records.get(source) or {}).get("final_confidence") or 0.0),
                    )
        return landmarks, confidence

    base.MeshLandmarkDetector.detect = detected


def run(input_path: Path, output_path: Path, metadata_path: Path):
    analysis_path, analysis, requested = _load_analysis(input_path)
    original_import = base.import_original_fresh
    canonical_report = {}
    seeded: list[str] = []

    def canonical_import(path):
        meshes = original_import(path)
        canonical_report.update(canonicalize_temporary_copy(meshes))
        return meshes

    base.import_original_fresh = canonical_import
    _seed_detector(analysis, seeded)
    profile = base.run(input_path, output_path, metadata_path)
    profile.update({
        "analyzerRunId": analysis.get("runId"),
        "analyzerVersion": analysis.get("version"),
        "analyzerStatus": analysis.get("overall_status"),
        "analyzedInputSha256": (analysis.get("source") or {}).get("sha256"),
        "rigInputSha256": profile.get("inputSha256"),
        "rigReadinessScore": analysis.get("rigReadinessScore"),
        "criticalLandmarksVerified": analysis.get("criticalLandmarksVerified"),
        "analysisTimestamp": int(analysis_path.stat().st_mtime),
        "analyzerMapVersion": analysis.get("mapVersion"),
        "analyzerSeededLandmarks": sorted(set(seeded)),
        "analyzerSeedCount": len(set(seeded)),
        "requestedRigProfile": requested,
        "supportedRigProfiles": analysis.get("supported_rig_profiles") or [],
        "diagnosticFingerprint": analysis.get("diagnostic_fingerprint"),
        "fallbacksUsed": analysis.get("fallbacks_used") or [],
        "canonicalOrientation": canonical_report,
        "skeletonPlanner": {
            "method": "autorig-v16-plus-approved-analyzer-v4-seeds",
            "acceptedStates": sorted(APPROVED_STATES),
            "fallback": "v16-geometry-only-for-landmarks-not-approved-by-v4",
            "inventedLandmarks": 0,
        },
    })
    if profile.get("analyzedInputSha256") != profile.get("rigInputSha256"):
        raise RuntimeError("AutoRig output proof has a different Analyzer input SHA-256")
    metadata_path.write_text(json.dumps(profile, separators=(",", ":")), encoding="utf-8")
    print(f"[clouva-autorig-analyzer-v4] {json.dumps(profile, separators=(',', ':'))}", flush=True)
    return profile


def main():
    args = base.args_after_separator()
    if len(args) < 3:
        raise RuntimeError("Usage: autorig_avatar_v19.py input.glb output.glb metadata.json")
    input_path, output_path, metadata_path = map(lambda value: Path(value).resolve(), args[:3])
    if not input_path.is_file():
        raise RuntimeError("Original clean avatar GLB not found")
    run(input_path, output_path, metadata_path)


if __name__ == "__main__":
    main()
