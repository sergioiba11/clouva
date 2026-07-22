"""Hand and finger analysis from MediaPipe candidates projected onto the mesh."""
from __future__ import annotations

from itertools import combinations
from typing import Dict, List, Tuple

from mathutils import Vector

from landmark_fusion import apply_anatomical_confidence, fuse_projected
from landmark_projector_3d import project_candidates

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _point(item: dict):
    return Vector(tuple(float(value) for value in item["position"]))


def _hide(landmarks: Dict[str, dict], names: List[str], reason: str):
    for name in names:
        item = landmarks.get(name)
        if not item:
            continue
        item["verified"] = False
        item["display"] = False
        item.setdefault("rejectionReasons", []).append(reason)
        apply_anatomical_confidence(item, 0.12)


def _chain_names(finger: str, suffix: str):
    return [
        f"{finger}_01_{suffix}",
        f"{finger}_02_{suffix}",
        f"{finger}_03_{suffix}",
        f"{finger}_tip_{suffix}",
    ]


def _validate_chain(landmarks: Dict[str, dict], finger: str, suffix: str,
                    hand_scale: float) -> Tuple[bool, List[dict]]:
    warnings: List[dict] = []
    wrist_name = f"wrist_{suffix}"
    names = _chain_names(finger, suffix)
    required = [wrist_name, *names]
    missing = [name for name in required if name not in landmarks]
    if missing:
        warnings.append({
            "code": "FINGER_CHAIN_INCOMPLETE",
            "finger": finger,
            "side": suffix,
            "missing": missing,
        })
        _hide(landmarks, names, "FINGER_CHAIN_INCOMPLETE")
        return False, warnings

    items = [landmarks[name] for name in required]
    unverified = [name for name, item in zip(required, items) if not item.get("verified", False)]
    insufficient_views = [
        name for name, item in zip(required, items)
        if int(item.get("viewsConfirmed", 0)) < 2
    ]
    if unverified or insufficient_views:
        warnings.append({
            "code": "FINGER_CHAIN_NOT_MULTIVIEW_VERIFIED",
            "finger": finger,
            "side": suffix,
            "unverified": unverified,
            "insufficientViews": insufficient_views,
        })
        _hide(landmarks, names, "FINGER_CHAIN_NOT_MULTIVIEW_VERIFIED")
        return False, warnings

    wrist = _point(landmarks[wrist_name])
    points = [_point(landmarks[name]) for name in names]
    segments = [(points[index + 1] - points[index]).length for index in range(3)]
    wrist_distances = [(point - wrist).length for point in points]
    minimum_segment = hand_scale * 0.055
    maximum_segment = hand_scale * 0.48
    strictly_outward = all(
        wrist_distances[index + 1] - wrist_distances[index] >= hand_scale * 0.025
        for index in range(3)
    )
    segment_sizes_valid = all(minimum_segment <= length <= maximum_segment for length in segments)
    total_valid = sum(segments) <= hand_scale * 1.25

    direction_consistency = True
    directions = []
    for index in range(3):
        direction = points[index + 1] - points[index]
        if direction.length > 1e-8:
            direction.normalize()
        directions.append(direction)
    for first, second in zip(directions, directions[1:]):
        if first.length > 1e-8 and second.length > 1e-8 and first.dot(second) < -0.15:
            direction_consistency = False

    hit_objects = {
        hit
        for name in required
        for hit in landmarks[name].get("hitObjects", [])
        if hit
    }
    same_surface = len(hit_objects) <= 1
    valid = segment_sizes_valid and total_valid and strictly_outward and direction_consistency and same_surface
    if not valid:
        warnings.append({
            "code": "FINGER_CHAIN_GEOMETRY_INVALID",
            "finger": finger,
            "side": suffix,
            "segmentLengths": segments,
            "wristDistances": wrist_distances,
            "strictlyOutward": strictly_outward,
            "directionConsistent": direction_consistency,
            "sameSurface": same_surface,
        })
        _hide(landmarks, names, "FINGER_CHAIN_GEOMETRY_INVALID")
        return False, warnings

    for name in names:
        landmarks[name]["landmarkType"] = "surface"
        landmarks[name]["display"] = True
        apply_anatomical_confidence(landmarks[name], 0.90)
    return True, warnings


def _invalidate_close_pairs(landmarks: Dict[str, dict], names: List[str], threshold: float,
                            code: str, suffix: str):
    warnings = []
    for first, second in combinations(names, 2):
        if first not in landmarks or second not in landmarks:
            continue
        distance = (_point(landmarks[first]) - _point(landmarks[second])).length
        if distance < threshold:
            warnings.append({
                "code": code,
                "side": suffix,
                "landmarks": [first, second],
                "distance": distance,
            })
            _hide(landmarks, [first, second], code)
    return warnings


def _derive_palm_and_metacarpals(landmarks: Dict[str, dict], suffix: str,
                                 valid_fingers: Dict[str, bool]):
    wrist_name = f"wrist_{suffix}"
    base_names = [f"{finger}_01_{suffix}" for finger in ("index", "middle", "ring", "pinky")]
    if wrist_name not in landmarks or not all(name in landmarks for name in base_names):
        return [{"code": "PALM_GEOMETRY_INSUFFICIENT", "side": suffix}]

    wrist = _point(landmarks[wrist_name])
    bases = [_point(landmarks[name]) for name in base_names]
    palm = (wrist + sum(bases, Vector((0.0, 0.0, 0.0)))) / 5.0
    a = bases[0] - wrist
    b = bases[-1] - wrist
    normal = a.cross(b)
    if normal.length > 1e-8:
        normal.normalize()
    base_confidence = min(float(landmarks[name].get("confidence", 0.0)) for name in [wrist_name, *base_names])
    palm_name = f"palm_{suffix}"
    palm_verified = all(valid_fingers.get(finger, False) for finger in ("index", "middle", "ring", "pinky"))
    landmarks[palm_name] = {
        "position": _vec(palm),
        "palmNormal": _vec(normal),
        "confidence": base_confidence * 0.90 if palm_verified else min(base_confidence, 0.35),
        "visualConfidence": base_confidence,
        "geometryConfidence": base_confidence,
        "multiviewConfidence": min(
            1.0,
            sum(int(landmarks[name].get("viewsConfirmed", 0)) for name in base_names) / 8.0,
        ),
        "anatomicalConfidence": 0.90 if palm_verified else 0.25,
        "finalConfidence": base_confidence * 0.90 if palm_verified else min(base_confidence, 0.35),
        "viewsConfirmed": min(int(landmarks[name].get("viewsConfirmed", 0)) for name in base_names),
        "method": "verified-palm-base-centroid-v2",
        "verified": palm_verified,
        "display": palm_verified,
        "landmarkType": "surface",
    }

    # Keep metacarpal names in the JSON contract without drawing duplicate balls.
    # MediaPipe provides the MCP as *_01; the extra metacarpal point is derived
    # internally between palm and MCP and must not be presented as another hit.
    for finger in FINGERS:
        base_name = f"{finger}_01_{suffix}"
        if base_name not in landmarks:
            continue
        base = _point(landmarks[base_name])
        name = f"{finger}_metacarpal_{suffix}"
        verified = bool(valid_fingers.get(finger, False) and palm_verified)
        confidence = min(
            float(landmarks[base_name].get("confidence", 0.0)),
            float(landmarks[palm_name].get("confidence", 0.0)),
        ) * 0.82
        landmarks[name] = {
            "position": _vec(palm.lerp(base, 0.62)),
            "confidence": confidence if verified else min(confidence, 0.35),
            "visualConfidence": 0.0,
            "geometryConfidence": confidence,
            "multiviewConfidence": float(landmarks[base_name].get("multiviewConfidence", 0.0)),
            "anatomicalConfidence": 0.82 if verified else 0.20,
            "finalConfidence": confidence if verified else min(confidence, 0.35),
            "viewsConfirmed": int(landmarks[base_name].get("viewsConfirmed", 0)),
            "method": "derived-palm-to-mcp-internal-v2",
            "verified": verified,
            "display": False,
            "landmarkType": "derived_internal",
            "aliasOf": base_name,
        }
    return []


def _validate_side(landmarks: Dict[str, dict], suffix: str, hand_scale: float):
    warnings: List[dict] = []
    valid_by_finger: Dict[str, bool] = {}
    for finger in FINGERS:
        valid, chain_warnings = _validate_chain(landmarks, finger, suffix, hand_scale)
        valid_by_finger[finger] = valid
        warnings.extend(chain_warnings)

    base_names = [f"{finger}_01_{suffix}" for finger in ("index", "middle", "ring", "pinky")]
    tip_names = [f"{finger}_tip_{suffix}" for finger in FINGERS]
    warnings.extend(_invalidate_close_pairs(
        landmarks, base_names, hand_scale * 0.045, "FINGER_ROOTS_OVERLAP", suffix,
    ))
    warnings.extend(_invalidate_close_pairs(
        landmarks, tip_names, hand_scale * 0.055, "FINGER_TIPS_OVERLAP", suffix,
    ))

    for finger in FINGERS:
        if any(not landmarks.get(name, {}).get("display", False) for name in _chain_names(finger, suffix)):
            valid_by_finger[finger] = False

    warnings.extend(_derive_palm_and_metacarpals(landmarks, suffix, valid_by_finger))
    valid_fingers = sum(1 for value in valid_by_finger.values() if value)
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
    hand_scale = max(body_height * 0.105, 1e-5)

    for side, suffix in (("left", "l"), ("right", "r")):
        side_projected = [item for item in projected if item.get("side") == side]
        landmarks = fuse_projected(
            side_projected,
            hand_scale,
            minimum_views=2,
            tolerance_ratio=0.085,
        )
        # Old v1 emitted metacarpal and *_01 at the same MediaPipe index.
        # Remove those aliases before validation; v2 derives hidden internal ones.
        for name in list(landmarks):
            if "_metacarpal_" in name:
                landmarks.pop(name, None)

        valid_fingers, warnings = _validate_side(landmarks, suffix, hand_scale)
        low_or_hidden = [
            name for name, item in landmarks.items()
            if item.get("landmarkType") == "surface"
            and (float(item.get("confidence", 0.0)) < 0.65 or not item.get("display", False))
        ]
        if valid_fingers < 5 or warnings or low_or_hidden:
            status = "needs_review"
            warnings.append({
                "code": f"{side.upper()}_HAND_NOT_VERIFIED",
                "message": f"La mano {side} no tiene cinco cadenas únicas y verificadas sobre la malla.",
                "validFingers": valid_fingers,
                "lowOrHidden": sorted(set(low_or_hidden)),
            })
        else:
            status = "valid"

        result[side] = {
            "status": status,
            "landmarks": landmarks,
            "validFingers": valid_fingers,
            "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
            "warnings": warnings,
            "projectedCandidates": side_projected,
            "method": "mediapipe-hand-landmarker-plus-mesh-raycast-v2-strict",
        }
        all_warnings.extend(warnings)

    return {
        "left": result.get("left", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "right": result.get("right", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "warnings": all_warnings,
        "projectedCandidates": projected,
    }
