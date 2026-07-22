"""Face analysis restricted to the segmented head geometry."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List

import bpy
from mathutils import Vector

from landmark_projector_3d import project_candidates
from ray_triangulator import triangulate_landmark


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _internal(item: dict):
    value = item.get("internalJointPosition") or item.get("position")
    return Vector(tuple(float(component) for component in value))


def _group(projected):
    grouped = defaultdict(list)
    for candidate in projected:
        name = str(candidate.get("name") or "")
        if name:
            grouped[name].append(candidate)
    return grouped


def _ear_landmarks(segmentation, body_vectors: Dict[str, Vector], body_width: float):
    skull = body_vectors["skull_base"]
    top = body_vectors["head_top"]
    head_height = max((top - skull).length, 1e-5)
    low = skull.z + head_height * 0.28
    high = skull.z + head_height * 0.76
    center_x = body_vectors["head"].x
    points = [point for point in segmentation.region_points("head") if low <= point.z <= high]
    output = {}
    warnings = []
    for side, suffix, sign in (("left", "l", 1.0), ("right", "r", -1.0)):
        side_points = [point for point in points if sign * (point.x - center_x) > 0.0]
        if not side_points:
            warnings.append({"code": "EAR_REGION_EMPTY", "side": side})
            continue
        max_lateral = max(sign * (point.x - center_x) for point in side_points)
        threshold = max_lateral - max(body_width * 0.035, head_height * 0.055)
        cluster = [point for point in side_points if sign * (point.x - center_x) >= threshold]
        if len(cluster) < 8:
            warnings.append({"code": "EAR_GEOMETRY_INSUFFICIENT", "side": side, "vertices": len(cluster)})
            continue
        center = sum(cluster, Vector((0.0, 0.0, 0.0))) / len(cluster)
        values = {
            "center": center,
            "top": max(cluster, key=lambda point: point.z),
            "bottom": min(cluster, key=lambda point: point.z),
            "front": min(cluster, key=lambda point: point.y),
            "back": max(cluster, key=lambda point: point.y),
        }
        confidence = min(0.88, 0.46 + len(cluster) / 260.0)
        for label, point in values.items():
            name = f"ear_{suffix}_{label}"
            output[name] = {
                "name": name,
                "position": _vec(point),
                "internalJointPosition": _vec(point),
                "surfaceDisplayPosition": _vec(point),
                "displayPosition": _vec(point),
                "region": "head",
                "surfaceRegion": "head",
                "landmarkType": "surface",
                "accepted": confidence >= 0.58,
                "verified": confidence >= 0.58,
                "display": confidence >= 0.58,
                "confidence": float(confidence),
                "visualConfidence": 0.0,
                "triangulationConfidence": 0.0,
                "geometryConfidence": float(confidence),
                "topologyConfidence": 0.80,
                "viewsConfirmed": 1,
                "methods": ["segmented_head_lateral_silhouette", "ear_cluster_extrema"],
                "method": "segmented-ear-geometry-v2",
                "rejectionReasons": [] if confidence >= 0.58 else ["EAR_GEOMETRY_CONFIDENCE_LOW"],
            }
    return output, warnings


def _eye_rotation_centers(meshes: Iterable[bpy.types.Object], classifications: Dict[str, str]):
    eyes = []
    for obj in meshes:
        if classifications.get(obj.name) != "eyes" or not len(obj.data.vertices):
            continue
        points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        center = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
        eyes.append((center.x, center, obj.name))
    if len(eyes) < 2:
        return {}
    eyes.sort(key=lambda item: item[0], reverse=True)  # subject-left is +X
    result = {}
    for suffix, (_x, center, object_name) in zip(("l", "r"), eyes[:2]):
        name = f"eye_{suffix}_rotation_center"
        result[name] = {
            "name": name,
            "position": _vec(center),
            "internalJointPosition": _vec(center),
            "region": "head",
            "landmarkType": "internal_joint",
            "accepted": True,
            "verified": True,
            "display": False,
            "confidence": 0.90,
            "viewsConfirmed": 0,
            "sourceObject": object_name,
            "methods": ["separate_eye_object_centroid"],
            "method": "separate-eye-rotation-center-v2",
            "rejectionReasons": [],
        }
    return result


def _validate(landmarks: Dict[str, dict]):
    warnings = []
    required_order = ["forehead_center", "nose_tip", "mouth_center", "chin"]
    present = [name for name in required_order if name in landmarks and landmarks[name].get("accepted", False)]
    for above, below in zip(present, present[1:]):
        if _internal(landmarks[above]).z <= _internal(landmarks[below]).z:
            for name in (above, below):
                landmarks[name]["accepted"] = False
                landmarks[name]["verified"] = False
                landmarks[name]["display"] = False
                landmarks[name]["confidence"] = min(float(landmarks[name].get("confidence", 0.0)), 0.39)
                landmarks[name].setdefault("rejectionReasons", []).append("FACE_VERTICAL_ORDER_INVALID")
            warnings.append({"code": "FACE_VERTICAL_ORDER_INVALID", "above": above, "below": below})
    for left, right, label in (
        ("eye_l_inner", "eye_r_inner", "eyes"),
        ("mouth_corner_l", "mouth_corner_r", "mouth"),
        ("ear_l_center", "ear_r_center", "ears"),
    ):
        if all(name in landmarks and landmarks[name].get("accepted", False) for name in (left, right)):
            if abs(_internal(landmarks[left]).x - _internal(landmarks[right]).x) <= 1e-5:
                warnings.append({"code": f"{label.upper()}_SEPARATION_INVALID"})
                for name in (left, right):
                    landmarks[name]["accepted"] = False
                    landmarks[name]["display"] = False
                    landmarks[name]["verified"] = False
                    landmarks[name]["confidence"] = min(float(landmarks[name].get("confidence", 0.0)), 0.39)
    return warnings


def analyze_face(detector_output: dict, manifest: dict, meshes: Iterable[bpy.types.Object],
                 classifications: Dict[str, str], body_vectors: Dict[str, Vector],
                 body_width: float, segmentation):
    meshes = list(meshes)
    face_output = {
        **detector_output,
        "views": [item for item in detector_output.get("views", []) if item.get("region") == "face"],
    }
    projected, projection_failures = project_candidates(face_output, manifest, classifications)
    grouped = _group(projected)
    head_scale = max((body_vectors["head_top"] - body_vectors["skull_base"]).length, 1e-5)
    landmarks = {}
    for name, candidates in grouped.items():
        landmarks[name] = triangulate_landmark(
            name,
            candidates,
            segmentation,
            "head",
            head_scale,
            minimum_views=2,
            preferred_view_tokens=("face_front", "three_quarter"),
        )
        landmarks[name]["landmarkType"] = "surface"

    ears, ear_warnings = _ear_landmarks(segmentation, body_vectors, body_width)
    landmarks.update(ears)
    landmarks.update(_eye_rotation_centers(meshes, classifications))
    warnings = list(projection_failures) + ear_warnings + _validate(landmarks)
    required = [
        "eye_l_inner", "eye_l_outer", "eye_r_inner", "eye_r_outer",
        "nose_tip", "nose_base", "mouth_corner_l", "mouth_corner_r",
        "upper_lip_center", "lower_lip_center", "chin", "ear_l_center", "ear_r_center",
    ]
    missing_or_rejected = [
        name for name in required
        if name not in landmarks or not landmarks[name].get("accepted", False)
    ]
    if missing_or_rejected:
        status = "needs_review"
        warnings.append({"code": "FACE_REQUIRED_LANDMARKS_NOT_VERIFIED", "landmarks": missing_or_rejected})
    elif warnings:
        status = "valid_with_warnings"
    else:
        status = "valid"
    return {
        "status": status,
        "landmarks": landmarks,
        "projectedCandidates": projected,
        "triangulatedLandmarks": sum(1 for item in landmarks.values() if item.get("internalJointPosition")),
        "acceptedLandmarks": sum(1 for item in landmarks.values() if item.get("accepted", False)),
        "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
        "warnings": warnings,
        "viewsDetected": len(face_output.get("views", [])),
        "method": "mediapipe-face-plus-segmented-head-ray-triangulation-v2",
    }
