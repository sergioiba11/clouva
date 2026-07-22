"""Build a selectable GLB overlay for Avatar Analyzer diagnostics."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable

import bpy
from mathutils import Vector

BODY_EDGES = [
    ("root", "pelvis"), ("pelvis", "spine_01"), ("spine_01", "spine_02"),
    ("spine_02", "chest"), ("chest", "neck"), ("neck", "skull_base"),
    ("skull_base", "head_top"),
    ("chest", "shoulder_l"), ("shoulder_l", "elbow_l"), ("elbow_l", "wrist_l"),
    ("wrist_l", "hand_l"), ("chest", "shoulder_r"), ("shoulder_r", "elbow_r"),
    ("elbow_r", "wrist_r"), ("wrist_r", "hand_r"),
    ("pelvis", "hip_l"), ("hip_l", "knee_l"), ("knee_l", "ankle_l"),
    ("ankle_l", "foot_l"), ("pelvis", "hip_r"), ("hip_r", "knee_r"),
    ("knee_r", "ankle_r"), ("ankle_r", "foot_r"),
]

FACE_EDGES = [
    ("eye_l_inner", "eye_l_upper"), ("eye_l_upper", "eye_l_outer"),
    ("eye_l_outer", "eye_l_lower"), ("eye_l_lower", "eye_l_inner"),
    ("eye_r_inner", "eye_r_upper"), ("eye_r_upper", "eye_r_outer"),
    ("eye_r_outer", "eye_r_lower"), ("eye_r_lower", "eye_r_inner"),
    ("nose_bridge_top", "nose_bridge_mid"), ("nose_bridge_mid", "nose_tip"),
    ("nose_tip", "nose_base"), ("mouth_corner_r", "upper_lip_center"),
    ("upper_lip_center", "mouth_corner_l"), ("mouth_corner_l", "lower_lip_center"),
    ("lower_lip_center", "mouth_corner_r"), ("jaw_r", "chin"), ("chin", "jaw_l"),
    ("ear_l_top", "ear_l_center"), ("ear_l_center", "ear_l_bottom"),
    ("ear_r_top", "ear_r_center"), ("ear_r_center", "ear_r_bottom"),
]


def _point(item: dict, display: bool = False):
    key = "displayPosition" if display and item.get("displayPosition") else "position"
    return Vector(tuple(float(value) for value in item[key]))


def _material(name: str, rgba):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = rgba
    return material


def _confidence_material(confidence: float):
    if confidence >= 0.85:
        return _material("CLOUVA_CONFIDENCE_HIGH", (0.22, 0.85, 0.44, 1.0))
    if confidence >= 0.65:
        return _material("CLOUVA_CONFIDENCE_ACCEPTABLE", (0.95, 0.72, 0.18, 1.0))
    if confidence >= 0.40:
        return _material("CLOUVA_CONFIDENCE_LOW", (0.95, 0.36, 0.10, 1.0))
    return _material("CLOUVA_CONFIDENCE_INVALID", (0.85, 0.08, 0.12, 1.0))


def _marker(name: str, item: dict, radius: float):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=_point(item, display=True))
    obj = bpy.context.object
    obj.name = f"LM_{name}"
    obj.data.name = f"LM_MESH_{name}"
    confidence = float(item.get("confidence", item.get("finalConfidence", 0.0)))
    obj.data.materials.append(_confidence_material(confidence))
    obj["clouva_landmark"] = name
    obj["confidence"] = confidence
    obj["method"] = str(item.get("method") or item.get("surfaceMethod") or "unknown")
    obj["views_confirmed"] = int(item.get("viewsConfirmed") or 0)
    obj["diagnostic_layer"] = _layer(name)
    obj["verified"] = bool(item.get("verified", False))
    obj["landmark_type"] = str(item.get("landmarkType") or "unknown")
    if item.get("internalPosition"):
        obj["internal_position"] = list(item["internalPosition"])
    return obj


def _layer(name: str):
    if name.startswith(("thumb_", "index_", "middle_", "ring_", "pinky_")):
        return "fingers"
    if name.startswith(("palm_", "wrist_")):
        return "hands"
    if name.startswith("eye_"):
        return "eyes"
    if name.startswith("nose_") or name.startswith("nostril_"):
        return "nose"
    if name.startswith(("mouth_", "upper_lip", "lower_lip")):
        return "mouth"
    if name.startswith("ear_"):
        return "ears"
    if name in {"chin", "jaw_l", "jaw_r", "cheek_l", "cheek_r", "forehead_center"}:
        return "face"
    return "body"


def _edge(name: str, start: Vector, end: Vector, radius: float):
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 1
    curve_data.bevel_depth = radius
    curve_data.bevel_resolution = 1
    spline = curve_data.splines.new("POLY")
    spline.points.add(1)
    spline.points[0].co = (*start, 1.0)
    spline.points[1].co = (*end, 1.0)
    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    curve_data.materials.append(_material("CLOUVA_DIAGNOSTIC_EDGE", (0.48, 0.20, 0.95, 1.0)))
    obj["diagnostic_edge"] = True
    return obj


def _finger_edges(landmarks: Dict[str, dict]):
    edges = []
    for suffix in ("l", "r"):
        wrist = f"wrist_{suffix}"
        for finger in ("thumb", "index", "middle", "ring", "pinky"):
            chain = [
                wrist,
                f"{finger}_01_{suffix}",
                f"{finger}_02_{suffix}",
                f"{finger}_03_{suffix}",
                f"{finger}_tip_{suffix}",
            ]
            edges.extend(zip(chain, chain[1:]))
    return edges


def _visible(landmarks: Dict[str, dict], name: str):
    item = landmarks.get(name)
    return bool(
        isinstance(item, dict)
        and "position" in item
        and item.get("display", False)
        and item.get("verified", False)
        and float(item.get("confidence", 0.0)) >= 0.40
    )


def build_diagnostic_glb(output_path: Path, avatar_meshes: Iterable[bpy.types.Object],
                          landmarks: Dict[str, dict], body_height: float):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    marker_radius = max(body_height * 0.006, 0.002)
    edge_radius = marker_radius * 0.24
    diagnostic_objects = []

    for name, item in landmarks.items():
        if not _visible(landmarks, name):
            continue
        diagnostic_objects.append(_marker(name, item, marker_radius))

    # Body skeleton-center estimates stay in JSON and are not drawn as surface
    # lines. Face and finger edges are drawn only if both endpoints survived the
    # strict multiview + anatomical validation.
    for start_name, end_name in [*FACE_EDGES, *_finger_edges(landmarks)]:
        if not _visible(landmarks, start_name) or not _visible(landmarks, end_name):
            continue
        diagnostic_objects.append(_edge(
            f"EDGE_{start_name}__{end_name}",
            _point(landmarks[start_name], display=True),
            _point(landmarks[end_name], display=True),
            edge_radius,
        ))

    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for obj in [*avatar_meshes, *diagnostic_objects]:
        if obj.name in bpy.context.scene.objects:
            obj.select_set(True)
            selected.append(obj)
    if not selected:
        raise RuntimeError("Diagnostic GLB has no selectable objects")
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_apply=False,
        export_extras=True,
    )
    if not output_path.is_file() or output_path.stat().st_size < 1024:
        raise RuntimeError("Blender did not generate diagnostic_landmarks.glb")
    return {
        "path": str(output_path),
        "landmarkObjects": sum(1 for obj in diagnostic_objects if obj.name.startswith("LM_")),
        "edgeObjects": sum(1 for obj in diagnostic_objects if obj.name.startswith("EDGE_")),
        "hiddenLandmarks": sum(
            1 for name, item in landmarks.items()
            if isinstance(item, dict) and "position" in item and not _visible(landmarks, name)
        ),
        "layers": sorted({_layer(name) for name in landmarks if _visible(landmarks, name)}),
        "surfaceOnly": True,
    }
