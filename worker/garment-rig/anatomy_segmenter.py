"""Anatomy-aware mesh segmentation for CLOUVA Avatar Analyzer V2.

Rough body landmarks are treated only as seeds. Complete arm and leg axes are
reconstructed from side-specific geometry before vertices are assigned to named
regions. This prevents a bad initial wrist candidate from collapsing the hand
region back toward the torso.
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


def _mean(points: Sequence[Vector], fallback: Vector) -> Vector:
    if not points:
        return fallback.copy()
    return sum(points, Vector((0.0, 0.0, 0.0))) / len(points)


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
                 measurements: dict, diagnostics: dict, refined_vectors: Dict[str, Vector]):
        self.labels = labels
        self.samples = samples
        self.measurements = measurements
        self.diagnostics = diagnostics
        self.refined_vectors = refined_vectors

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
            "version": "clouva-anatomy-segmentation-v2.1",
            "regions": regions,
            "measurements": self.measurements,
            "refinedVectors": {name: _vec(value) for name, value in self.refined_vectors.items()},
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
    low = _percentile(along, 0.03)
    high = _percentile(along, 0.98)
    width = _percentile(across, 0.97) - _percentile(across, 0.03)
    thickness = _percentile(depth, 0.95) - _percentile(depth, 0.05)
    wrist_band = [
        value.dot(lateral) for value in relative
        if abs(value.dot(forward)) <= max((high - low) * 0.16, 1e-5)
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


def _all_body_points(meshes, classifications):
    return [
        obj.matrix_world @ vertex.co
        for obj in meshes
        if classifications.get(obj.name) == "body"
        for vertex in obj.data.vertices
    ]


def _refine_arm(points: Sequence[Vector], vectors: Dict[str, Vector], side: str,
                sign: float, center_x: float, width: float, height: float):
    shoulder = vectors[f"shoulder_{side}"].copy()
    pelvis_z = vectors["pelvis"].z
    neck_z = vectors["neck"].z
    cloud = [
        point for point in points
        if sign * (point.x - center_x) >= width * 0.085
        and pelvis_z - height * 0.09 <= point.z <= neck_z + height * 0.05
    ]
    if len(cloud) < 8:
        return {
            "shoulder": shoulder,
            "elbow": vectors[f"elbow_{side}"].copy(),
            "wrist": vectors[f"wrist_{side}"].copy(),
            "hand": vectors[f"hand_{side}"].copy(),
            "cloudSize": len(cloud),
            "method": "rough-fallback",
        }
    distances = [(point - shoulder).length for point in cloud]
    threshold = _percentile(distances, 0.94, height * 0.22)
    distal_cluster = [point for point in cloud if (point - shoulder).length >= threshold]
    distal = _mean(distal_cluster, max(cloud, key=lambda point: (point - shoulder).length))
    axis = distal - shoulder
    if axis.length <= height * 0.10:
        return {
            "shoulder": shoulder,
            "elbow": vectors[f"elbow_{side}"].copy(),
            "wrist": vectors[f"wrist_{side}"].copy(),
            "hand": vectors[f"hand_{side}"].copy(),
            "cloudSize": len(cloud),
            "method": "rough-fallback-short-axis",
        }
    axis.normalize()
    projected = [((point - shoulder).dot(axis), point) for point in cloud]
    positive = [distance for distance, _point in projected if distance > 0.0]
    extent = _percentile(positive, 0.985, height * 0.30)
    extent = max(height * 0.16, min(height * 0.50, extent))
    return {
        "shoulder": shoulder,
        "elbow": shoulder + axis * (extent * 0.46),
        "wrist": shoulder + axis * (extent * 0.78),
        "hand": shoulder + axis * (extent * 0.98),
        "cloudSize": len(cloud),
        "extent": float(extent),
        "axis": _vec(axis),
        "method": "side-cloud-distal-axis-v2.1",
    }


def _refine_leg(points: Sequence[Vector], vectors: Dict[str, Vector], side: str,
                sign: float, center_x: float, width: float, height: float):
    hip = vectors[f"hip_{side}"].copy()
    pelvis_z = vectors["pelvis"].z
    cloud = [
        point for point in points
        if sign * (point.x - center_x) >= width * 0.018
        and sign * (point.x - center_x) <= width * 0.32
        and point.z <= pelvis_z + height * 0.08
    ]
    if len(cloud) < 8:
        return {
            "hip": hip,
            "knee": vectors[f"knee_{side}"].copy(),
            "ankle": vectors[f"ankle_{side}"].copy(),
            "foot": vectors[f"foot_{side}"].copy(),
            "cloudSize": len(cloud),
            "method": "rough-fallback",
        }
    distances = [(point - hip).length for point in cloud]
    threshold = _percentile(distances, 0.95, height * 0.45)
    distal_cluster = [point for point in cloud if (point - hip).length >= threshold]
    distal = _mean(distal_cluster, max(cloud, key=lambda point: (point - hip).length))
    axis = distal - hip
    if axis.length <= height * 0.20:
        return {
            "hip": hip,
            "knee": vectors[f"knee_{side}"].copy(),
            "ankle": vectors[f"ankle_{side}"].copy(),
            "foot": vectors[f"foot_{side}"].copy(),
            "cloudSize": len(cloud),
            "method": "rough-fallback-short-axis",
        }
    axis.normalize()
    positive = [(point - hip).dot(axis) for point in cloud if (point - hip).dot(axis) > 0.0]
    extent = _percentile(positive, 0.985, height * 0.52)
    extent = max(height * 0.34, min(height * 0.70, extent))
    return {
        "hip": hip,
        "knee": hip + axis * (extent * 0.49),
        "ankle": hip + axis * (extent * 0.84),
        "foot": hip + axis * (extent * 0.98),
        "cloudSize": len(cloud),
        "extent": float(extent),
        "axis": _vec(axis),
        "method": "lower-side-cloud-distal-axis-v2.1",
    }


def _refined_vectors(points, vectors, center_x, width, height):
    refined = {name: value.copy() for name, value in vectors.items()}
    diagnostics = {}
    for side, sign in (("l", 1.0), ("r", -1.0)):
        arm = _refine_arm(points, vectors, side, sign, center_x, width, height)
        leg = _refine_leg(points, vectors, side, sign, center_x, width, height)
        refined[f"shoulder_{side}"] = arm["shoulder"]
        refined[f"elbow_{side}"] = arm["elbow"]
        refined[f"wrist_{side}"] = arm["wrist"]
        refined[f"hand_{side}"] = arm["hand"]
        refined[f"hip_{side}"] = leg["hip"]
        refined[f"knee_{side}"] = leg["knee"]
        refined[f"ankle_{side}"] = leg["ankle"]
        refined[f"foot_{side}"] = leg["foot"]
        diagnostics[f"arm_{side}"] = {key: value for key, value in arm.items() if not isinstance(value, Vector)}
        diagnostics[f"leg_{side}"] = {key: value for key, value in leg.items() if not isinstance(value, Vector)}
    return refined, diagnostics


def _region_specs(vectors: Dict[str, Vector], height: float):
    return {
        "upper_arm_l": (vectors["shoulder_l"], vectors["elbow_l"], height * 0.072, 1.0),
        "forearm_l": (vectors["elbow_l"], vectors["wrist_l"], height * 0.064, 1.0),
        "hand_l": (vectors["wrist_l"], vectors["hand_l"], height * 0.100, 1.0),
        "upper_arm_r": (vectors["shoulder_r"], vectors["elbow_r"], height * 0.072, -1.0),
        "forearm_r": (vectors["elbow_r"], vectors["wrist_r"], height * 0.064, -1.0),
        "hand_r": (vectors["wrist_r"], vectors["hand_r"], height * 0.100, -1.0),
        "thigh_l": (vectors["hip_l"], vectors["knee_l"], height * 0.105, 1.0),
        "calf_l": (vectors["knee_l"], vectors["ankle_l"], height * 0.088, 1.0),
        "foot_l": (vectors["ankle_l"], vectors["foot_l"], height * 0.105, 1.0),
        "thigh_r": (vectors["hip_r"], vectors["knee_r"], height * 0.105, -1.0),
        "calf_r": (vectors["knee_r"], vectors["ankle_r"], height * 0.088, -1.0),
        "foot_r": (vectors["ankle_r"], vectors["foot_r"], height * 0.105, -1.0),
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
    body_points = _all_body_points(meshes, classifications)
    refined, axis_diagnostics = _refined_vectors(body_points, vectors, center_x, width, height)
    specs = _region_specs(refined, height)
    labels: Dict[str, List[str]] = {}
    samples: Dict[str, List[VertexSample]] = defaultdict(list)
    rejected_objects = []

    for obj in meshes:
        category = classifications.get(obj.name, "unknown_rejected")
        object_labels = ["unassigned"] * len(obj.data.vertices)
        labels[obj.name] = object_labels
        if category != "body":
            rejected_objects.append({"object": obj.name, "class": category})
            continue
        normal_matrix = obj.matrix_world.to_3x3()
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            normal = _safe_normal(normal_matrix @ vertex.normal, Vector((0.0, 0.0, 1.0)))
            best_region = None
            best_score = float("inf")
            for region, (start, end, radius, sign) in specs.items():
                signed_lateral = sign * (point.x - center_x)
                lower_limb = region.startswith(("thigh_", "calf_", "foot_"))
                if signed_lateral < width * (0.018 if lower_limb else 0.075):
                    continue
                distance, raw_t, _closest = _segment_distance(point, start, end)
                outside = max(0.0, -raw_t, raw_t - 1.0)
                score = distance / max(radius, 1e-6) + outside * 3.0
                if score < best_score and score <= 1.70:
                    best_region = region
                    best_score = score
            region = best_region or _fallback_region(point, refined, center_x, width, height)
            object_labels[vertex.index] = region
            samples[region].append(VertexSample(obj.name, vertex.index, point, normal, region))

    measurements = {
        "leftHand": _measure_hand(
            [item.point for item in samples.get("hand_l", [])], refined["wrist_l"], refined["hand_l"],
        ),
        "rightHand": _measure_hand(
            [item.point for item in samples.get("hand_r", [])], refined["wrist_r"], refined["hand_r"],
        ),
    }
    diagnostics = {
        "method": "refined-side-cloud-axes-plus-region-corridors-v2.1",
        "limbAxes": axis_diagnostics,
        "rejectedObjects": rejected_objects,
        "unassignedVertices": len(samples.get("unassigned", [])),
        "regionCount": len([name for name, values in samples.items() if values]),
    }
    return AnatomySegmentation(labels, dict(samples), measurements, diagnostics, refined)
