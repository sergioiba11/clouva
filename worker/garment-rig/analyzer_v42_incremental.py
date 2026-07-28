"""Incremental orchestration primitives for CLOUVA Avatar Analyzer V4.2.

This module is intentionally Blender-free so cache keys, module plans, warning
replacement and deterministic merge behavior can be unit tested in seconds.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Iterable

ANALYZER_VERSION = "clouva-avatar-analyzer-v4.2"
MAP_VERSION = "clouva-anatomical-map-v4.2"
CACHE_CONTRACT_VERSION = "clouva-avatar-analysis-cache-v4.2"
CAMERA_RIG_VERSION = "clouva-adaptive-camera-rig-v4.2"
SPARSE_PROJECTION_VERSION = "clouva-sparse-landmark-projection-v4.2"

MODULE_VERSIONS = {
    "base_geometry": "4.2.0",
    "body": "4.2.0",
    "left_hand": "4.2.0",
    "right_hand": "4.2.0",
    "face": "4.2.0",
    "measurements": "4.2.0",
    "evidence_merge": "4.2.0",
    "rig_profile_evaluation": "4.2.0",
    "diagnostics": "4.2.0",
}

PROFILE_ALIASES = {
    "body_only": "BODY_BASIC",
    "body_with_hands": "BODY_HANDS_BASIC",
    "full_humanoid": "FULL_HUMANOID",
    "full_humanoid_with_face": "FULL_BODY_HANDS_FACE",
    "BODY_FACE": "FULL_BODY_HANDS_FACE",
}

PROFILE_MODULES = {
    "BODY_BASIC": ("body", "measurements"),
    "BODY_HANDS_BASIC": ("body", "left_hand", "right_hand", "measurements"),
    "FULL_HUMANOID": ("body", "left_hand", "right_hand", "measurements"),
    "FULL_BODY_HANDS_FACE": ("body", "left_hand", "right_hand", "face", "measurements"),
}

MODULE_REGIONS = {
    "body": {"body", "torso", "pelvis", "neck", "head", "left_arm", "right_arm", "left_leg", "right_leg"},
    "face": {"face", "head", "eyes"},
    "left_hand": {"hand_l", "forearm_l", "thumb_l", "index_l", "middle_l", "ring_l", "pinky_l"},
    "right_hand": {"hand_r", "forearm_r", "thumb_r", "index_r", "middle_r", "ring_r", "pinky_r"},
    "measurements": {"measurements"},
}

MODULE_CAMERAS = {
    "body": ("body_front", "body_back", "body_left", "body_right"),
    "face": ("face_front", "face_left_30", "face_right_30"),
    "left_hand": ("hand_l_palmar", "hand_l_dorsal", "hand_l_radial", "hand_l_ulnar"),
    "right_hand": ("hand_r_palmar", "hand_r_dorsal", "hand_r_radial", "hand_r_ulnar"),
    "measurements": (),
}

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def stable_hash(payload: Any) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(serialized.encode("utf-8")).hexdigest()


def canonical_profile(value: str | None) -> str:
    profile = PROFILE_ALIASES.get(str(value or "BODY_BASIC"), str(value or "BODY_BASIC"))
    return profile if profile in PROFILE_MODULES else "BODY_BASIC"


def modules_for_profile(value: str | None) -> list[str]:
    return list(PROFILE_MODULES[canonical_profile(value)])


def module_for_landmark(name: str | None) -> str:
    value = str(name or "")
    if value.endswith("_l") and value.startswith((*FINGERS, "wrist", "palm", "hand")):
        return "left_hand"
    if value.endswith("_r") and value.startswith((*FINGERS, "wrist", "palm", "hand")):
        return "right_hand"
    if value.startswith(("eye_", "brow_", "nose_", "mouth_", "upper_lip", "lower_lip", "jaw", "chin", "ear_", "cheek_", "temple_", "forehead_")):
        return "face"
    return "body"


def _landmarks_for_module(module: str) -> list[str]:
    if module == "left_hand":
        return ["wrist_l", "palm_l", *[f"{finger}_{joint}_l" for finger in FINGERS for joint in ("01", "02", "03", "tip")]]
    if module == "right_hand":
        return ["wrist_r", "palm_r", *[f"{finger}_{joint}_r" for finger in FINGERS for joint in ("01", "02", "03", "tip")]]
    return []


def build_incremental_plan(
    operation: str | None,
    *,
    requested_profile: str | None = None,
    landmark: str | None = None,
    camera_id: str | None = None,
    region: str | None = None,
) -> dict[str, Any]:
    profile = canonical_profile(requested_profile)
    operation = str(operation or "initial")
    if operation in {"initial", "rerun_full_pipeline"}:
        modules = modules_for_profile(profile)
        plan = {
            "operation": operation,
            "requestedProfile": profile,
            "modules": modules,
            "regions": sorted({value for module in modules for value in MODULE_REGIONS.get(module, set())}),
            "cameras": [camera for module in modules for camera in MODULE_CAMERAS.get(module, ())],
            "landmarks": [],
            "full": operation == "rerun_full_pipeline",
        }
    elif operation == "reanalyze_left_hand":
        plan = {"operation": operation, "requestedProfile": profile, "modules": ["left_hand"], "regions": ["hand_l", "forearm_l"], "cameras": list(MODULE_CAMERAS["left_hand"]), "landmarks": _landmarks_for_module("left_hand"), "full": False}
    elif operation == "reanalyze_right_hand":
        plan = {"operation": operation, "requestedProfile": profile, "modules": ["right_hand"], "regions": ["hand_r", "forearm_r"], "cameras": list(MODULE_CAMERAS["right_hand"]), "landmarks": _landmarks_for_module("right_hand"), "full": False}
    elif operation == "reanalyze_face":
        plan = {"operation": operation, "requestedProfile": profile, "modules": ["face"], "regions": ["face", "head", "eyes"], "cameras": list(MODULE_CAMERAS["face"]), "landmarks": [], "full": False}
    elif operation in {"reanalyze_body", "reanalyze_right_shoulder"}:
        landmarks = ["shoulder_r", "clavicle_r", "elbow_r", "shoulder_l", "clavicle_l", "elbow_l"] if operation == "reanalyze_right_shoulder" else []
        plan = {"operation": operation, "requestedProfile": profile, "modules": ["body", "measurements"], "regions": ["body"] if not region else [region], "cameras": [] if operation == "reanalyze_right_shoulder" else list(MODULE_CAMERAS["body"]), "landmarks": landmarks, "full": False}
    elif operation == "reanalyze_landmark" and landmark:
        module = module_for_landmark(landmark)
        useful = list(MODULE_CAMERAS.get(module, ()))[:2]
        plan = {"operation": operation, "requestedProfile": profile, "modules": [module], "regions": sorted(MODULE_REGIONS.get(module, {module})), "cameras": useful, "landmarks": [landmark], "full": False}
    elif operation == "reanalyze_camera":
        selected = str(camera_id or "")
        module = "left_hand" if selected.startswith("hand_l_") else "right_hand" if selected.startswith("hand_r_") else "face" if selected.startswith("face_") else "body"
        plan = {"operation": operation, "requestedProfile": profile, "modules": [module], "regions": sorted(MODULE_REGIONS.get(module, {module})), "cameras": [selected] if selected else list(MODULE_CAMERAS.get(module, ()))[:1], "landmarks": [], "full": False}
    elif operation == "reanalyze_region":
        selected = str(region or "body")
        module = "left_hand" if selected.endswith("_l") and "hand" in selected else "right_hand" if selected.endswith("_r") and "hand" in selected else "face" if selected in {"face", "head", "eyes"} else "body"
        plan = {"operation": operation, "requestedProfile": profile, "modules": [module], "regions": [selected], "cameras": list(MODULE_CAMERAS.get(module, ())), "landmarks": [], "full": False}
    else:
        plan = build_incremental_plan("initial", requested_profile=profile)
        plan["operation"] = operation

    if camera_id:
        plan["cameras"] = [camera_id]
    if region:
        plan["regions"] = [region]
    plan["replaceModules"] = list(plan["modules"])
    plan["replaceLandmarks"] = list(plan["landmarks"])
    plan["planHash"] = stable_hash({key: plan[key] for key in ("operation", "requestedProfile", "modules", "regions", "cameras", "landmarks")})
    return plan


def build_cache_key(
    *,
    source_sha256: str,
    requested_profile: str,
    configuration: dict[str, Any] | None = None,
    detector_version: str | None = None,
    module: str | None = None,
    module_version: str | None = None,
    camera_rig_version: str = CAMERA_RIG_VERSION,
) -> str:
    selected_module = module or "analysis"
    return stable_hash({
        "sourceSha256": source_sha256,
        "analyzerVersion": ANALYZER_VERSION,
        "mapVersion": MAP_VERSION,
        "cacheContractVersion": CACHE_CONTRACT_VERSION,
        "module": selected_module,
        "moduleVersion": module_version or MODULE_VERSIONS.get(selected_module, "4.2.0"),
        "configurationHash": stable_hash(configuration or {}),
        "cameraRigVersion": camera_rig_version,
        "detectorVersion": detector_version or "unknown",
        "requestedProfile": canonical_profile(requested_profile),
    })


def warning_module(item: dict[str, Any]) -> str:
    explicit = str(item.get("module") or "")
    if explicit in MODULE_VERSIONS:
        return explicit
    landmark = item.get("landmark") or item.get("name")
    if landmark:
        return module_for_landmark(str(landmark))
    side = str(item.get("side") or "")
    if side == "left":
        return "left_hand"
    if side == "right":
        return "right_hand"
    region = str(item.get("region") or item.get("failureStage") or "")
    if region in {"face", "head", "eyes"}:
        return "face"
    if "hand_l" in region:
        return "left_hand"
    if "hand_r" in region:
        return "right_hand"
    return "body"


def warning_fingerprint(item: dict[str, Any]) -> str:
    payload = {
        "code": str(item.get("code") or item.get("failureCode") or "UNKNOWN"),
        "landmark": str(item.get("landmark") or item.get("name") or ""),
        "module": warning_module(item),
        "camera": str(item.get("camera") or item.get("camera_id") or item.get("cameraId") or item.get("view") or ""),
        "position2d": item.get("position2d") or item.get("position2D") or [item.get("x"), item.get("y")],
        "expectedRegion": item.get("expectedRegion") or item.get("expected_region"),
        "actualRegion": item.get("actualRegion") or item.get("actual_region") or item.get("surfaceRegion"),
        "triangleId": item.get("triangleId") or item.get("triangle_id"),
        "sourceVersion": item.get("sourceVersion") or item.get("version"),
    }
    return stable_hash(payload)


def dedupe_warnings(items: Iterable[dict[str, Any]], previous_fingerprints: set[str] | None = None) -> list[dict[str, Any]]:
    previous_fingerprints = previous_fingerprints or set()
    grouped: dict[str, dict[str, Any]] = {}
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        item = deepcopy(raw)
        fingerprint = warning_fingerprint(item)
        item["fingerprint"] = fingerprint
        item["module"] = warning_module(item)
        item["same_root_cause_repeated"] = fingerprint in previous_fingerprints
        view = item.get("view") or item.get("camera") or item.get("camera_id")
        if fingerprint not in grouped:
            item["occurrences"] = int(item.get("occurrences") or 1)
            item["evidence"] = list(item.get("evidence") or [])
            if view:
                item.setdefault("cameras", []).append(str(view))
            grouped[fingerprint] = item
            continue
        current = grouped[fingerprint]
        current["occurrences"] = int(current.get("occurrences") or 1) + int(item.get("occurrences") or 1)
        cameras = current.setdefault("cameras", [])
        if view and str(view) not in cameras:
            cameras.append(str(view))
        evidence = current.setdefault("evidence", [])
        if len(evidence) < 30:
            evidence.append({key: value for key, value in item.items() if key not in {"message", "evidence"}})
        current["same_root_cause_repeated"] = bool(current.get("same_root_cause_repeated") or item["same_root_cause_repeated"])
    return list(grouped.values())


def merge_incremental_analysis(
    previous: dict[str, Any],
    module_results: dict[str, dict[str, Any]],
    plan: dict[str, Any],
) -> dict[str, Any]:
    analysis = deepcopy(previous)
    previous_warnings = [item for item in analysis.get("warnings") or [] if isinstance(item, dict)]
    previous_fingerprints = {str(item.get("fingerprint") or warning_fingerprint(item)) for item in previous_warnings}
    replace_modules = set(plan.get("replaceModules") or plan.get("modules") or [])
    preserved_warnings = [item for item in previous_warnings if warning_module(item) not in replace_modules]
    landmarks = dict(analysis.get("landmarks") or {})
    replace_landmarks = set(plan.get("replaceLandmarks") or [])
    new_warnings: list[dict[str, Any]] = []
    modules = dict(analysis.get("modules") or {})

    for module, result in module_results.items():
        if module not in replace_modules:
            continue
        result_landmarks = result.get("landmarks") if isinstance(result.get("landmarks"), dict) else {}
        if replace_landmarks:
            for name in replace_landmarks:
                if name in result_landmarks:
                    landmarks[name] = deepcopy(result_landmarks[name])
        else:
            for name, record in result_landmarks.items():
                landmarks[name] = deepcopy(record)
        for warning in result.get("warnings") or []:
            if isinstance(warning, dict):
                new_warnings.append({**warning, "module": module})
        modules[module] = deepcopy(result.get("manifest") or {
            "module": module,
            "version": MODULE_VERSIONS.get(module),
            "status": result.get("status") or "completed",
        })
        for key in ("faceAnalysis", "leftHandAnalysis", "rightHandAnalysis", "bodyAnalysis", "bodySubsystems", "detectionCoverage", "measurements", "bodyMeasurements"):
            if key in result:
                analysis[key] = deepcopy(result[key])

    analysis["landmarks"] = landmarks
    analysis["warnings"] = dedupe_warnings([*preserved_warnings, *new_warnings], previous_fingerprints)
    analysis["modules"] = modules
    analysis["incrementalPlan"] = deepcopy(plan)
    analysis["modulesExecuted"] = sorted(module_results)
    analysis["modulesReused"] = sorted(set(modules).difference(module_results))
    return analysis


def write_module_result(root: Path, module: str, result: dict[str, Any], manifest: dict[str, Any]) -> None:
    directory = Path(root) / "modules" / module
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
