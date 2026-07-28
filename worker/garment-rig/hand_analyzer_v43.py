"""Profile-aware hand analyzer dispatch for Avatar Analyzer V4.2.1."""
from __future__ import annotations

from hand_analyzer_v42 import analyze_hand_module_v42 as _analyze_full_hand
from hand_base_analyzer_v42 import analyze_hand_base_module_v42

_INCLUDE_FINGERS = True


def set_hand_detail(include_fingers: bool):
    global _INCLUDE_FINGERS
    _INCLUDE_FINGERS = bool(include_fingers)


def analyze_hand_module_v42(
    detector_output,
    manifest,
    classifications,
    segmentation,
    meshes,
    anatomy_bvh,
    side,
    *,
    requested_landmarks=None,
):
    if not _INCLUDE_FINGERS:
        return analyze_hand_base_module_v42(segmentation, anatomy_bvh, side), anatomy_bvh
    return _analyze_full_hand(
        detector_output,
        manifest,
        classifications,
        segmentation,
        meshes,
        anatomy_bvh,
        side,
        requested_landmarks=requested_landmarks,
    )


__all__ = ["analyze_hand_module_v42", "set_hand_detail"]
