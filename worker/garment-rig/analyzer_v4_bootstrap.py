"""Resolve canonical camera anchors before optional V4 visual analysis."""
from __future__ import annotations

from typing import Any


VECTOR_ALIASES = {
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

REQUIRED_CAMERA_VECTORS = (
    "pelvis", "chest", "neck", "skull_base", "head_top",
    "wrist_l", "hand_l", "wrist_r", "hand_r",
)


def _triplet(value: Any):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    try:
        result = [float(component) for component in value]
    except (TypeError, ValueError):
        return None
    if not all(component == component and abs(component) != float("inf") for component in result):
        return None
    return result


def resolve_camera_vector_values(analysis: dict[str, Any]):
    """Prefer landmark geometry, then canonical body-refinement evidence.

    Face/hand analysis can replace a rejected wrist record with an evidence-only
    object that has no position. The body solver's refined canonical vector is
    still valid for framing a retry camera and must not be discarded.
    """
    landmarks = analysis.get("landmarks") if isinstance(analysis.get("landmarks"), dict) else {}
    segmentation = analysis.get("segmentation") if isinstance(analysis.get("segmentation"), dict) else {}
    refined = segmentation.get("refinedVectors") if isinstance(segmentation.get("refinedVectors"), dict) else {}
    body_diagnostics = ((analysis.get("diagnostics") or {}).get("body") or {})
    body_refined = (
        body_diagnostics.get("refinedBodyVectors")
        if isinstance(body_diagnostics.get("refinedBodyVectors"), dict)
        else {}
    )

    values: dict[str, list[float]] = {}
    sources: dict[str, str] = {}
    for target, source in VECTOR_ALIASES.items():
        record = landmarks.get(source)
        value = None
        if isinstance(record, dict):
            value = _triplet(record.get("internalJointPosition")) or _triplet(record.get("position"))
        if value is not None:
            sources[target] = f"landmarks.{source}"
        else:
            value = _triplet(refined.get(source)) or _triplet(refined.get(target))
            if value is not None:
                sources[target] = f"segmentation.refinedVectors.{source}"
        if value is None:
            value = _triplet(body_refined.get(source)) or _triplet(body_refined.get(target))
            if value is not None:
                sources[target] = f"diagnostics.body.refinedBodyVectors.{source}"
        if value is not None:
            values[target] = value

    missing = [name for name in REQUIRED_CAMERA_VECTORS if name not in values]
    fallback_names = sorted(
        name for name, source in sources.items()
        if not source.startswith("landmarks.")
    )
    return values, {
        "version": "clouva-v4.1-camera-bootstrap-1",
        "sources": sources,
        "fallbackVectors": fallback_names,
        "missing": missing,
        "ready": not missing,
    }
