"""Face-specific projection, fusion, ear geometry and validation."""
from __future__ import annotations

from typing import Dict, Iterable, List

import bpy
from mathutils import Vector

from landmark_fusion import apply_anatomical_confidence, fuse_projected
from landmark_projector_3d import project_candidates


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _point(item: dict):
    return Vector(tuple(float(value) for value in item["position"]))


def _body_vertices(meshes, classifications):
    selected = [
        obj for obj in meshes
        if classifications.get(obj.name) in {"body", "unknown"}
    ]
    for obj in selected:
        for vertex in obj.data.vertices:
            yield obj.matrix_world @ vertex.co


def _ear_landmarks(meshes, classifications, body_vectors, body_width: float):
    skull = body_vectors["skull_base"]
    top = body_vectors["head_top"]
    head_height = max((top - skull).length, 1e-5)
    low = skull.z + head_height * 0.30
    high = skull.z + head_height * 0.74
    center_x = body_vectors["head"].x
    center_y = body_vectors["head"].y
    points = [point for point in _body_vertices(meshes, classifications) if low <= point.z <= high]
    output = {}
    diagnostics = []
    for side, suffix, sign in (("left", "l", 1.0), ("right", "r", -1.0)):
        side_points = [point for point in points if sign * (point.x - center_x) > 0.0]
        laterals = [sign * (point.x - center_x) for point in side_points]
        if not laterals:
            diagnostics.append({"code": "EAR_REGION_EMPTY", "side": side})
            continue
        max_lateral = max(laterals)
        threshold = max_lateral - max(body_width * 0.035, head_height * 0.06)
        cluster = [
            point for point in side_points
            if sign * (point.x - center_x) >= threshold
        ]
        if len(cluster) < 8:
            diagnostics.append({"code": "EAR_GEOMETRY_INSUFFICIENT", "side": side, "vertices": len(cluster)})
            continue
        center = sum(cluster, Vector((0.0, 0.0, 0.0))) / len(cluster)
        top_point = max(cluster, key=lambda value: value.z)
        bottom_point = min(cluster, key=lambda value: value.z)
        # Front is -Y in the current canonical convention.
        front_point = min(cluster, key=lambda value: value.y)
        back_point = max(cluster, key=lambda value: value.y)
        confidence = min(0.86, 0.38 + len(cluster) / 240.0)
        for label, point in {
            "center": center,
            "top": top_point,
            "bottom": bottom_point,
            "front": front_point,
            "back": back_point,
        }.items():
            output[f"ear_{suffix}_{label}"] = {
                "position": _vec(point),
                "confidence": confidence,
                "visualConfidence": 0.0,
                "geometryConfidence": confidence,
                "multiviewConfidence": 0.5,
                "anatomicalConfidence": 0.76,
                "finalConfidence": confidence,
                "viewsConfirmed": 1,
                "method": "profile-silhouette-curvature-region-v1",
            }
    return output, diagnostics


def _validate(landmarks: Dict[str, dict]):
    warnings = []
    anatomical = {name: 0.82 for name in landmarks}

    pairs = [
        ("eye_l_inner", "eye_r_inner", "eyes"),
        ("mouth_corner_l", "mouth_corner_r", "mouth"),
        ("ear_l_center", "ear_r_center", "ears"),
    ]
    for left, right, label in pairs:
        if left in landmarks and right in landmarks:
            separation = abs(_point(landmarks[left]).x - _point(landmarks[right]).x)
            if separation <= 1e-5:
                warnings.append({"code": f"{label.upper()}_SEPARATION_INVALID"})
                anatomical[left] = anatomical[right] = 0.2

    required_order = ["forehead_center", "nose_tip", "mouth_center", "chin"]
    present = [name for name in required_order if name in landmarks]
    for first, second in zip(present, present[1:]):
        if _point(landmarks[first]).z <= _point(landmarks[second]).z:
            warnings.append({"code": "FACE_VERTICAL_ORDER_INVALID", "above": first, "below": second})
            anatomical[first] = min(anatomical[first], 0.35)
            anatomical[second] = min(anatomical[second], 0.35)

    if "nose_tip" in landmarks and "mouth_center" in landmarks:
        if _point(landmarks["nose_tip"]).z <= _point(landmarks["mouth_center"]).z:
            warnings.append({"code": "NOSE_NOT_ABOVE_MOUTH"})
            anatomical["nose_tip"] = anatomical["mouth_center"] = 0.25

    for name, score in anatomical.items():
        apply_anatomical_confidence(landmarks[name], score)
    return warnings


def analyze_face(detector_output: dict, manifest: dict, meshes: Iterable[bpy.types.Object],
                 classifications: Dict[str, str], body_vectors: Dict[str, Vector],
                 body_width: float):
    meshes = list(meshes)
    face_output = {
        **detector_output,
        "views": [item for item in detector_output.get("views", []) if item.get("region") == "face"],
    }
    projected, projection_failures = project_candidates(face_output, manifest, classifications)
    head_scale = max((body_vectors["head_top"] - body_vectors["skull_base"]).length, 1e-5)
    landmarks = fuse_projected(projected, head_scale, minimum_views=2, tolerance_ratio=0.085)

    # Derive centers only when the dense detector did not return an iris center.
    for side in ("l", "r"):
        center_name = f"eye_{side}_center"
        inner = landmarks.get(f"eye_{side}_inner")
        outer = landmarks.get(f"eye_{side}_outer")
        if center_name not in landmarks and inner and outer:
            point = _point(inner).lerp(_point(outer), 0.5)
            confidence = min(inner["confidence"], outer["confidence"]) * 0.85
            landmarks[center_name] = {
                "position": _vec(point),
                "confidence": confidence,
                "visualConfidence": confidence,
                "geometryConfidence": confidence,
                "multiviewConfidence": min(inner.get("multiviewConfidence", 0.0), outer.get("multiviewConfidence", 0.0)),
                "anatomicalConfidence": 0.75,
                "finalConfidence": confidence,
                "viewsConfirmed": min(inner.get("viewsConfirmed", 1), outer.get("viewsConfirmed", 1)),
                "method": "derived-eye-corner-midpoint-v1",
            }

    ears, ear_warnings = _ear_landmarks(meshes, classifications, body_vectors, body_width)
    landmarks.update(ears)
    warnings = list(projection_failures) + ear_warnings + _validate(landmarks)

    minimum = [
        "eye_l_inner", "eye_l_outer", "eye_r_inner", "eye_r_outer",
        "nose_tip", "nose_base", "mouth_corner_l", "mouth_corner_r",
        "upper_lip_center", "lower_lip_center", "chin",
        "ear_l_center", "ear_r_center",
    ]
    missing = [name for name in minimum if name not in landmarks]
    low = [name for name, item in landmarks.items() if float(item.get("confidence", 0.0)) < 0.40]
    if missing:
        status = "needs_review"
        warnings.append({"code": "FACE_LANDMARKS_MISSING", "landmarks": missing})
    elif low:
        status = "valid_with_warnings"
        warnings.append({"code": "FACE_LANDMARKS_LOW_CONFIDENCE", "landmarks": low})
    else:
        status = "valid"
    return {
        "status": status,
        "landmarks": landmarks,
        "projectedCandidates": projected,
        "warnings": warnings,
        "viewsDetected": len(face_output.get("views", [])),
        "method": "mediapipe-face-landmarker-plus-mesh-raycast-v1",
    }
