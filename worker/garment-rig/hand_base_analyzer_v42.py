"""Geometry-only base hand module for BODY_HANDS_BASIC.

This path validates wrist/palm geometry and the local hand frame without running
finger branch extraction, MediaPipe hand labeling or hand camera renders.
"""
from __future__ import annotations

from mathutils import Vector

MODULE_VERSION = "clouva-hand-base-analyzer-v4.2"


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _vector(values, fallback):
    if isinstance(values, (list, tuple)) and len(values) == 3:
        result = Vector(tuple(float(value) for value in values))
        if result.length > 1e-8:
            return result
    return fallback.copy()


def analyze_hand_base_module_v42(segmentation, anatomy_bvh, side: str):
    if side not in {"left", "right"}:
        raise ValueError("side must be left or right")
    suffix = "l" if side == "left" else "r"
    measurement = segmentation.hand_measurement(side)
    hand_scale = max(float(measurement.get("handScale") or 0.0), 1e-5)
    wrist = _vector(measurement.get("origin"), Vector((0.0, 0.0, 0.0)))
    forward = _vector(measurement.get("forward"), Vector((0.0, 0.0, -1.0))).normalized()
    lateral = _vector(
        measurement.get("lateral"),
        Vector((1.0, 0.0, 0.0) if suffix == "l" else (-1.0, 0.0, 0.0)),
    ).normalized()
    normal = _vector(measurement.get("normal"), Vector((0.0, -1.0, 0.0))).normalized()
    hand_points = segmentation.region_points(f"hand_{suffix}")
    forearm_points = segmentation.region_points(f"forearm_{suffix}")

    relative = [(point, (point - wrist).dot(forward)) for point in hand_points]
    palm_core = [
        point for point, along in relative
        if hand_scale * 0.14 <= along <= hand_scale * 0.70
        and abs((point - wrist).dot(lateral)) <= max(float(measurement.get("handWidth") or 0.0) * 0.45, hand_scale * 0.20)
    ]
    if not palm_core:
        palm_core = [point for point, along in relative if hand_scale * 0.08 <= along <= hand_scale * 0.72]
    palm_center = (
        sum(palm_core, Vector((0.0, 0.0, 0.0))) / len(palm_core)
        if palm_core else wrist + forward * hand_scale * 0.44
    )

    wrist_surface = anatomy_bvh.nearest(
        wrist,
        (f"forearm_{suffix}", f"hand_{suffix}"),
        hand_scale * 0.34,
    )
    palm_surface = anatomy_bvh.nearest(
        palm_center,
        f"hand_{suffix}",
        hand_scale * 0.42,
    )
    wrist_corridor_count = sum(
        1 for point in [*forearm_points, *hand_points]
        if abs((point - wrist).dot(forward)) <= hand_scale * 0.18
        and abs((point - wrist).dot(lateral)) <= hand_scale * 0.44
    )
    measurement_valid = bool(measurement.get("valid"))
    wrist_valid = bool(measurement_valid and wrist_surface and wrist_corridor_count >= 6)
    palm_valid = bool(measurement_valid and palm_surface and len(palm_core) >= 8)
    confidence = min(
        0.98,
        0.42
        + min(0.22, len(hand_points) / 800.0)
        + min(0.16, wrist_corridor_count / 80.0)
        + (0.10 if palm_surface else 0.0),
    ) if measurement_valid else 0.0

    def record(name: str, position: Vector, surface, accepted: bool, region: str):
        display = surface["location"] if surface else position
        return {
            "name": name,
            "region": region,
            "position": _vec(position),
            "internalJointPosition": _vec(position),
            "surfaceDisplayPosition": _vec(display),
            "accepted": accepted,
            "verified": accepted,
            "display": accepted,
            "blocking": not accepted,
            "state": "verified_internal_geometry" if accepted else "manual_review_required",
            "validationState": "verified_internal_geometry" if accepted else "manual_review_required",
            "verificationMethod": "verified_internal_geometry" if accepted else "unverified_geometry",
            "method": "hand-local-frame-and-wrist-corridor-v4.2",
            "confidence": confidence if accepted else 0.0,
            "finalConfidence": confidence if accepted else 0.0,
            "surfaceRegion": (surface.get("primaryRegion") or surface.get("region")) if surface else None,
            "triangleId": int(surface.get("triangleIndex") or -1) if surface else None,
            "rejectionReasons": [] if accepted else ["HAND_BASE_GEOMETRY_INSUFFICIENT"],
        }

    landmarks = {
        f"wrist_{suffix}": record(f"wrist_{suffix}", wrist, wrist_surface, wrist_valid, f"wrist_{suffix}"),
        f"palm_{suffix}": record(f"palm_{suffix}", palm_center, palm_surface, palm_valid, f"hand_{suffix}"),
    }
    warnings = []
    if not measurement_valid:
        warnings.append({
            "code": "HAND_BASE_MEASUREMENT_INVALID",
            "module": f"{side}_hand",
            "side": side,
            "blocking": True,
            "vertexCount": len(hand_points),
        })
    if not wrist_valid:
        warnings.append({
            "code": "WRIST_CORRIDOR_NOT_VERIFIED",
            "module": f"{side}_hand",
            "side": side,
            "blocking": True,
            "wristCorridorVertexCount": wrist_corridor_count,
            "expectedRegions": [f"forearm_{suffix}", f"hand_{suffix}"],
            "rayHit": bool(wrist_surface),
        })
    if not palm_valid:
        warnings.append({
            "code": "PALM_CORE_NOT_VERIFIED",
            "module": f"{side}_hand",
            "side": side,
            "blocking": True,
            "palmVertexCount": len(palm_core),
            "expectedRegion": f"hand_{suffix}",
            "rayHit": bool(palm_surface),
        })

    ready = wrist_valid and palm_valid
    status = "valid" if ready else "needs_review"
    return {
        "status": status,
        "side": side,
        "landmarks": landmarks,
        "validFingers": 0,
        "handTopologyMode": "base_geometry_only",
        "handMode": "base_geometry_only",
        "fingerRigMode": "not_requested",
        "handBaseReady": ready,
        "fingerRigReady": False,
        "measurements": measurement,
        "palmFrame": {
            "wrist": _vec(wrist),
            "palmCenter": _vec(palm_center),
            "palmNormal": _vec(normal),
            "palmForward": _vec(forward),
            "palmLateral": _vec(lateral),
            "handWidth": float(measurement.get("handWidth") or 0.0),
            "handLength": float(measurement.get("handLength") or 0.0),
            "thumbSide": "+lateral" if suffix == "l" else "-lateral",
            "pinkySide": "-lateral" if suffix == "l" else "+lateral",
        },
        "detectedBranchCount": None,
        "requiredBranchCount": 0,
        "palmVertexCount": len(palm_core),
        "fingerSeparationScore": None,
        "warnings": warnings,
        "blockingWarnings": [item for item in warnings if item.get("blocking")],
        "nonBlockingWarnings": [item for item in warnings if not item.get("blocking")],
        "projectedCandidates": [],
        "projectionMetrics": {
            "sparseProjectionsGenerated": 0,
            "raysExecuted": 0,
            "projectionFailures": 0,
            "projectionVersion": "not_required_for-base-hand",
        },
        "method": "geometry-only-wrist-palm-local-frame-v4.2",
        "manifest": {
            "version": MODULE_VERSION,
            "module": f"{side}_hand",
            "side": side,
            "status": status,
            "detail": "base_only",
            "cameras": [],
            "landmarkFilter": [f"wrist_{suffix}", f"palm_{suffix}"],
            "sparseProjection": False,
            "fingerAnalysisExecuted": False,
            "detectorExecuted": False,
        },
    }


__all__ = ["analyze_hand_base_module_v42"]
