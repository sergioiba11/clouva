"""Geometry-only body analysis for CLOUVA Avatar Analyzer V3.2."""
from __future__ import annotations

from collections import Counter
from typing import Dict, Iterable, List, Sequence, Tuple

import bpy
from mathutils import Vector

from autorig_avatar_v16 import MeshLandmarkDetector

ANATOMY_CLASSES = {
    "body", "eyes", "teeth", "tongue", "hair", "eyebrows", "eyelashes",
    "clothing", "accessories", "unknown_rejected",
}

_KEYWORDS = {
    "eyes": ("eye", "eyeball", "iris", "pupil", "ojo"),
    "teeth": ("teeth", "tooth", "diente"),
    "tongue": ("tongue", "lengua"),
    "hair": ("hair", "pelo", "cabello", "beard", "barba"),
    "eyebrows": ("brow", "eyebrow", "ceja"),
    "eyelashes": ("lash", "eyelash", "pesta"),
    "clothing": (
        "shirt", "hoodie", "cloth", "jacket", "pants", "shorts", "shoe", "sock",
        "garment", "ropa", "remera", "pantal", "zapat",
    ),
    "accessories": (
        "hat", "cap", "beanie", "earring", "necklace", "chain", "ring", "bracelet",
        "glasses", "headphone", "horn", "accessory", "gorro", "aro", "cadena", "anillo", "pulsera",
    ),
}


def vec(value: Vector) -> List[float]:
    return [float(value.x), float(value.y), float(value.z)]


def _world_bounds(obj: bpy.types.Object) -> Tuple[Vector, Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum, maximum - minimum


def _box_gap(first_min: Vector, first_max: Vector, second_min: Vector, second_max: Vector) -> float:
    squared = 0.0
    for axis in range(3):
        if first_max[axis] < second_min[axis]:
            delta = second_min[axis] - first_max[axis]
        elif second_max[axis] < first_min[axis]:
            delta = first_min[axis] - second_max[axis]
        else:
            delta = 0.0
        squared += delta * delta
    return squared ** 0.5


def classify_meshes(meshes: Iterable[bpy.types.Object]) -> Dict[str, str]:
    """Classify only explicit or spatially connected anatomy as body."""
    meshes = list(meshes)
    if not meshes:
        return {}
    classifications: Dict[str, str] = {}
    unresolved: List[bpy.types.Object] = []
    for obj in meshes:
        material_names = " ".join(slot.material.name.lower() for slot in obj.material_slots if slot.material)
        haystack = f"{obj.name} {obj.data.name} {material_names}".lower()
        category = next(
            (name for name, terms in _KEYWORDS.items() if any(term in haystack for term in terms)),
            None,
        )
        if category:
            classifications[obj.name] = category
        else:
            unresolved.append(obj)

    if unresolved:
        body = max(unresolved, key=lambda item: len(item.data.vertices))
        classifications[body.name] = "body"
        unresolved = [item for item in unresolved if item != body]
        body_min, body_max, body_size = _world_bounds(body)
        body_height = max(body_size.z, 1e-8)
        head_floor = body_min.z + body_height * 0.68
        eye_candidates = []
        for obj in unresolved:
            minimum, maximum, size = _world_bounds(obj)
            center = (minimum + maximum) * 0.5
            relative = max(size) / body_height
            roundness = max(size) / max(min(size), 1e-8)
            if center.z >= head_floor and relative < 0.11 and roundness < 2.4:
                eye_candidates.append(obj)
        if len(eye_candidates) >= 2:
            eye_candidates.sort(key=lambda obj: (_world_bounds(obj)[0].x + _world_bounds(obj)[1].x) * 0.5)
            for obj in eye_candidates[:2]:
                classifications[obj.name] = "eyes"
        unresolved = [item for item in unresolved if item.name not in classifications]
        connection_tolerance = body_height * 0.035
        expanded_min = body_min - Vector((connection_tolerance,) * 3)
        expanded_max = body_max + Vector((connection_tolerance,) * 3)
        for obj in unresolved:
            minimum, maximum, size = _world_bounds(obj)
            center = (minimum + maximum) * 0.5
            gap = _box_gap(minimum, maximum, body_min, body_max)
            center_inside = all(expanded_min[index] <= center[index] <= expanded_max[index] for index in range(3))
            meaningful = len(obj.data.vertices) >= 12 and max(size) >= body_height * 0.012
            classifications[obj.name] = "body" if gap <= connection_tolerance and center_inside and meaningful else "unknown_rejected"

    for obj in meshes:
        classifications.setdefault(obj.name, "unknown_rejected")
        if classifications[obj.name] not in ANATOMY_CLASSES:
            classifications[obj.name] = "unknown_rejected"
    return classifications


def _symmetry_score(points: List[Vector], center_x: float, scale: float) -> float:
    if not points or scale <= 1e-8:
        return 0.0
    step = max(scale / 120.0, 1e-6)
    stride = max(1, len(points) // 30000)

    def key(point: Vector):
        return (round((point.x - center_x) / step), round(point.y / step), round(point.z / step))

    voxels = {key(point) for point in points[::stride]}
    mirrored = {(-x, y, z) for x, y, z in voxels}
    return max(0.0, min(1.0, len(voxels.intersection(mirrored)) / max(len(voxels), 1)))


def _pose_type(vectors: Dict[str, Vector], height: float):
    left = vectors.get("wrist_l"); right = vectors.get("wrist_r")
    shoulder_l = vectors.get("shoulder_l"); shoulder_r = vectors.get("shoulder_r")
    if not all((left, right, shoulder_l, shoulder_r)):
        return "unknown", 0.0
    drops = [shoulder_l.z - left.z, shoulder_r.z - right.z]
    lateral = [abs(left.x - shoulder_l.x), abs(right.x - shoulder_r.x)]
    mean_drop = sum(drops) * 0.5 / max(height, 1e-8)
    mean_lateral = sum(lateral) * 0.5 / max(height, 1e-8)
    if abs(mean_drop) < 0.05 and mean_lateral > 0.18:
        return "t_pose", 0.82
    if 0.05 <= mean_drop <= 0.22 and mean_lateral > 0.12:
        return "a_pose", 0.82
    return "relaxed_or_custom", 0.62


def _landmark(position: Vector, confidence: float, method: str):
    return {"position": vec(position), "confidence": float(max(0.0, min(1.0, confidence))), "method": method}


def _percentile(values: Sequence[float], factor: float, fallback: float = 0.0) -> float:
    if not values:
        return float(fallback)
    ordered = sorted(float(value) for value in values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * factor)))
    return ordered[index]


def _mean(points: Sequence[Vector], fallback: Vector) -> Vector:
    if not points:
        return fallback.copy()
    return sum(points, Vector((0.0, 0.0, 0.0))) / len(points)


def _side_points(points: Sequence[Vector], sign: float, center_x: float, width: float):
    return [
        point for point in points
        if sign * (point.x - center_x) >= width * 0.004
        and sign * (point.x - center_x) <= width * 0.42
    ]


def _refine_hand_endpoint(points: Sequence[Vector], shoulder: Vector, wrist: Vector,
                          rough_tip: Vector, sign: float, center_x: float,
                          width: float, height: float):
    side = _side_points(points, sign, center_x, width)
    radius = height * 0.17
    cloud = [point for point in side if (point - wrist).length <= radius]
    if len(cloud) < 10:
        return rough_tip.copy(), {"valid": False, "pointCount": len(cloud), "method": "rough-hand-tip-fallback"}

    direction = rough_tip - wrist
    if direction.length <= height * 0.02:
        direction = wrist - shoulder
    if direction.length <= 1e-8:
        direction = Vector((sign, 0.0, 0.0))
    direction.normalize()

    projected = [((point - wrist).dot(direction), point) for point in cloud]
    positive = [distance for distance, _point in projected if distance >= -height * 0.015]
    extent = _percentile(positive, 0.96, (rough_tip - wrist).length)
    if extent < height * 0.022:
        distances = [(point - wrist).length for point in cloud]
        threshold = _percentile(distances, 0.90, height * 0.03)
        cluster = [point for point in cloud if (point - wrist).length >= threshold]
    else:
        threshold = extent * 0.84
        cluster = [point for distance, point in projected if distance >= threshold]
    endpoint = _mean(cluster, rough_tip)
    if (endpoint - wrist).length < height * 0.02 or (endpoint - wrist).length > height * 0.19:
        endpoint = rough_tip.copy()
        valid = False
    else:
        valid = True
    return endpoint, {
        "valid": valid,
        "pointCount": len(cloud),
        "clusterCount": len(cluster),
        "extent": float((endpoint - wrist).length),
        "method": "side-mesh-distal-hand-cluster-v3.2" if valid else "rough-hand-tip-fallback",
    }


def _refine_foot_axis(points: Sequence[Vector], ankle: Vector, sign: float,
                      center_x: float, width: float, height: float):
    side = _side_points(points, sign, center_x, width)
    cloud = [
        point for point in side
        if point.z <= ankle.z + height * 0.075
        and point.z >= ankle.z - height * 0.105
        and Vector((point.x - ankle.x, point.y - ankle.y, 0.0)).length <= height * 0.18
    ]
    fallback_foot = ankle + Vector((0.0, -height * 0.060, -height * 0.012))
    fallback_ball = ankle + Vector((0.0, -height * 0.092, -height * 0.015))
    if len(cloud) < 12:
        return fallback_foot, fallback_ball, {
            "valid": False, "pointCount": len(cloud), "method": "front-axis-foot-fallback",
        }

    front_extent = ankle.y - min(point.y for point in cloud)
    back_extent = max(point.y for point in cloud) - ankle.y
    forward_sign = -1.0 if front_extent >= back_extent else 1.0
    coarse = Vector((0.0, forward_sign, 0.0))
    coarse_values = [(point - ankle).dot(coarse) for point in cloud]
    coarse_extent = _percentile([value for value in coarse_values if value >= 0.0], 0.94, 0.0)
    distal = [
        point for point, value in zip(cloud, coarse_values)
        if value >= max(coarse_extent * 0.78, height * 0.015)
    ]
    distal_center = _mean(distal, fallback_ball)
    axis = Vector((distal_center.x - ankle.x, distal_center.y - ankle.y, 0.0))
    if axis.length <= height * 0.012:
        axis = coarse
    axis.normalize()

    projections = [max(0.0, (point - ankle).dot(axis)) for point in cloud]
    length = _percentile(projections, 0.97, 0.0)
    if length < height * 0.028 or length > height * 0.20:
        return fallback_foot, fallback_ball, {
            "valid": False, "pointCount": len(cloud), "length": float(length),
            "method": "front-axis-foot-fallback",
        }

    def section(factor: float, fallback: Vector):
        target = length * factor
        band = max(length * 0.12, height * 0.008)
        selected = [
            point for point, projection in zip(cloud, projections)
            if abs(projection - target) <= band and point.z <= ankle.z + height * 0.035
        ]
        return _mean(selected, fallback), len(selected)

    foot, foot_count = section(0.48, ankle + axis * (length * 0.48))
    ball, ball_count = section(0.76, ankle + axis * (length * 0.76))
    if (ball - ankle).dot(axis) <= (foot - ankle).dot(axis):
        ball = ankle + axis * (length * 0.78)
    return foot, ball, {
        "valid": True,
        "pointCount": len(cloud),
        "footSectionCount": foot_count,
        "ballSectionCount": ball_count,
        "length": float(length),
        "axis": vec(axis),
        "method": "lower-mesh-longitudinal-foot-axis-v3.2",
    }


def analyze_body(meshes: Iterable[bpy.types.Object]):
    meshes = list(meshes)
    classifications = classify_meshes(meshes)
    anatomy_meshes = [obj for obj in meshes if classifications.get(obj.name) == "body"]
    if not anatomy_meshes:
        raise RuntimeError("Avatar Analyzer could not identify anatomical body geometry")
    detector = MeshLandmarkDetector(anatomy_meshes)
    raw, confidence = detector.detect()
    left = raw["sides"]["left"]
    right = raw["sides"]["right"]
    center = Vector((detector.center_x, detector.center_y, detector.base_z))
    body_points = [obj.matrix_world @ vertex.co for obj in anatomy_meshes for vertex in obj.data.vertices]

    hand_l, hand_l_evidence = _refine_hand_endpoint(
        body_points, left["shoulder"], left["wrist"], left["palmTip"],
        1.0, detector.center_x, detector.width, detector.height,
    )
    hand_r, hand_r_evidence = _refine_hand_endpoint(
        body_points, right["shoulder"], right["wrist"], right["palmTip"],
        -1.0, detector.center_x, detector.width, detector.height,
    )
    foot_l, ball_l, foot_l_evidence = _refine_foot_axis(
        body_points, left["ankle"], 1.0, detector.center_x, detector.width, detector.height,
    )
    foot_r, ball_r, foot_r_evidence = _refine_foot_axis(
        body_points, right["ankle"], -1.0, detector.center_x, detector.width, detector.height,
    )

    vectors: Dict[str, Vector] = {
        "root": center,
        "pelvis": raw["pelvis"],
        "spine_01": raw["lowerSpine"],
        "spine_02": raw["midSpine"],
        "chest": raw["chest"],
        "neck": raw["neckBase"],
        "skull_base": raw["skullBase"],
        "head_top": raw["headTop"],
        "head": raw["skullBase"].lerp(raw["headTop"], 0.52),
        "clavicle_l": raw["chest"].lerp(left["shoulder"], 0.45),
        "shoulder_l": left["shoulder"], "upperarm_l": left["shoulder"],
        "elbow_l": left["elbow"], "lowerarm_l": left["elbow"],
        "wrist_l": left["wrist"], "hand_l": hand_l,
        "hip_l": left["hip"], "thigh_l": left["hip"],
        "knee_l": left["knee"], "calf_l": left["knee"],
        "ankle_l": left["ankle"], "foot_l": foot_l, "ball_l": ball_l,
        "clavicle_r": raw["chest"].lerp(right["shoulder"], 0.45),
        "shoulder_r": right["shoulder"], "upperarm_r": right["shoulder"],
        "elbow_r": right["elbow"], "lowerarm_r": right["elbow"],
        "wrist_r": right["wrist"], "hand_r": hand_r,
        "hip_r": right["hip"], "thigh_r": right["hip"],
        "knee_r": right["knee"], "calf_r": right["knee"],
        "ankle_r": right["ankle"], "foot_r": foot_r, "ball_r": ball_r,
    }
    symmetry = _symmetry_score(body_points, detector.center_x, max(detector.width, detector.height))
    pose_type, pose_confidence = _pose_type(vectors, detector.height)
    conf_map = {
        "root": min(confidence.get("pelvis", 0.0), 0.9),
        "pelvis": confidence.get("pelvis", 0.0), "spine_01": confidence.get("spine", 0.0),
        "spine_02": confidence.get("spine", 0.0), "chest": confidence.get("chest", 0.0),
        "neck": confidence.get("neck", 0.0), "skull_base": confidence.get("skullBase", 0.0),
        "head_top": confidence.get("head", 0.0),
        "head": min(confidence.get("head", 0.0), confidence.get("skullBase", 0.0)),
    }
    for short, side, hand_evidence, foot_evidence in (
        ("l", "left", hand_l_evidence, foot_l_evidence),
        ("r", "right", hand_r_evidence, foot_r_evidence),
    ):
        side_conf = confidence.get(side, {})
        hand_factor = 0.95 if hand_evidence.get("valid") else 0.78
        foot_factor = 0.90 if foot_evidence.get("valid") else 0.66
        conf_map.update({
            f"clavicle_{short}": min(confidence.get("chest", 0.0), side_conf.get("shoulder", 0.0)),
            f"shoulder_{short}": side_conf.get("shoulder", 0.0), f"upperarm_{short}": side_conf.get("shoulder", 0.0),
            f"elbow_{short}": side_conf.get("arm", 0.0), f"lowerarm_{short}": side_conf.get("arm", 0.0),
            f"wrist_{short}": side_conf.get("wrist", 0.0), f"hand_{short}": side_conf.get("wrist", 0.0) * hand_factor,
            f"hip_{short}": side_conf.get("hip", 0.0), f"thigh_{short}": side_conf.get("hip", 0.0),
            f"knee_{short}": side_conf.get("knee", 0.0), f"calf_{short}": side_conf.get("knee", 0.0),
            f"ankle_{short}": side_conf.get("ankle", 0.0), f"foot_{short}": side_conf.get("ankle", 0.0) * foot_factor,
            f"ball_{short}": side_conf.get("ankle", 0.0) * foot_factor * 0.92,
        })
    methods = {
        "hand_l": hand_l_evidence["method"], "hand_r": hand_r_evidence["method"],
        "foot_l": foot_l_evidence["method"], "ball_l": foot_l_evidence["method"],
        "foot_r": foot_r_evidence["method"], "ball_r": foot_r_evidence["method"],
    }
    landmarks = {
        name: _landmark(position, conf_map.get(name, 0.45), methods.get(name, "cross-section-width-plus-limb-axis-v16-candidate"))
        for name, position in vectors.items()
    }
    essential = [
        "pelvis", "neck", "head", "shoulder_l", "shoulder_r", "elbow_l", "elbow_r",
        "wrist_l", "wrist_r", "hip_l", "hip_r", "knee_l", "knee_r", "ankle_l", "ankle_r",
    ]
    humanoid_confidence = sum(landmarks[name]["confidence"] for name in essential) / len(essential)
    humanoid_confidence *= 0.70 + symmetry * 0.30
    return {
        "dimensions": {
            "height": detector.height, "width": detector.width, "depth": detector.depth,
            "boundingBoxMin": vec(detector.minimum), "boundingBoxMax": vec(detector.maximum),
            "center": [detector.center_x, detector.center_y, detector.base_z + detector.height * 0.5],
            "detectedUnit": "scene-unit", "sceneScaleLength": float(bpy.context.scene.unit_settings.scale_length or 1.0),
        },
        "orientation": {
            "upAxis": "Z", "frontAxis": "-Y", "confidence": 0.72,
            "requiresOrientationReview": False, "method": "normalized-mesh-convention-plus-extremity-geometry-v3.2",
        },
        "symmetry": {"axis": "X", "score": symmetry, "method": "mirrored-voxel-overlap"},
        "pose": {"type": pose_type, "confidence": pose_confidence},
        "isHumanoid": humanoid_confidence >= 0.45,
        "humanoidConfidence": humanoid_confidence,
        "meshClassifications": classifications,
        "meshClassCounts": dict(Counter(classifications.values())),
        "landmarks": landmarks,
        "rawConfidence": confidence,
        "extremityGeometry": {
            "leftHand": hand_l_evidence, "rightHand": hand_r_evidence,
            "leftFoot": foot_l_evidence, "rightFoot": foot_r_evidence,
        },
    }, vectors, classifications
