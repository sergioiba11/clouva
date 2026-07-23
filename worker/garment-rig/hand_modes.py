"""Deterministic hand capability classification for Analyzer V4.1."""
from __future__ import annotations

from typing import Any

HAND_MODES = {
    "five_finger_separated",
    "five_finger_connected",
    "partial_fingers",
    "simplified_mitten",
    "unsupported_or_corrupt",
}


def classify_hand_mode(evidence: dict[str, Any]) -> dict[str, Any]:
    vertices = max(0, int(evidence.get("vertex_count") or 0))
    components = max(0, int(evidence.get("connected_components") or 0))
    branches = max(0, int(evidence.get("geodesic_branches") or 0))
    visual_tips = max(0, int(evidence.get("visual_fingertips") or 0))
    valleys = max(0, int(evidence.get("silhouette_valleys") or 0))
    corrupt = bool(evidence.get("corrupt_geometry")) or vertices < 4
    distal_signal = max(branches, visual_tips, min(5, valleys + 1 if valleys else 0))

    if corrupt or components == 0:
        mode = "unsupported_or_corrupt"
        confidence = 0.0
        reason = "corrupt_or_empty_hand_geometry"
    elif distal_signal >= 5:
        separated = components >= 5 or (branches >= 5 and components > 1)
        mode = "five_finger_separated" if separated else "five_finger_connected"
        confidence = min(0.98, 0.58 + 0.06 * min(branches, 5) + 0.02 * min(visual_tips, 5))
        reason = "five_distal_corridors_with_separate_components" if separated else "five_distal_corridors_share_connected_palm"
    elif distal_signal >= 2:
        mode = "partial_fingers"
        confidence = min(0.88, 0.48 + 0.08 * distal_signal)
        reason = "some_but_not_five_distal_corridors"
    else:
        mode = "simplified_mitten"
        confidence = 0.82 if visual_tips <= 1 and branches <= 1 else 0.62
        reason = "hand_volume_without_reliable_finger_corridors"

    return {
        "mode": mode,
        "confidence": float(confidence),
        "reason": reason,
        "fingerRigMode": (
            "full"
            if mode in {"five_finger_separated", "five_finger_connected"}
            else "partial"
            if mode == "partial_fingers"
            else "simplified"
            if mode == "simplified_mitten"
            else "unsupported"
        ),
        "handBaseSupported": mode != "unsupported_or_corrupt",
        "fullFingerRigSupported": mode in {"five_finger_separated", "five_finger_connected"},
        "requiresGeometryRecovery": bool(visual_tips >= 5 and branches < 5),
        "evidence": {
            "vertexCount": vertices,
            "connectedComponents": components,
            "geodesicBranches": branches,
            "visualFingertips": visual_tips,
            "silhouetteValleys": valleys,
        },
    }
