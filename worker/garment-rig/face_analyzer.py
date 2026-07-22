"""Face analysis restricted to exact V3 head and eye BVHs."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable

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
    samples = [sample for sample in segmentation.region_samples("head") if low <= sample.point.z <= high]
    output = {}
    warnings = []
    side_clusters = {}
    for side, suffix, sign in (("left", "l", 1.0), ("right", "r", -1.0)):
        side_samples = [sample for sample in samples if sign * (sample.point.x - center_x) > 0.0]
        if not side_samples:
            warnings.append({"code": "EAR_REGION_EMPTY", "side": side})
            continue
        lateral_values = [sign * (sample.point.x - center_x) for sample in side_samples]
        maximum = max(lateral_values)
        threshold = maximum - max(body_width * 0.028, head_height * 0.045)
        cluster = [
            sample for sample in side_samples
            if sign * (sample.point.x - center_x) >= threshold
            and sign * sample.normal.x >= 0.12
        ]
        if len(cluster) < 8:
            warnings.append({"code": "EAR_GEOMETRY_INSUFFICIENT", "side": side, "vertices": len(cluster)})
            continue
        points = [sample.point for sample in cluster]
        center = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
        lateral_span = max(sign * (point.x - center_x) for point in points) - min(sign * (point.x - center_x) for point in points)
        vertical_span = max(point.z for point in points) - min(point.z for point in points)
        normal_alignment = sum(max(0.0, sign * sample.normal.x) for sample in cluster) / len(cluster)
        geometry_confidence = min(0.90, 0.36 + min(1.0, len(cluster) / 180.0) * 0.24 + min(1.0, normal_alignment) * 0.24 + min(1.0, vertical_span / max(head_height * 0.22, 1e-8)) * 0.06)
        side_clusters[side] = (center, points, geometry_confidence, lateral_span, vertical_span)

    symmetry_confidence = 0.0
    if "left" in side_clusters and "right" in side_clusters:
        left_center = side_clusters["left"][0]
        right_center = side_clusters["right"][0]
        height_delta = abs(left_center.z - right_center.z) / head_height
        depth_delta = abs(left_center.y - right_center.y) / max(head_height, 1e-8)
        symmetry_confidence = max(0.0, min(1.0, 1.0 - height_delta * 4.0 - depth_delta * 2.0))

    for side, suffix, sign in (("left", "l", 1.0), ("right", "r", -1.0)):
        if side not in side_clusters:
            continue
        center, points, geometry_confidence, _lateral_span, _vertical_span = side_clusters[side]
        values = {
            "center": center,
            "top": max(points, key=lambda point: point.z),
            "bottom": min(points, key=lambda point: point.z),
            "front": min(points, key=lambda point: point.y),
            "back": max(points, key=lambda point: point.y),
        }
        final = geometry_confidence * 0.72 + symmetry_confidence * 0.28
        accepted = final >= 0.62
        for label, point in values.items():
            name = f"ear_{suffix}_{label}"
            output[name] = {
                "name": name, "position": _vec(point),
                "surfaceDisplayPosition": _vec(point), "displayPosition": _vec(point),
                "region": "head", "surfaceRegion": "head", "landmarkType": "surface",
                "accepted": accepted, "verified": accepted, "display": accepted,
                "confidence": float(final if accepted else min(final, 0.39)),
                "finalConfidence": float(final if accepted else min(final, 0.39)),
                "detectorConfidence": 0.0, "viewQualityConfidence": 0.0,
                "silhouetteConfidence": float(geometry_confidence),
                "depthConfidence": 0.5, "normalConfidence": float(normal_alignment if 'normal_alignment' in locals() else 0.5),
                "triangulationConfidence": 0.0, "regionConfidence": 1.0,
                "geodesicConfidence": 0.0, "topologyConfidence": float(geometry_confidence),
                "symmetryConfidence": float(symmetry_confidence), "viewsConfirmed": 1,
                "methods": ["segmented_head_lateral_normal_cluster", "bilateral_ear_symmetry"],
                "method": "geometry-normal-symmetry-ear-v3",
                "rejectionReasons": [] if accepted else ["EAR_EVIDENCE_INSUFFICIENT"],
            }
        if not accepted:
            warnings.append({"code": "EAR_EVIDENCE_INSUFFICIENT", "side": side, "confidence": final})
    return output, warnings


def _eye_rotation_centers(meshes: Iterable[bpy.types.Object], classifications: Dict[str, str]):
    eyes = []
    for obj in meshes:
        if classifications.get(obj.name) != "eyes" or not len(obj.data.vertices):
            continue
        points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        center = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
        radii = [(point - center).length for point in points]
        mean_radius = sum(radii) / max(len(radii), 1)
        variance = sum((value - mean_radius) ** 2 for value in radii) / max(len(radii), 1)
        sphere_confidence = max(0.0, min(1.0, 1.0 - variance / max(mean_radius * mean_radius * 0.18, 1e-8)))
        eyes.append((center.x, center, obj.name, sphere_confidence, mean_radius))
    if len(eyes) < 2:
        return {}
    eyes.sort(key=lambda item: item[0], reverse=True)
    result = {}
    for suffix, (_x, center, object_name, sphere_confidence, radius) in zip(("l", "r"), eyes[:2]):
        name = f"eye_{suffix}_rotation_center"
        result[name] = {
            "name": name, "position": _vec(center), "internalJointPosition": _vec(center),
            "region": "eyes", "landmarkType": "internal_joint",
            "accepted": sphere_confidence >= 0.55, "verified": sphere_confidence >= 0.55,
            "display": False, "confidence": float(sphere_confidence), "finalConfidence": float(sphere_confidence),
            "eyeRadius": float(radius), "sourceObject": object_name,
            "methods": ["separate_eye_object_centroid", "sphere_fit_residual"],
            "method": "separate-eye-sphere-fit-v3",
            "rejectionReasons": [] if sphere_confidence >= 0.55 else ["EYE_SPHERE_FIT_LOW_CONFIDENCE"],
        }
    return result


def _validate(landmarks: Dict[str, dict]):
    warnings = []
    required_order = ["forehead_center", "nose_tip", "mouth_center", "chin"]
    present = [name for name in required_order if name in landmarks and landmarks[name].get("accepted", False)]
    for above, below in zip(present, present[1:]):
        if _internal(landmarks[above]).z <= _internal(landmarks[below]).z:
            for name in (above, below):
                landmarks[name]["accepted"] = False; landmarks[name]["verified"] = False; landmarks[name]["display"] = False
                landmarks[name]["confidence"] = min(float(landmarks[name].get("confidence", 0.0)), 0.39)
                landmarks[name].setdefault("rejectionReasons", []).append("FACE_VERTICAL_ORDER_INVALID")
            warnings.append({"code": "FACE_VERTICAL_ORDER_INVALID", "above": above, "below": below})
    for left, right, label in (("eye_l_inner", "eye_r_inner", "eyes"), ("mouth_corner_l", "mouth_corner_r", "mouth"), ("ear_l_center", "ear_r_center", "ears")):
        if all(name in landmarks and landmarks[name].get("accepted", False) for name in (left, right)):
            separation = abs(_internal(landmarks[left]).x - _internal(landmarks[right]).x)
            if separation <= 1e-5:
                warnings.append({"code": f"{label.upper()}_SEPARATION_INVALID"})
                for name in (left, right):
                    landmarks[name]["accepted"] = False; landmarks[name]["display"] = False; landmarks[name]["verified"] = False
                    landmarks[name]["confidence"] = min(float(landmarks[name].get("confidence", 0.0)), 0.39)
    return warnings


def analyze_face(detector_output: dict, manifest: dict, meshes: Iterable[bpy.types.Object],
                 classifications: Dict[str, str], body_vectors: Dict[str, Vector],
                 body_width: float, segmentation, anatomy_bvh):
    meshes = list(meshes)
    face_output = {**detector_output, "views": [item for item in detector_output.get("views", []) if item.get("region") == "face"]}
    projected, projection_failures = project_candidates(face_output, manifest, classifications, anatomy_bvh)
    grouped = _group(projected)
    head_scale = max((body_vectors["head_top"] - body_vectors["skull_base"]).length, 1e-5)
    landmarks = {}
    for name, candidates in grouped.items():
        allowed = ("eyes", "head") if name.startswith("eye_") and anatomy_bvh.has_region("eyes") else ("head",)
        landmarks[name] = triangulate_landmark(
            name, candidates, segmentation, allowed, head_scale,
            minimum_views=2, preferred_view_tokens=("face_front", "three_quarter"),
            anatomy_bvh=anatomy_bvh,
        )
        landmarks[name]["landmarkType"] = "surface"
        landmarks[name].pop("internalJointPosition", None)

    ears, ear_warnings = _ear_landmarks(segmentation, body_vectors, body_width)
    landmarks.update(ears)
    landmarks.update(_eye_rotation_centers(meshes, classifications))
    warnings = list(projection_failures) + ear_warnings + _validate(landmarks)
    required = [
        "eye_l_inner", "eye_l_outer", "eye_r_inner", "eye_r_outer",
        "nose_tip", "nose_base", "mouth_corner_l", "mouth_corner_r",
        "upper_lip_center", "lower_lip_center", "chin", "ear_l_center", "ear_r_center",
    ]
    missing_or_rejected = [name for name in required if name not in landmarks or not landmarks[name].get("accepted", False)]
    if missing_or_rejected:
        status = "needs_review"
        warnings.append({"code": "FACE_REQUIRED_LANDMARKS_NOT_VERIFIED", "landmarks": missing_or_rejected})
    elif warnings:
        status = "valid_with_warnings"
    else:
        status = "valid"
    return {
        "status": status, "landmarks": landmarks, "projectedCandidates": projected,
        "triangulatedLandmarks": sum(1 for item in landmarks.values() if item.get("position")),
        "acceptedLandmarks": sum(1 for item in landmarks.values() if item.get("accepted", False)),
        "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
        "warnings": warnings, "viewsDetected": len(face_output.get("views", [])),
        "method": "mediapipe-dual-render-plus-head-eye-region-bvh-v3",
    }
