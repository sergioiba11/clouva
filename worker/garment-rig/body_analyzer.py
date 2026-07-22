"""Geometry-only body analysis for CLOUVA Avatar Analyzer V2."""
from __future__ import annotations

from collections import Counter
from typing import Dict, Iterable, List, Tuple

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
    """Classify only explicit or spatially connected anatomy as body.

    Unresolved geometry is rejected instead of being silently accepted by ray
    casting. Separate body components are allowed only when their bounds touch
    the main body volume; small paired round objects near the head become eyes.
    """
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
        "wrist_l": left["wrist"], "hand_l": left["palmTip"],
        "hip_l": left["hip"], "thigh_l": left["hip"],
        "knee_l": left["knee"], "calf_l": left["knee"],
        "ankle_l": left["ankle"],
        "foot_l": left["ankle"] + Vector((0.0, -detector.height * 0.065, -detector.height * 0.015)),
        "ball_l": left["ankle"] + Vector((0.0, -detector.height * 0.095, -detector.height * 0.018)),
        "clavicle_r": raw["chest"].lerp(right["shoulder"], 0.45),
        "shoulder_r": right["shoulder"], "upperarm_r": right["shoulder"],
        "elbow_r": right["elbow"], "lowerarm_r": right["elbow"],
        "wrist_r": right["wrist"], "hand_r": right["palmTip"],
        "hip_r": right["hip"], "thigh_r": right["hip"],
        "knee_r": right["knee"], "calf_r": right["knee"],
        "ankle_r": right["ankle"],
        "foot_r": right["ankle"] + Vector((0.0, -detector.height * 0.065, -detector.height * 0.015)),
        "ball_r": right["ankle"] + Vector((0.0, -detector.height * 0.095, -detector.height * 0.018)),
    }
    body_points = [obj.matrix_world @ vertex.co for obj in anatomy_meshes for vertex in obj.data.vertices]
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
    for short, side in (("l", "left"), ("r", "right")):
        side_conf = confidence.get(side, {})
        conf_map.update({
            f"clavicle_{short}": min(confidence.get("chest", 0.0), side_conf.get("shoulder", 0.0)),
            f"shoulder_{short}": side_conf.get("shoulder", 0.0), f"upperarm_{short}": side_conf.get("shoulder", 0.0),
            f"elbow_{short}": side_conf.get("arm", 0.0), f"lowerarm_{short}": side_conf.get("arm", 0.0),
            f"wrist_{short}": side_conf.get("wrist", 0.0), f"hand_{short}": side_conf.get("wrist", 0.0) * 0.9,
            f"hip_{short}": side_conf.get("hip", 0.0), f"thigh_{short}": side_conf.get("hip", 0.0),
            f"knee_{short}": side_conf.get("knee", 0.0), f"calf_{short}": side_conf.get("knee", 0.0),
            f"ankle_{short}": side_conf.get("ankle", 0.0), f"foot_{short}": side_conf.get("ankle", 0.0) * 0.72,
            f"ball_{short}": side_conf.get("ankle", 0.0) * 0.62,
        })
    landmarks = {
        name: _landmark(position, conf_map.get(name, 0.45), "cross-section-width-plus-limb-axis-v16-candidate")
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
            "upAxis": "Z", "frontAxis": "-Y", "confidence": 0.58,
            "requiresOrientationReview": True, "method": "mesh-convention-plus-depth-asymmetry-phase1",
        },
        "symmetry": {"axis": "X", "score": symmetry, "method": "mirrored-voxel-overlap"},
        "pose": {"type": pose_type, "confidence": pose_confidence},
        "isHumanoid": humanoid_confidence >= 0.45,
        "humanoidConfidence": humanoid_confidence,
        "meshClassifications": classifications,
        "meshClassCounts": dict(Counter(classifications.values())),
        "landmarks": landmarks,
        "rawConfidence": confidence,
    }, vectors, classifications
