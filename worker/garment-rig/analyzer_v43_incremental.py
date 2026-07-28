"""Profile-aware execution plan refinements for Avatar Analyzer V4.2.2."""
from __future__ import annotations

from typing import Any

from analyzer_v42_incremental import *  # noqa: F401,F403
from analyzer_v42_incremental import build_incremental_plan as _build_incremental_plan


FULL_FINGER_PROFILES = {"FULL_HUMANOID", "FULL_BODY_HANDS_FACE"}
HAND_MODULES = {"left_hand", "right_hand"}


def _explicit_full_hand_request(
    operation: str,
    profile: str,
    landmark: str | None,
    camera_id: str | None,
    region: str | None,
) -> bool:
    if operation == "reanalyze_landmark" and landmark:
        module = module_for_landmark(landmark)
        return module in HAND_MODULES and not str(landmark).startswith(("wrist_", "palm_", "hand_"))
    if operation == "reanalyze_camera" and camera_id:
        return str(camera_id).startswith(("hand_l_", "hand_r_"))
    if operation == "reanalyze_region" and region:
        module = module_for_region(region)
        return module in HAND_MODULES and str(region).startswith(tuple(FINGERS))
    if operation in {"reanalyze_left_hand", "reanalyze_right_hand"}:
        return profile != "BODY_HANDS_BASIC"
    return False


def build_incremental_plan(
    operation: str | None,
    *,
    requested_profile: str | None = None,
    landmark: str | None = None,
    camera_id: str | None = None,
    region: str | None = None,
) -> dict[str, Any]:
    plan = _build_incremental_plan(
        operation,
        requested_profile=requested_profile,
        landmark=landmark,
        camera_id=camera_id,
        region=region,
    )
    profile = canonical_profile(plan.get("requestedProfile"))
    operation_name = str(operation or "initial")
    full_fingers = (
        profile in FULL_FINGER_PROFILES
        or _explicit_full_hand_request(
            operation_name,
            profile,
            landmark,
            camera_id,
            region,
        )
    )
    hand_modules = [module for module in plan.get("modules") or [] if module in HAND_MODULES]
    plan["moduleOptions"] = {
        module: {
            "detail": "full_fingers" if full_fingers else "base_only",
            "includeFingers": full_fingers,
            "requiresVisualEvidence": full_fingers,
            "explicitEvidenceRequest": full_fingers and profile not in FULL_FINGER_PROFILES,
        }
        for module in hand_modules
    }
    if hand_modules and not full_fingers:
        plan["cameras"] = [
            camera for camera in plan.get("cameras") or []
            if not str(camera).startswith(("hand_l_", "hand_r_"))
        ]
        plan["landmarks"] = [
            name for name in plan.get("landmarks") or []
            if str(name).startswith(("wrist_", "palm_", "hand_"))
        ]
        plan["replaceLandmarks"] = list(plan["landmarks"])
    plan["planHash"] = stable_hash({
        key: plan.get(key)
        for key in (
            "operation", "requestedProfile", "modules", "regions", "cameras",
            "landmarks", "moduleOptions",
        )
    })
    return plan


__all__ = [
    *[name for name in globals() if name.isupper()],
    "build_incremental_plan",
    "canonical_profile",
    "modules_for_profile",
    "module_for_landmark",
    "module_for_region",
    "build_cache_key",
    "merge_incremental_analysis",
    "dedupe_warnings",
    "warning_fingerprint",
    "root_cause_fingerprint",
    "stable_hash",
    "write_module_result",
]
