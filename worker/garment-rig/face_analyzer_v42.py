"""Independent sparse face module for CLOUVA Avatar Analyzer V4.2."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable

import bpy
from mathutils import Vector

from face_analyzer import _ear_landmarks, _eye_rotation_centers, _validate
from ray_triangulator import triangulate_landmark
from sparse_landmark_projector_v42 import project_sparse_landmarks

MODULE_VERSION = "clouva-face-analyzer-v4.2"


def analyze_face_module_v42(
    detector_output: dict,
    manifest: dict,
    meshes: Iterable[bpy.types.Object],
    classifications: Dict[str, str],
    body_vectors: Dict[str, Vector],
    body_width: float,
    segmentation,
    anatomy_bvh,
    *,
    requested_landmarks: list[str] | None = None,
):
    meshes = list(meshes)
    face_view_names = {
        str(item.get("name") or "")
        for item in manifest.get("views") or []
        if item.get("region") == "face"
    }
    face_output = {
        **detector_output,
        "views": [
            item for item in detector_output.get("views") or []
            if str(item.get("name") or "") in face_view_names
        ],
    }
    projected, projection_failures, projection_metrics = project_sparse_landmarks(
        face_output,
        manifest,
        anatomy_bvh,
        requested_landmarks=requested_landmarks,
    )
    grouped = defaultdict(list)
    for candidate in projected:
        name = str(candidate.get("name") or "")
        if name:
            grouped[name].append(candidate)
    head_scale = max((body_vectors["head_top"] - body_vectors["skull_base"]).length, 1e-5)
    landmarks = {}
    for name, candidates in grouped.items():
        allowed = ("eyes", "head") if name.startswith("eye_") and anatomy_bvh.has_region("eyes") else ("head",)
        landmarks[name] = triangulate_landmark(
            name,
            candidates,
            segmentation,
            allowed,
            head_scale,
            minimum_views=2,
            preferred_view_tokens=("face_front", "face_left_30", "face_right_30"),
            anatomy_bvh=anatomy_bvh,
            landmark_type="surface",
        )
        landmarks[name]["landmarkType"] = "surface_landmark"
        landmarks[name]["projectionMethod"] = "sparse-anatomy-bvh-raycast-v4.2"

    ears, ear_warnings = _ear_landmarks(segmentation, body_vectors, body_width)
    landmarks.update(ears)
    landmarks.update(_eye_rotation_centers(meshes, classifications))
    warnings = [
        *({**item, "module": "face", "blocking": True} for item in projection_failures),
        *({**item, "module": "face"} for item in ear_warnings),
        *({**item, "module": "face"} for item in _validate(landmarks)),
    ]
    required = [
        "eye_l_inner", "eye_l_outer", "eye_r_inner", "eye_r_outer",
        "nose_tip", "nose_base", "mouth_corner_l", "mouth_corner_r",
        "upper_lip_center", "lower_lip_center", "chin", "ear_l_center", "ear_r_center",
    ]
    if requested_landmarks:
        required = [name for name in required if name in set(requested_landmarks)]
    missing_or_rejected = [
        name for name in required
        if name not in landmarks or not landmarks[name].get("accepted", False)
    ]
    if missing_or_rejected:
        status = "needs_review"
        warnings.append({
            "code": "FACE_REQUIRED_LANDMARKS_NOT_VERIFIED",
            "module": "face",
            "landmarks": missing_or_rejected,
            "blocking": True,
        })
    elif warnings:
        status = "valid_with_warnings"
    else:
        status = "valid"
    return {
        "status": status,
        "faceAnalysis": status,
        "landmarks": landmarks,
        "projectedCandidates": projected,
        "triangulatedLandmarks": sum(1 for item in landmarks.values() if item.get("position")),
        "acceptedLandmarks": sum(1 for item in landmarks.values() if item.get("accepted", False)),
        "visibleSurfaceLandmarks": sum(1 for item in landmarks.values() if item.get("display", False)),
        "warnings": warnings,
        "viewsDetected": len(face_output.get("views") or []),
        "projectionMetrics": projection_metrics,
        "method": "mediapipe-sparse-bvh-face-module-v4.2",
        "manifest": {
            "version": MODULE_VERSION,
            "module": "face",
            "status": status,
            "cameras": sorted(face_view_names),
            "landmarkFilter": sorted(requested_landmarks or []),
            "sparseProjection": True,
            **projection_metrics,
        },
    }


__all__ = ["analyze_face_module_v42"]
