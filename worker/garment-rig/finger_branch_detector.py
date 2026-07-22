"""Assign geometry-first hand branches to anatomical finger names."""
from __future__ import annotations

from itertools import permutations
from typing import Dict, List

from mathutils import Vector

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _position(item: dict | None):
    if not item:
        return None
    value = item.get("internalJointPosition") or item.get("position")
    if not value:
        return None
    return Vector(tuple(float(component) for component in value))


def _reference(landmarks: Dict[str, dict], finger: str, suffix: str):
    for name in (f"{finger}_tip_{suffix}", f"{finger}_03_{suffix}", f"{finger}_01_{suffix}"):
        item = landmarks.get(name)
        if item and item.get("accepted", False):
            return _position(item), name, float(item.get("confidence", 0.0))
    return None, None, 0.0


def _frame(measurement: dict):
    origin = Vector(tuple(measurement.get("origin") or (0.0, 0.0, 0.0)))
    forward = Vector(tuple(measurement.get("forward") or (0.0, 0.0, -1.0)))
    lateral = Vector(tuple(measurement.get("lateral") or (1.0, 0.0, 0.0)))
    if forward.length <= 1e-8:
        forward = Vector((0.0, 0.0, -1.0))
    if lateral.length <= 1e-8:
        lateral = Vector((1.0, 0.0, 0.0))
    forward.normalize(); lateral.normalize()
    return origin, forward, lateral


def assign_finger_branches(branches: List, landmarks: Dict[str, dict], measurement: dict, side: str):
    suffix = "l" if side == "left" else "r"
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    origin, forward, lateral = _frame(measurement)
    references = {finger: _reference(landmarks, finger, suffix) for finger in FINGERS}
    reference_count = sum(1 for point, _name, _confidence in references.values() if point is not None)
    warnings = []
    if not branches:
        return {}, {
            "status": "needs_review", "mappingConfidence": 0.0,
            "warnings": [{"code": "NO_GEOMETRIC_FINGER_BRANCHES", "side": side}],
        }

    selected = branches[:5]
    mapping = {}
    if len(selected) == 5 and reference_count >= 3:
        best = None
        for permutation in permutations(selected, 5):
            cost = 0.0
            evidence = 0.0
            for finger, branch in zip(FINGERS, permutation):
                point, _name, confidence = references[finger]
                if point is not None:
                    cost += (branch.endpoint - point).length / hand_scale * (0.65 + confidence * 0.35)
                    evidence += 1.0
                direction = branch.endpoint - origin
                if direction.length > 1e-8:
                    direction.normalize()
                if finger == "thumb":
                    # Thumb should diverge laterally from the forward finger fan.
                    cost += max(0.0, direction.dot(forward) - 0.88) * 0.55
                elif direction.dot(forward) < 0.25:
                    cost += 0.55
            normalized = cost / max(evidence, 1.0)
            if best is None or normalized < best[0]:
                best = (normalized, permutation)
        cost, permutation = best
        mapping = {finger: branch for finger, branch in zip(FINGERS, permutation)}
        mapping_confidence = max(0.0, min(1.0, 1.0 - cost / 1.35))
        method = "mediapipe-reference-to-geodesic-branch-assignment"
    else:
        # Geometry-only fallback. It is useful for retaining branches but cannot
        # silently claim full semantic certainty.
        vectors = []
        for branch in selected:
            delta = branch.endpoint - origin
            direction = delta.normalized() if delta.length > 1e-8 else forward.copy()
            vectors.append((branch, direction.dot(forward), delta.dot(lateral)))
        thumb_entry = min(vectors, key=lambda item: item[1])
        remaining = [item for item in vectors if item[0] is not thumb_entry[0]]
        remaining.sort(key=lambda item: item[2], reverse=True)
        mapping["thumb"] = thumb_entry[0]
        for finger, entry in zip(("index", "middle", "ring", "pinky"), remaining):
            mapping[finger] = entry[0]
        mapping_confidence = min(0.54, sum(branch.confidence for branch in selected) / max(len(selected), 1) * 0.62)
        method = "geometry-only-lateral-order-fallback"
        warnings.append({
            "code": "FINGER_BRANCH_LABELS_REQUIRE_VISUAL_CONFIRMATION",
            "side": side, "visualReferenceCount": reference_count,
        })

    if len(mapping) != 5:
        warnings.append({
            "code": "FINGER_BRANCH_COUNT_INSUFFICIENT",
            "side": side, "branchCount": len(selected), "mappedCount": len(mapping),
        })
    return mapping, {
        "status": "valid" if len(mapping) == 5 and mapping_confidence >= 0.68 and not warnings else "needs_review",
        "mappingConfidence": float(mapping_confidence),
        "visualReferenceCount": reference_count,
        "method": method,
        "assignments": {
            finger: {
                "branchId": branch.branch_id,
                "endpoint": [float(branch.endpoint.x), float(branch.endpoint.y), float(branch.endpoint.z)],
                "branchConfidence": float(branch.confidence),
            }
            for finger, branch in mapping.items()
        },
        "warnings": warnings,
    }
