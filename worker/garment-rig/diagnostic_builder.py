"""Build a selectable GLB diagnostic scene without modifying the source avatar."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable

import bpy
from mathutils import Vector

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

DIAGNOSTIC_BONE_CHAINS = [
    ("root", "pelvis"), ("pelvis", "spine_01"), ("spine_01", "spine_02"),
    ("spine_02", "chest"), ("chest", "neck"), ("neck", "skull_base"),
    ("skull_base", "head_top"),
    ("chest", "clavicle_l"), ("clavicle_l", "shoulder_l"),
    ("shoulder_l", "elbow_l"), ("elbow_l", "wrist_l"), ("wrist_l", "hand_l"),
    ("chest", "clavicle_r"), ("clavicle_r", "shoulder_r"),
    ("shoulder_r", "elbow_r"), ("elbow_r", "wrist_r"), ("wrist_r", "hand_r"),
    ("pelvis", "hip_l"), ("hip_l", "knee_l"), ("knee_l", "ankle_l"), ("ankle_l", "foot_l"),
    ("pelvis", "hip_r"), ("hip_r", "knee_r"), ("knee_r", "ankle_r"), ("ankle_r", "foot_r"),
]

APPROVED_STATES = {
    "verified_visual_geometry", "verified_geometry_fallback",
    "verified_single_view_depth", "manually_corrected",
}


def _position(item: dict, display: bool = True):
    landmark_type = str(item.get("landmarkType") or item.get("landmark_type") or "")
    if landmark_type in {"internal_joint", "derived_internal"} and item.get("internalJointPosition"):
        key = "internalJointPosition"
    else:
        key = "surfaceDisplayPosition" if display and item.get("surfaceDisplayPosition") else (
        "displayPosition" if display and item.get("displayPosition") else "position"
        )
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


def _marker_material(item: dict):
    state = str(item.get("state") or item.get("validationState") or "")
    landmark_type = str(item.get("landmarkType") or item.get("landmark_type") or "")
    if state == "manually_corrected" or item.get("manual_verified"):
        return _material("CLOUVA_MANUAL_CORRECTION", (1.0, 1.0, 1.0, 1.0))
    if state and state not in APPROVED_STATES:
        return _material("CLOUVA_REJECTED", (1.0, 0.08, 0.18, 1.0))
    if landmark_type in {"internal_joint", "derived_internal"}:
        return _material("CLOUVA_INTERNAL_JOINT", (0.18, 0.62, 1.0, 1.0))
    if state == "verified_geometry_fallback":
        return _material("CLOUVA_GEOMETRY_FALLBACK", (1.0, 0.68, 0.12, 1.0))
    return _confidence_material(float(item.get("final_confidence", item.get("confidence", 0.0))))


def _layer(name: str, item: dict | None = None):
    item = item or {}
    state = str(item.get("state") or item.get("validationState") or "")
    landmark_type = str(item.get("landmarkType") or item.get("landmark_type") or "")
    if state == "manually_corrected" or item.get("manual_verified"):
        return "manual_corrections"
    if state and state not in APPROVED_STATES:
        return "rejected_landmarks"
    if landmark_type in {"internal_joint", "derived_internal"}:
        return "internal_joints"
    if name.endswith("_l") and name.startswith(("thumb_", "index_", "middle_", "ring_", "pinky_", "wrist_", "palm_")):
        return "left_hand"
    if name.endswith("_r") and name.startswith(("thumb_", "index_", "middle_", "ring_", "pinky_", "wrist_", "palm_")):
        return "right_hand"
    if name.startswith("eye_"):
        return "face_eyes"
    if name.startswith(("nose_", "nostril_")):
        return "face_nose"
    if name.startswith(("mouth_", "upper_lip", "lower_lip")):
        return "face_mouth"
    if name.startswith("ear_"):
        return "face_ears"
    if name in {"chin", "jaw_l", "jaw_r", "cheek_l", "cheek_r", "forehead_center", "temple_l", "temple_r"}:
        return "face"
    return "verified_surface"


def _visible(item: dict, include_all_states: bool = False):
    if include_all_states:
        return bool(isinstance(item, dict) and "position" in item)
    return bool(
        isinstance(item, dict)
        and "position" in item
        and item.get("accepted", item.get("verified", False))
        and item.get("display", False)
        and float(item.get("confidence", 0.0)) >= 0.40
        and item.get("landmarkType") != "derived_internal"
    )


def _marker(name: str, item: dict, radius: float):
    state = str(item.get("state") or item.get("validationState") or "")
    landmark_type = str(item.get("landmarkType") or item.get("landmark_type") or "")
    marker_radius = radius
    if state and state not in APPROVED_STATES:
        marker_radius *= 0.82
    elif landmark_type in {"internal_joint", "derived_internal"}:
        marker_radius *= 0.72
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=marker_radius, location=_position(item))
    obj = bpy.context.object
    obj.name = f"LM_{name}"
    obj.data.name = f"LM_MESH_{name}"
    confidence = float(item.get("final_confidence", item.get("confidence", 0.0)))
    obj.data.materials.append(_marker_material(item))
    obj["clouva_landmark"] = name
    obj["landmark_name"] = name
    obj["region"] = str(item.get("region") or "unknown")
    obj["surface_region"] = str(item.get("surfaceRegion") or "unknown")
    obj["landmark_type"] = str(item.get("landmarkType") or "unknown")
    obj["accepted"] = bool(item.get("accepted", False))
    obj["confidence"] = confidence
    obj["method"] = str(item.get("method") or "unknown")
    obj["methods"] = list(item.get("methods") or [])
    obj["views_confirmed"] = int(item.get("viewsConfirmed") or 0)
    obj["diagnostic_layer"] = _layer(name, item)
    obj["validation_state"] = state or "legacy"
    obj["blocking"] = bool(item.get("blocking", state not in APPROVED_STATES if state else False))
    obj["rejection_reasons"] = list(item.get("rejectionReasons") or [])
    if item.get("internalJointPosition"):
        obj["internal_joint_position"] = list(item["internalJointPosition"])
    if item.get("surfaceDisplayPosition"):
        obj["surface_display_position"] = list(item["surfaceDisplayPosition"])
    return obj


def _edge(name: str, start: Vector, end: Vector, radius: float, layer: str):
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
    obj["diagnostic_layer"] = layer
    return obj


def _finger_edges(landmarks: Dict[str, dict]):
    edges = []
    for suffix in ("l", "r"):
        wrist = f"wrist_{suffix}"
        for finger in ("thumb", "index", "middle", "ring", "pinky"):
            chain = [
                wrist,
                f"{finger}_01_{suffix}", f"{finger}_02_{suffix}",
                f"{finger}_03_{suffix}", f"{finger}_tip_{suffix}",
            ]
            edges.extend(zip(chain, chain[1:]))
    return edges


def build_diagnostic_glb(output_path: Path, avatar_meshes: Iterable[bpy.types.Object],
                         landmarks: Dict[str, dict], body_height: float,
                         include_all_states: bool = False):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    marker_radius = max(body_height * 0.006, 0.002)
    edge_radius = marker_radius * 0.24
    diagnostic_objects = []
    accepted_names = []
    duplicate_names = []
    occupied = {}
    quantization = max(marker_radius * 0.18, 1e-6)

    for name, item in landmarks.items():
        if not _visible(item, include_all_states):
            continue
        point = _position(item)
        key = tuple(round(float(component) / quantization) for component in point)
        if key in occupied and not include_all_states:
            duplicate_names.append(name)
            item["display"] = False
            item.setdefault("rejectionReasons", []).append(f"DISPLAY_DUPLICATE_OF:{occupied[key]}")
            continue
        occupied[key] = name
        accepted_names.append(name)
        diagnostic_objects.append(_marker(name, item, marker_radius))

    accepted_set = set(accepted_names)
    for start_name, end_name in [*DIAGNOSTIC_BONE_CHAINS, *FACE_EDGES, *_finger_edges(landmarks)]:
        if start_name not in accepted_set or end_name not in accepted_set:
            continue
        start = landmarks[start_name]
        end = landmarks[end_name]
        if _layer(start_name, start) != _layer(end_name, end) and not (
            _layer(start_name, start).startswith("face") and _layer(end_name, end).startswith("face")
        ) and not (
            _layer(start_name, start) == "internal_joints" or _layer(end_name, end) == "internal_joints"
        ):
            continue
        diagnostic_objects.append(_edge(
            f"EDGE_{start_name}__{end_name}",
            _position(start),
            _position(end),
            edge_radius,
            "bone_chains" if (start_name, end_name) in DIAGNOSTIC_BONE_CHAINS else _layer(start_name, start),
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

    records = [item for item in landmarks.values() if isinstance(item, dict) and "position" in item]
    return {
        "path": str(output_path),
        "landmarkObjects": sum(1 for obj in diagnostic_objects if obj.name.startswith("LM_")),
        "edgeObjects": sum(1 for obj in diagnostic_objects if obj.name.startswith("EDGE_")),
        "verifiedSurfaceLandmarks": len(accepted_names),
        "duplicateLandmarksHidden": len(duplicate_names),
        "duplicateNames": duplicate_names,
        "rejectedLandmarkObjects": sum(
            1 for item in records
            if str(item.get("state") or "") and str(item.get("state")) not in APPROVED_STATES
        ) if include_all_states else 0,
        "invalidLandmarksHidden": 0 if include_all_states else sum(
            1 for item in records if not item.get("accepted", False)
        ),
        "internalJointCount": sum(1 for item in records if item.get("landmarkType") in {"internal_joint", "derived_internal"}),
        "hiddenLandmarks": sum(1 for item in records if not item.get("display", False)),
        "layers": sorted({_layer(name, landmarks[name]) for name in accepted_names}),
        "surfaceOnly": not include_all_states,
        "internalSkeletonStoredInJson": True,
        "internalSkeletonExported": include_all_states,
        "rejectedEvidenceExported": include_all_states,
    }
