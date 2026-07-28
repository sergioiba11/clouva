"""Profile-aware execution plan refinements for Avatar Analyzer V4.2.1."""
from __future__ import annotations

from typing import Any

from analyzer_v42_incremental import *  # noqa: F401,F403
from analyzer_v42_incremental import build_incremental_plan as _build_incremental_plan


FULL_FINGER_PROFILES = {"FULL_HUMANOID", "FULL_BODY_HANDS_FACE"}


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
    full_fingers = profile in FULL_FINGER_PROFILES
    hand_modules = [module for module in plan.get("modules") or [] if module in {"left_hand", "right_hand"}]
    plan["moduleOptions"] = {
        module: {
            "detail": "full_fingers" if full_fingers else "base_only",
            "includeFingers": full_fingers,
            "requiresVisualEvidence": full_fingers,
        }
        for module in hand_modules
    }
    if hand_modules and not full_fingers:
        # Geometry-only base hand analysis needs no MediaPipe hand camera pass.
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
