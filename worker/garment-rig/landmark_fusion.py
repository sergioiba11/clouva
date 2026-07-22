"""Robust multiview fusion for projected CLOUVA landmarks."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List

from mathutils import Vector


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _as_vector(candidate: dict):
    return Vector(tuple(float(value) for value in candidate["position3d"]))


def _medoid(candidates: List[dict]):
    if len(candidates) == 1:
        return candidates[0]
    return min(
        candidates,
        key=lambda item: sum((_as_vector(item) - _as_vector(other)).length for other in candidates),
    )


def fuse_projected(projected: Iterable[dict], region_scale: float,
                   minimum_views: int = 2, tolerance_ratio: float = 0.055):
    grouped: Dict[str, List[dict]] = defaultdict(list)
    for item in projected:
        grouped[str(item.get("name"))].append(item)

    fused = {}
    for name, candidates in grouped.items():
        anchor = _medoid(candidates)
        anchor_point = _as_vector(anchor)
        tolerance = max(region_scale * tolerance_ratio, 1e-5)
        cluster = [
            item for item in candidates
            if (_as_vector(item) - anchor_point).length <= tolerance
        ] or [anchor]
        weights = [
            max(1e-4, float(item.get("visualConfidence", 0.5)) * float(item.get("geometryConfidence", 0.5)))
            for item in cluster
        ]
        total_weight = sum(weights)
        point = Vector((0.0, 0.0, 0.0))
        normal = Vector((0.0, 0.0, 0.0))
        for item, weight in zip(cluster, weights):
            point += _as_vector(item) * weight
            normal += Vector(tuple(item.get("surfaceNormal", (0.0, 0.0, 1.0)))) * weight
        point /= max(total_weight, 1e-8)
        if normal.length > 1e-8:
            normal.normalize()
        views = sorted({str(item.get("view")) for item in cluster})
        spread = max(((_as_vector(item) - point).length for item in cluster), default=0.0)
        visual = sum(float(item.get("visualConfidence", 0.5)) for item in cluster) / len(cluster)
        geometry = sum(float(item.get("geometryConfidence", 0.5)) for item in cluster) / len(cluster)
        multiview = min(1.0, len(views) / max(minimum_views, 1))
        consistency = max(0.0, min(1.0, 1.0 - spread / max(tolerance, 1e-8)))
        final = visual * 0.30 + geometry * 0.30 + multiview * 0.24 + consistency * 0.16
        fused[name] = {
            "position": _vec(point),
            "surfaceNormal": _vec(normal),
            "visualConfidence": visual,
            "geometryConfidence": geometry,
            "multiviewConfidence": multiview,
            "anatomicalConfidence": 0.5,
            "finalConfidence": final,
            "confidence": final,
            "viewsConfirmed": len(views),
            "views": views,
            "candidateCount": len(candidates),
            "clusterCount": len(cluster),
            "spread": spread,
            "method": "mediapipe-tasks-plus-raycast-multiview-v1",
            "hitObjects": sorted({str(item.get("hitObject")) for item in cluster}),
        }
    return fused


def apply_anatomical_confidence(landmark: dict, score: float):
    score = max(0.0, min(1.0, float(score)))
    landmark["anatomicalConfidence"] = score
    landmark["finalConfidence"] = (
        float(landmark.get("visualConfidence", 0.0)) * 0.25
        + float(landmark.get("geometryConfidence", 0.0)) * 0.25
        + float(landmark.get("multiviewConfidence", 0.0)) * 0.20
        + score * 0.30
    )
    landmark["confidence"] = landmark["finalConfidence"]
    return landmark
