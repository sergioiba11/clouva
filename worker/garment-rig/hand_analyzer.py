"""Hand analysis using anatomical segmentation and robust ray triangulation."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from mathutils import Vector

from finger_centerline import FINGERS, refine_hand_landmarks
from landmark_projector_3d import project_candidates
from ray_triangulator import triangulate_landmark


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _internal(item: dict):
    value = item.get("internalJointPosition") or item.get("position")
    return Vector(tuple(float(component) for component in value))


def _group(projected: List[dict]):
    grouped = defaultdict(list)
    for candidate in projected:
        name = str(candidate.get("name") or "")
        if name:
            grouped[name].append(candidate)
    return grouped


def _derive_palm_and_metacarpals(landmarks: Dict[str, dict], segmentation, side: str):
    suffix = "l" if side == "left" else "r"
    wrist_name = f"wrist_{suffix}"
    base_names = [f"{finger}_01_{suffix}" for finger in ("index", "middle", "ring", "pinky")]
    if not all(name in landmarks and landmarks[name].get("accepted", False) for name in [wrist_name, *base_names]):
        return [{"code": "PALM_GEOMETRY_INSUFFICIENT", "side": side}]
    wrist = _internal(landmarks[wrist_name])
    bases = [_internal(landmarks[name]) for name in base_names]
    palm = (wrist + sum(bases, Vector((0.0, 0.0, 0.0)))) / 5.0
    surface, distance = segmentation.nearest(palm, f"hand_{suffix}")
    accepted = surface is not None
    palm_name = f"palm_{suffix}"
    base_confidence = min(float(landmarks[name].get("confidence", 0.0)) for name in [wrist_name, *base_names])
    landmarks[palm_name] = {
        "name": palm_name,
        "position": _vec(palm),
        "internalJointPosition": _vec(palm),
        "surfaceDisplayPosition": _vec(surface.point) if surface else _vec(palm),
        "displayPosition": _vec(surface.point) if surface else _vec(palm),
        "region": f"hand_{suffix}",
        "surfaceRegion": f"hand_{suffix}",
        "landmarkType": "internal_joint",
        "accepted": accepted,
        "verified": accepted,
        "display": accepted,
        "confidence": base_confidence * 0.88 if accepted else min(base_confidence, 0.39),
        "viewsConfirmed": min(int(landmarks[name].get("viewsConfirmed", 0)) for name in base_names),
        "regionDistance": float(distance) if distance != float("inf") else None,
        "methods": ["verified_mcp_centroid", "anatomy_region_surface_anchor"],
        "method": "anatomical-palm-center-v2",
        "rejectionReasons": [] if accepted else ["PALM_OUTSIDE_HAND_REGION"],
    }
    for finger in FINGERS:
        base_name = f"{finger}_01_{suffix}"
        if base_name not in landmarks:
            continue
        base = _internal(landmarks[base_name])
        name = f"{finger}_metacarpal_{suffix}"
        verified = bool(landmarks[base_name].get("accepted", False) and accepted)
        point = palm.lerp(base, 0.62)
        landmarks[name] = {
            "name": name,
            "position": _vec(point),
            "internalJointPosition": _vec(point),
            "region": f"hand_{suffix}",
            "landmarkType": "derived_internal",
            "accepted": verified,
            "verified": verified,
            "display": False,
            "derived": True,
            "aliasOf": base_name,
            "confidence": min(float(landmarks[base_name].get("confidence", 0.0)), base_confidence) * 0.82,
            "viewsConfirmed": int(landmarks[base_name].get("viewsConfirmed", 0)),
            "methods": ["palm_to_mcp_internal_derivation"],
            "method": "derived-metacarpal-internal-v2",
            "rejectionReasons": [] if verified else ["SOURCE_CHAIN_NOT_VERIFIED"],
        }
    return []


def analyze_hands(detector_output: dict, manifest: dict, classifications: Dict[str, str],
                  segmentation):
    hand_views = {
        **detector_output,
        "views": [item for item in detector_output.get("views", []) if item.get("region") == "hand"],
    }
    projected, projection_failures = project_candidates(hand_views, manifest, classifications)
    all_warnings = list(projection_failures)
    result = {}

    for side, suffix in (("left", "l"), ("right", "r")):
        side_projected = [item for item in projected if item.get("side") == side]
        grouped = _group(side_projected)
        measurement = segmentation.hand_measurement(side)
        hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
        landmarks = {}
        expected_names = [
            f"wrist_{suffix}",
            *[
                f"{finger}_{joint}_{suffix}"
                for finger in FINGERS
                for joint in ("01", "02", "03", "tip")
            ],
        ]
        for name in expected_names:
            candidates = grouped.get(name, [])
            allowed_regions = (f"forearm_{suffix}", f"hand_{suffix}") if name.startswith("wrist_") else f"hand_{suffix}"
            preferred = ("palm", "three_quarter_palm") if not name.startswith("wrist_") else ("palm", "dorsum")
            landmarks[name] = triangulate_landmark(
                name,
                candidates,
                segmentation,
                allowed_regions,
                hand_scale,
                minimum_views=2,
                preferred_view_tokens=preferred,
            )

        refined = refine_hand_landmarks(landmarks, segmentation, side)
        landmarks = refined["landmarks"]
        warnings = list(refined.get("warnings") or [])
        warnings.extend(_derive_palm_and_metacarpals(landmarks, segmentation, side))
        valid_fingers = int(refined.get("validFingers") or 0)
        rejected_names = sorted(
            name for name, item in landmarks.items()
            if isinstance(item, dict) and not item.get("accepted", False)
        )
        status = "valid" if valid_fingers == 5 and not rejected_names and not warnings else "needs_review"
        if status != "valid":
            warnings.append({
                "code": f"{side.upper()}_HAND_REQUIRES_REVIEW",
                "validFingers": valid_fingers,
                "rejectedLandmarks": rejected_names,
            })
        result[side] = {
            "status": status,
            "landmarks": landmarks,
            "validFingers": valid_fingers,
            "measurements": refined.get("measurements") or measurement,
            "fingerRegionVertexCounts": refined.get("fingerRegionVertexCounts") or {},
            "triangulatedLandmarks": sum(1 for item in landmarks.values() if item.get("internalJointPosition")),
            "acceptedLandmarks": sum(1 for item in landmarks.values() if item.get("accepted", False)),
            "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
            "rejectedLandmarks": rejected_names,
            "warnings": warnings,
            "projectedCandidates": side_projected,
            "method": "mediapipe-canonical21-plus-anatomy-triangulation-centerline-v2",
        }
        all_warnings.extend(warnings)

    return {
        "left": result.get("left", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "right": result.get("right", {"status": "needs_review", "landmarks": {}, "warnings": []}),
        "warnings": all_warnings,
        "projectedCandidates": projected,
    }
