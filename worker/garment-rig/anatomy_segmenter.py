"""Anatomy-aware mesh segmentation for CLOUVA Avatar Analyzer V2.

The segmenter converts the rough V16 body candidates into explicit anatomical
regions. Downstream code must query a named region instead of searching every
vertex in the avatar; this prevents a shoulder/elbow marker from snapping to the
nearby torso, clothing or opposite limb.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector


@dataclass(frozen=True)
class VertexSample:
    object_name: str
    vertex_index: int
    point: Vector
    normal: Vector
    region: str


def _vec(value: Vector) -> List[float]:
    return [float(value.x), float(value.y), float(value.z)]


def _percentile(values: Sequence[float], factor: float, fallback: float = 0.0) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return float(fallback)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * factor)))
    return ordered[index]


def _segment_distance(point: Vector, start: Vector, end: Vector) -> Tuple[float, float, Vector]:
    axis = end - start
    denominator = max(axis.length_squared, 1e-12)
    raw_t = (point - start).dot(axis) / denominator
    t = max(0.0, min(1.0, raw_t))
    closest = start + axis * t
    return (point - closest).length, raw_t, closest


def _safe_normal(value: Vector, fallback: Vector) -> Vector:
    result = value.copy()
    if result.length <= 1e-8:
        result = fallback.copy()
    if result.length > 1e-8:
        result.normalize()
    return result


def _bounds(points: Sequence[Vector]) -> dict:
    if not points:
        return {"minimum": [0.0, 0.0, 0.0], "maximum": [0.0, 0.0, 0.0], "size": [0.0, 0.0, 0.0]}
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return {"minimum": _vec(minimum), "maximum": _vec(maximum), "size": _vec(maximum - minimum)}


class AnatomySegmentation:
    def __init__(self, labels: Dict[str, List[str]], samples: Dict[str, List[VertexSample]],
                 measurements: dict, diagnostics: dict):
        self.labels = labels
        self.samples = samples
        self.measurements = measurements
        self.diagnostics = diagnostics

    def region_samples(self, regions: str | Iterable[str]) -> List[VertexSample]:
        names = [regions] if isinstance(regions, str) else list(regions)
        result: List[VertexSample] = []
        for name in names:
            result.extend(self.samples.get(name, []))
        return result

    def region_points(self, regions: str | Iterable[str]) -> List[Vector]:
        return [sample.point for sample in self.region_samples(regions)]

    def nearest(self, point: Vector, regions: str | Iterable[str]):
        candidates = self.region_samples(regions)
        if not candidates:
            return None, float("inf")
        sample = min(candidates, key=lambda item: (item.point - point).length_squared)
        return sample, (sample.point - point).length

    def contains_near(self, point: Vector, regions: str | Iterable[str], tolerance: float) -> bool:
        _sample, distance = self.nearest(point, regions)
        return distance <= max(float(tolerance), 1e-6)

    def hand_measurement(self, side: str) -> dict:
        return dict(self.measurements.get(f"{side}Hand") or {})

    def as_report(self) -> dict:
        regions = {}
        for name, region_samples in sorted(self.samples.items()):
            points = [item.point for item in region_samples]
            regions[name] = {
                "vertexCount": len(region_samples),
                "objects": sorted({item.object_name for item in region_samples}),
                "bounds": _bounds(points),
                "confidence": min(1.0, len(region_samples) / 180.0),
            }
        return {
            "version": "clouva-anatomy-segmentation-v2",
            "regions": regions,
            "measurements": self.measurements,
            "diagnostics": self.diagnostics,
        }


def _hand_frame(points: Sequence[Vector], wrist: Vector, distal: Vector):
    forward = _safe_normal(distal - wrist, Vector((0.0, 0.0, -1.0)))
    front = Vector((0.0, -1.0, 0.0))
    normal = front - forward * front.dot(forward)
    normal = _safe_normal(normal, Vector((0.0, 0.0, 1.0)))
    lateral = _safe_normal(forward.cross(normal), Vector((1.0, 0.0, 0.0)))
    normal = _safe_normal(lateral.cross(forward), normal)
    return forward, lateral, normal


def _measure_hand(points: Sequence[Vector], wrist: Vector, distal: Vector) -> dict:
    if not points:
        return {
            "valid": False,
            "handLength": 0.0,
            "handWidth": 0.0,
            "handThickness": 0.0,
            "wristWidth": 0.0,
            "handScale": max((distal - wrist).length, 1e-5),
        }
    forward, lateral, normal = _hand_frame(points, wrist, distal)
    relative = [point - wrist for point in points]
    along = [value.dot(forward) for value in relative]
    across = [value.dot(lateral) for value in relative]
    depth = [value.dot(normal) for value in relative]
    low = _percentile(along, 0.04)
    high = _percentile(along, 0.97)
    width = _percentile(across, 0.97) - _percentile(across, 0.03)
    thickness = _percentile(depth, 0.95) - _percentile(depth, 0.05)
    wrist_band = [
        value.dot(lateral) for value in relative
        if abs(value.dot(forward)) <= max((high - low) * 0.14, 1e-5)
    ]
    wrist_width = (
        _percentile(wrist_band, 0.95) - _percentile(wrist_band, 0.05)
        if wrist_band else width * 0.55
    )
    length = max(high - low, (distal - wrist).length, 1e-5)
    return {
        "valid": len(points) >= 12,
        "vertexCount": len(points),
        "handLength": float(length),
        "handWidth": float(max(width, 1e-5)),
        "handThickness": float(max(thickness, 1e-5)),
        "wristWidth": float(max(wrist_width, 1e-5)),
        "handScale": float(max(length, width, 1e-5)),
        "origin": _vec(wrist),
        "forward": _vec(forward),
        "lateral": _vec(lateral),
        "normal": _vec(normal),
    }


def _region_specs(vectors: Dict[str, Vector], height: float):
    return {
        "upper_arm_l": (vectors["shoulder_l"], vectors["elbow_l"], height * 0.070, 1.0),
        "forearm_l": (vectors["elbow_l"], vectors["wrist_l"], height * 0.060, 1.0),
        "hand_l": (vectors["wrist_l"], vectors["hand_l"], height * 0.092, 1.0),
        "upper_arm_r": (vectors["shoulder_r"], vectors["elbow_r"], height * 0.070, -1.0),
        "forearm_r": (vectors["elbow_r"], vectors["wrist_r"], height * 0.060, -1.0),
        "hand_r": (vectors["wrist_r"], vectors["hand_r"], height * 0.092, -1.0),
        "thigh_l": (vectors["hip_l"], vectors["knee_l"], height * 0.100, 1.0),
        "calf_l": (vectors["knee_l"], vectors["ankle_l"], height * 0.082, 1.0),
        "foot_l": (vectors["ankle_l"], vectors["foot_l"], height * 0.095, 1.0),
        "thigh_r": (vectors["hip_r"], vectors["knee_r"], height * 0.100, -1.0),
        "calf_r": (vectors["knee_r"], vectors["ankle_r"], height * 0.082, -1.0),
        "foot_r": (vectors["ankle_r"], vectors["foot_r"], height * 0.095, -1.0),
    }


def _fallback_region(point: Vector, vectors: Dict[str, Vector], center_x: float,
                     width: float, height: float) -> str:
    lateral = abs(point.x - center_x)
    if point.z >= vectors["skull_base"].z - height * 0.02:
        return "head"
    if point.z >= vectors["chest"].z and lateral <= width * 0.20:
        return "neck"
    if vectors["pelvis"].z - height * 0.06 <= point.z <= vectors["chest"].z + height * 0.10:
        return "torso" if point.z >= vectors["pelvis"].z + height * 0.05 else "pelvis"
    return "unassigned"


def segment_anatomy(meshes: Iterable[bpy.types.Object], classifications: Dict[str, str],
                    vectors: Dict[str, Vector], dimensions: dict) -> AnatomySegmentation:
    meshes = list(meshes)
    height = max(float(dimensions.get("height") or 0.0), 1e-5)
    width = max(float(dimensions.get("width") or 0.0), 1e-5)
    center_x = float((dimensions.get("center") or [0.0])[0])
    specs = _region_specs(vectors, height)
    labels: Dict[str, List[str]] = {}
    samples: Dict[str, List[VertexSample]] = defaultdict(list)
    rejected_objects = []

    for obj in meshes:
        category = classifications.get(obj.name, "unknown")
        object_labels = ["unassigned"] * len(obj.data.vertices)
        labels[obj.name] = object_labels
        if category not in {"body", "unknown"}:
            rejected_objects.append({"object": obj.name, "class": category})
            continue
        normal_matrix = obj.matrix_world.to_3x3()
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            normal = _safe_normal(normal_matrix @ vertex.normal, Vector((0.0, 0.0, 1.0)))
            best_region = None
            best_score = float("inf")
            for region, (start, end, radius, sign) in specs.items():
                # A side gate is essential near the armpit and pelvis where the
                # torso is geometrically closer than the intended limb surface.
                signed_lateral = sign * (point.x - center_x)
                if signed_lateral < width * (0.055 if "thigh" in region or "calf" in region else 0.095):
                    continue
                distance, raw_t, _closest = _segment_distance(point, start, end)
                outside = max(0.0, -raw_t, raw_t - 1.0)
                score = distance / max(radius, 1e-6) + outside * 3.0
                if score < best_score and score <= 1.55:
                    best_region = region
                    best_score = score
            region = best_region or _fallback_region(point, vectors, center_x, width, height)
            object_labels[vertex.index] = region
            samples[region].append(VertexSample(obj.name, vertex.index, point, normal, region))

    measurements = {
        "leftHand": _measure_hand(
            [item.point for item in samples.get("hand_l", [])], vectors["wrist_l"], vectors["hand_l"],
        ),
        "rightHand": _measure_hand(
            [item.point for item in samples.get("hand_r", [])], vectors["wrist_r"], vectors["hand_r"],
        ),
    }
    diagnostics = {
        "method": "skeleton-corridor-plus-side-gates-v2",
        "rejectedObjects": rejected_objects,
        "unassignedVertices": len(samples.get("unassigned", [])),
        "regionCount": len([name for name, values in samples.items() if values]),
    }
    return AnatomySegmentation(labels, dict(samples), measurements, diagnostics)
