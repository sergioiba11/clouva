"""Geometric body measurements for CLOUVA Avatar Analyzer V4.2.

Circumferences are derived from convex hulls of real mesh cross-section samples.
Bounding-box perimeters are never used as a circumference substitute.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

from mathutils import Vector

MODULE_VERSION = "clouva-body-measurements-v4.2"


def _point(value) -> Vector | None:
    if isinstance(value, Vector):
        return value.copy()
    if isinstance(value, (list, tuple)) and len(value) == 3:
        try:
            point = Vector(tuple(float(component) for component in value))
            return point if all(math.isfinite(component) for component in point) else None
        except (TypeError, ValueError):
            return None
    return None


def _record(value: float | None, confidence: float, method: str, count: int = 0):
    valid = value is not None and math.isfinite(float(value)) and float(value) >= 0.0
    return {
        "value": float(value) if valid else None,
        "unit": "m",
        "confidence": max(0.0, min(1.0, float(confidence))) if valid else 0.0,
        "method": method,
        "crossSectionVertexCount": int(count),
    }


def _distance(first, second):
    a, b = _point(first), _point(second)
    return (a - b).length if a is not None and b is not None else None


def _basis(axis: Vector):
    direction = axis.normalized() if axis.length > 1e-8 else Vector((0.0, 0.0, 1.0))
    helper = Vector((0.0, 0.0, 1.0)) if abs(direction.z) < 0.88 else Vector((0.0, 1.0, 0.0))
    first = direction.cross(helper)
    if first.length <= 1e-8:
        first = Vector((1.0, 0.0, 0.0))
    first.normalize()
    second = direction.cross(first)
    second.normalize()
    return first, second


def _convex_hull(points: Sequence[tuple[float, float]]):
    unique = sorted(set((float(x), float(y)) for x, y in points))
    if len(unique) <= 2:
        return unique

    def cross(origin, first, second):
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0])

    lower = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0.0:
            lower.pop()
        lower.append(point)
    upper = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0.0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _perimeter(points: Sequence[tuple[float, float]]):
    hull = _convex_hull(points)
    if len(hull) < 3:
        return None
    return sum(
        math.dist(first, second)
        for first, second in zip(hull, [*hull[1:], hull[0]])
    )


def _section(points: Iterable[Vector], center: Vector, axis: Vector, radius: float, minimum: int = 8):
    points = list(points)
    direction = axis.normalized() if axis.length > 1e-8 else Vector((0.0, 0.0, 1.0))
    selected = []
    width = max(float(radius), 1e-5)
    for multiplier in (1.0, 1.6, 2.4, 3.4):
        selected = [point for point in points if abs((point - center).dot(direction)) <= width * multiplier]
        if len(selected) >= minimum:
            break
    first, second = _basis(direction)
    projected = [((point - center).dot(first), (point - center).dot(second)) for point in selected]
    if not projected:
        return {"count": 0, "width": None, "depth": None, "circumference": None}
    horizontal = [value[0] for value in projected]
    vertical = [value[1] for value in projected]
    return {
        "count": len(projected),
        "width": max(horizontal) - min(horizontal),
        "depth": max(vertical) - min(vertical),
        "circumference": _perimeter(projected),
    }


def _section_confidence(count: int):
    return max(0.25, min(0.96, count / 90.0)) if count >= 3 else 0.0


def _slice_records(section: dict, prefix: str):
    count = int(section.get("count") or 0)
    confidence = _section_confidence(count)
    method = f"mesh-cross-section-convex-hull-{prefix}-v4.2"
    return {
        f"{prefix}_width": _record(section.get("width"), confidence, method, count),
        f"{prefix}_depth": _record(section.get("depth"), confidence, method, count),
        f"{prefix}_circumference": _record(section.get("circumference"), confidence, method, count),
    }


def _foot_dimensions(points: Sequence[Vector]):
    if not points:
        return None, None, 0
    xs = [point.x for point in points]
    ys = [point.y for point in points]
    return max(ys) - min(ys), max(xs) - min(xs), len(points)


def calculate_body_measurements_v42(segmentation, vectors: dict, dimensions: dict):
    height = float(dimensions.get("height") or 0.0)
    pelvis = _point(vectors.get("pelvis")) or Vector((0.0, 0.0, height * 0.50))
    chest = _point(vectors.get("chest")) or Vector((0.0, 0.0, height * 0.74))
    neck = _point(vectors.get("neck")) or Vector((0.0, 0.0, height * 0.84))
    torso_axis = neck - pelvis
    torso_points = segmentation.region_points(("torso", "pelvis"))
    chest_center = chest
    waist_center = pelvis.lerp(chest, 0.34)
    hip_center = pelvis.lerp(chest, 0.04)
    slice_radius = max(height * 0.010, 0.004)
    chest_section = _section(torso_points, chest_center, torso_axis, slice_radius)
    waist_section = _section(torso_points, waist_center, torso_axis, slice_radius)
    hip_section = _section(torso_points, hip_center, torso_axis, slice_radius)

    result = {
        "height": _record(height if height > 0.0 else None, 0.98 if height > 0.0 else 0.0, "canonical-mesh-height-v4.2"),
        "shoulder_width": _record(_distance(vectors.get("shoulder_l"), vectors.get("shoulder_r")), 0.92, "internal-joint-distance-v4.2"),
        "torso_length": _record(_distance(vectors.get("pelvis"), vectors.get("neck")), 0.90, "internal-joint-distance-v4.2"),
        **_slice_records(chest_section, "chest"),
        **_slice_records(waist_section, "waist"),
        **_slice_records(hip_section, "hip"),
    }

    for side, suffix in (("left", "l"), ("right", "r")):
        shoulder = vectors.get(f"shoulder_{suffix}")
        elbow = vectors.get(f"elbow_{suffix}")
        wrist = vectors.get(f"wrist_{suffix}")
        hip = vectors.get(f"hip_{suffix}")
        knee = vectors.get(f"knee_{suffix}")
        ankle = vectors.get(f"ankle_{suffix}")
        foot = vectors.get(f"foot_{suffix}")
        result[f"upper_arm_length_{suffix}"] = _record(_distance(shoulder, elbow), 0.90, "internal-joint-distance-v4.2")
        result[f"forearm_length_{suffix}"] = _record(_distance(elbow, wrist), 0.90, "internal-joint-distance-v4.2")
        result[f"thigh_length_{suffix}"] = _record(_distance(hip, knee), 0.90, "internal-joint-distance-v4.2")
        result[f"calf_length_{suffix}"] = _record(_distance(knee, ankle), 0.90, "internal-joint-distance-v4.2")

        hand = segmentation.hand_measurement(side)
        hand_count = int(hand.get("vertexCount") or len(segmentation.region_points(f"hand_{suffix}")))
        hand_confidence = max(0.0, min(0.94, hand_count / 180.0)) if hand.get("valid") else 0.0
        result[f"hand_length_{suffix}"] = _record(float(hand.get("handLength") or 0.0) if hand.get("valid") else None, hand_confidence, "hand-local-frame-geometry-v4.2", hand_count)
        result[f"hand_width_{suffix}"] = _record(float(hand.get("handWidth") or 0.0) if hand.get("valid") else None, hand_confidence, "hand-local-frame-geometry-v4.2", hand_count)

        wrist_point = _point(wrist)
        elbow_point = _point(elbow)
        forearm_points = segmentation.region_points(f"forearm_{suffix}")
        wrist_section = _section(
            forearm_points,
            wrist_point or Vector((0.0, 0.0, 0.0)),
            (wrist_point - elbow_point) if wrist_point is not None and elbow_point is not None else Vector((1.0, 0.0, 0.0)),
            max(height * 0.006, 0.0025),
            minimum=6,
        )
        result[f"wrist_circumference_{suffix}"] = _record(
            wrist_section.get("circumference"),
            _section_confidence(int(wrist_section.get("count") or 0)),
            "mesh-cross-section-convex-hull-wrist-v4.2",
            int(wrist_section.get("count") or 0),
        )

        hip_point, knee_point, ankle_point = _point(hip), _point(knee), _point(ankle)
        thigh_points = segmentation.region_points(f"thigh_{suffix}")
        thigh_center = hip_point.lerp(knee_point, 0.34) if hip_point is not None and knee_point is not None else Vector((0.0, 0.0, 0.0))
        thigh_axis = (knee_point - hip_point) if hip_point is not None and knee_point is not None else Vector((0.0, 0.0, -1.0))
        thigh_section = _section(thigh_points, thigh_center, thigh_axis, max(height * 0.009, 0.0035))
        result[f"thigh_circumference_{suffix}"] = _record(
            thigh_section.get("circumference"),
            _section_confidence(int(thigh_section.get("count") or 0)),
            "mesh-cross-section-convex-hull-thigh-v4.2",
            int(thigh_section.get("count") or 0),
        )

        calf_points = segmentation.region_points(f"calf_{suffix}")
        ankle_axis = (ankle_point - knee_point) if ankle_point is not None and knee_point is not None else Vector((0.0, 0.0, -1.0))
        ankle_section = _section(calf_points, ankle_point or Vector((0.0, 0.0, 0.0)), ankle_axis, max(height * 0.005, 0.002), minimum=6)
        result[f"ankle_circumference_{suffix}"] = _record(
            ankle_section.get("circumference"),
            _section_confidence(int(ankle_section.get("count") or 0)),
            "mesh-cross-section-convex-hull-ankle-v4.2",
            int(ankle_section.get("count") or 0),
        )

        foot_points = segmentation.region_points(f"foot_{suffix}")
        foot_length, foot_width, foot_count = _foot_dimensions(foot_points)
        foot_confidence = max(0.0, min(0.94, foot_count / 140.0)) if foot_count else 0.0
        result[f"foot_length_{suffix}"] = _record(foot_length, foot_confidence, "canonical-foot-vertex-span-v4.2", foot_count)
        result[f"foot_width_{suffix}"] = _record(foot_width, foot_confidence, "canonical-foot-vertex-span-v4.2", foot_count)

    left_hip, right_hip = _point(vectors.get("hip_l")), _point(vectors.get("hip_r"))
    left_ankle, right_ankle = _point(vectors.get("ankle_l")), _point(vectors.get("ankle_r"))
    inseams = []
    if left_hip is not None and left_ankle is not None:
        inseams.append((left_hip - left_ankle).length)
    if right_hip is not None and right_ankle is not None:
        inseams.append((right_hip - right_ankle).length)
    result["inseam"] = _record(sum(inseams) / len(inseams) if inseams else None, 0.86 if len(inseams) == 2 else 0.70 if inseams else 0.0, "bilateral-hip-to-ankle-internal-distance-v4.2")

    requested_names = (
        "height", "shoulder_width", "chest_width", "chest_depth", "chest_circumference",
        "waist_width", "waist_depth", "waist_circumference", "hip_width", "hip_depth",
        "hip_circumference", "torso_length", "upper_arm_length_l", "upper_arm_length_r",
        "forearm_length_l", "forearm_length_r", "wrist_circumference_l", "wrist_circumference_r",
        "hand_length_l", "hand_length_r", "hand_width_l", "hand_width_r", "thigh_length_l",
        "thigh_length_r", "calf_length_l", "calf_length_r", "inseam", "thigh_circumference_l",
        "thigh_circumference_r", "ankle_circumference_l", "ankle_circumference_r",
        "foot_length_l", "foot_length_r", "foot_width_l", "foot_width_r",
    )
    for name in requested_names:
        result.setdefault(name, _record(None, 0.0, "measurement-unavailable-v4.2"))
    valid_count = sum(1 for item in result.values() if item.get("value") is not None)
    return {
        "version": MODULE_VERSION,
        "unit": "m",
        "measurements": {name: result[name] for name in requested_names},
        "validMeasurementCount": valid_count,
        "requestedMeasurementCount": len(requested_names),
        "circumferenceMethod": "real-mesh-cross-section-convex-hull",
        "boundingBoxCircumferenceUsed": False,
    }


__all__ = ["calculate_body_measurements_v42"]
