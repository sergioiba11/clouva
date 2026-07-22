"""Hand and finger analysis from MediaPipe candidates projected onto the mesh."""
from __future__ import annotations

from typing import Dict

from mathutils import Vector

from landmark_fusion import apply_anatomical_confidence, fuse_projected
from landmark_projector_3d import project_candidates

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _point(item: dict):
    return Vector(tuple(float(value) for value in item["position"]))


def _validate_side(landmarks: Dict[str, dict], suffix: str, scale: float):
    warnings = []
    valid_fingers = 0
    for finger in FINGERS:
        names = [
            f"{finger}_01_{suffix}",
            f"{finger}_02_{suffix}",
            f"{finger}_03_{suffix}",
            f"{finger}_tip_{suffix}",
        ]
        if not all(name in landmarks for name in names):
            warnings.append({"code": "FINGER_CHAIN_INCOMPLETE", "finger": finger, "side": suffix})
            continue
        points = [_point(landmarks[name]) for name in names]
        lengths = [(points[index + 1] - points[index]).length for index in range(3)]
        ordered = all(length > scale * 0.008 for length in lengths)
        total = sum(lengths)
        if not ordered or total > scale * 0.95:
            warnings.append({
                "code": "FINGER_CHAIN_GEOMETRY_INVALID",
                "finger": finger,
                "side": suffix,
                "segmentLengths": lengths,
            })
            for name in names:
                apply_anatomical_confidence(landmarks[name], 0.25)
            continue
        for name in names:
            apply_anatomical_confidence(landmarks[name], 0.88)
        valid_fingers += 1

    wrist_name = f"wrist_{suffix}"
    bases = [f"{finger}_01_{suffix}" for finger in ("index", "middle", "ring", "pinky")]
    if wrist_name in landmarks and all(name in landmarks for name in bases):
        points = [_point(landmarks[wrist_name]), *[_point(landmarks[name]) for name in bases]]
        palm = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
        palm_name = f"palm_{suffix}"
        base_confidence = min(landmarks[name]["confidence"] for name in [wrist_name, *bases])
        a = _point(landmarks[bases[0]]) - _point(landmarks[wrist_name])
        b = _point(landmarks[bases[-1]]) - _point(landmarks[wrist_name])
        normal = a.cross(b)
        if normal.length > 1e-8:
            normal.normalize()
        landmarks[palm_name] = {
            "position": _vec(palm),
            "palmNormal": _vec(normal),
            "confidence": base_confidence * 0.92,
            "visualConfidence": base_confidence,
            "geometryConfidence": base_confidence,
            "multiviewConfidence": min(1.0, sum(landmarks[name].get("viewsConfirmed", 1) for name in bases) / 8.0),
            "anatomicalConfidence": 0.88,
            "finalConfidence": base_confidence * 0.92,
            "viewsConfirmed": min(landmarks[name].get("viewsConfirmed", 1) for name in bases),
            "method": "projected-palm-base-centroid-v1",
        }
    else:
        warnings.append({"code": "PALM_GEOMETRY_INSUFFICIENT", "side": suffix})

    return valid_fingers, warnings


def analyze_hands(detector_output: dict, manifest: dict, classifications: Dict[str, str],
                  body_height: float):
    hand_views = {
        **detector_output,
        "views": [item for item in detector_output.get("views", []) if item.get("region") == "hand"],
    }
    projected, projection_failures = project_candidates(hand_views, manifest, classifications)
    result = {}
    all_warnings = list(projection_failures)

    for side, suffix in (("left", "l"), ("right", "r")):
        side_projected = [item for item in projected if item.get("side") == side]
        landmarks = fuse_projected(
            side_projected,
            max(body_height * 0.105, 1e-5),
            minimum_views=2,
            tolerance_ratio=0.12,
        )
        valid_fingers, warnings = _validate_side(landmarks, suffix, body_height * 0.105)
        missing_tips = [f"{finger}_tip_{suffix}" for finger in FINGERS if f"{finger}_tip_{suffix}" not in landmarks]
        low = [name for name, item in landmarks.items() if float(item.get("confidence", 0.0)) < 0.40]
        if valid_fingers < 5 or missing_tips:
            status = "needs_review"
            warnings.append({
                "code": f"{side.upper()}_FINGERS_GEOMETRY_INSUFFICIENT",
                "message": f"No se verificaron las cinco cadenas de dedos de la mano {side}.",
                "validFingers": valid_fingers,
                "missingTips": missing_tips,
            })
        elif low:
            status = "valid_with_warnings"
            warnings.append({"code": "HAND_LANDMARKS_LOW_CONFIDENCE", "side": side, "landmarks": low})
        else:
            status = "valid"
        result[side] = {
            "status": status,
            "landmarks": landmarks,
            "validFingers": valid_fingers,
            "warnings": warnings,
            "projectedCandidates": side_projected,
            "method": "mediapipe-hand-landmarker-plus-mesh-raycast-v1",
        }
        all_warnings.extend(warnings)

    return {
        "left": result.get("left", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "right": result.get("right", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "warnings": all_warnings,
        "projectedCandidates": projected,
    }
