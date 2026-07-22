"""Robust multiview ray triangulation for CLOUVA Avatar Analyzer V2.

Surface ray hits from palm, dorsum and profile views are observations, not the
joint itself. This module estimates an internal point from the camera rays and
keeps a separate surface display position chosen from an anatomically allowed
region.
"""
from __future__ import annotations

from itertools import combinations
from typing import Iterable, List, Sequence

from mathutils import Matrix, Vector


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _candidate_ray(candidate: dict):
    origin = Vector(tuple(float(value) for value in candidate["rayOrigin"]))
    direction = Vector(tuple(float(value) for value in candidate["rayDirection"]))
    if direction.length > 1e-8:
        direction.normalize()
    return origin, direction


def _distance_to_ray(point: Vector, origin: Vector, direction: Vector) -> float:
    return (point - origin).cross(direction).length


def _closest_midpoint(first: dict, second: dict):
    origin_a, direction_a = _candidate_ray(first)
    origin_b, direction_b = _candidate_ray(second)
    cross = direction_a.cross(direction_b)
    denominator = cross.length_squared
    if denominator <= 1e-10:
        return None
    delta = origin_b - origin_a
    t_a = delta.cross(direction_b).dot(cross) / denominator
    t_b = delta.cross(direction_a).dot(cross) / denominator
    point_a = origin_a + direction_a * t_a
    point_b = origin_b + direction_b * t_b
    return (point_a + point_b) * 0.5


def _projector(direction: Vector) -> Matrix:
    x, y, z = float(direction.x), float(direction.y), float(direction.z)
    return Matrix((
        (1.0 - x * x, -x * y, -x * z),
        (-y * x, 1.0 - y * y, -y * z),
        (-z * x, -z * y, 1.0 - z * z),
    ))


def _least_squares(rays: Sequence[dict]) -> Vector | None:
    if len(rays) < 2:
        return None
    system = Matrix(((0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
    target = Vector((0.0, 0.0, 0.0))
    for candidate in rays:
        origin, direction = _candidate_ray(candidate)
        projection = _projector(direction)
        system += projection
        target += projection @ origin
    determinant = float(system.determinant())
    if abs(determinant) <= 1e-10:
        return None
    return system.inverted_safe() @ target


def _unique_views(candidates: Iterable[dict]):
    return sorted({str(item.get("view")) for item in candidates if item.get("view")})


def _surface_point(candidate: dict) -> Vector:
    return Vector(tuple(float(value) for value in candidate["position3d"]))


def triangulate_landmark(name: str, candidates: List[dict], segmentation,
                         allowed_regions: str | Iterable[str], region_scale: float,
                         minimum_views: int = 2, preferred_view_tokens: Sequence[str] = ()):
    scale = max(float(region_scale), 1e-5)
    allowed = [allowed_regions] if isinstance(allowed_regions, str) else list(allowed_regions)
    region_tolerance = scale * 0.30
    usable = []
    rejected = []
    for candidate in candidates:
        if not all(key in candidate for key in ("rayOrigin", "rayDirection", "position3d")):
            rejected.append({"view": candidate.get("view"), "reason": "RAY_DATA_MISSING"})
            continue
        surface = _surface_point(candidate)
        sample, distance = segmentation.nearest(surface, allowed)
        if sample is None or distance > region_tolerance:
            rejected.append({
                "view": candidate.get("view"),
                "reason": "SURFACE_HIT_OUTSIDE_ANATOMICAL_REGION",
                "regionDistance": distance if distance != float("inf") else None,
            })
            continue
        enriched = dict(candidate)
        enriched["segmentedRegion"] = sample.region
        enriched["regionDistance"] = float(distance)
        usable.append(enriched)

    views = _unique_views(usable)
    if len(views) < minimum_views:
        return {
            "name": name,
            "accepted": False,
            "display": False,
            "landmarkType": "internal_joint",
            "region": allowed[0] if allowed else "unknown",
            "viewsConfirmed": len(views),
            "confidence": 0.0,
            "rejectionReasons": ["INSUFFICIENT_REGION_VALID_VIEWS"],
            "rejectedCandidates": rejected,
        }

    ray_tolerance = scale * 0.13
    hypotheses = []
    for first, second in combinations(usable, 2):
        if first.get("view") == second.get("view"):
            continue
        midpoint = _closest_midpoint(first, second)
        if midpoint is None:
            continue
        residuals = []
        inliers = []
        for candidate in usable:
            origin, direction = _candidate_ray(candidate)
            residual = _distance_to_ray(midpoint, origin, direction)
            residuals.append(residual)
            if residual <= ray_tolerance:
                inliers.append(candidate)
        if len(_unique_views(inliers)) >= minimum_views:
            hypotheses.append((len(_unique_views(inliers)), sum(residuals), midpoint, inliers))

    if not hypotheses:
        return {
            "name": name,
            "accepted": False,
            "display": False,
            "landmarkType": "internal_joint",
            "region": allowed[0] if allowed else "unknown",
            "viewsConfirmed": len(views),
            "confidence": 0.0,
            "rejectionReasons": ["RAY_TRIANGULATION_UNSTABLE"],
            "rejectedCandidates": rejected,
        }

    hypotheses.sort(key=lambda item: (-item[0], item[1]))
    _view_count, _residual_sum, hypothesis, inliers = hypotheses[0]
    internal = _least_squares(inliers) or hypothesis
    residuals = [
        _distance_to_ray(internal, *_candidate_ray(candidate))
        for candidate in inliers
    ]
    mean_residual = sum(residuals) / max(len(residuals), 1)
    nearest_sample, region_distance = segmentation.nearest(internal, allowed)
    inside_region = nearest_sample is not None and region_distance <= scale * 0.38

    def surface_rank(candidate: dict):
        view = str(candidate.get("view") or "")
        preferred = 0 if any(token in view for token in preferred_view_tokens) else 1
        return (
            preferred,
            (_surface_point(candidate) - internal).length,
            float(candidate.get("regionDistance", 0.0)),
        )

    display_candidate = min(inliers, key=surface_rank)
    surface = _surface_point(display_candidate)
    triangulation_confidence = max(0.0, min(1.0, 1.0 - mean_residual / ray_tolerance))
    region_confidence = max(0.0, min(1.0, 1.0 - region_distance / max(scale * 0.38, 1e-8)))
    view_confidence = min(1.0, len(_unique_views(inliers)) / max(minimum_views + 1, 1))
    visual_confidence = sum(float(item.get("visualConfidence", 0.5)) for item in inliers) / len(inliers)
    confidence = (
        visual_confidence * 0.18
        + triangulation_confidence * 0.34
        + region_confidence * 0.30
        + view_confidence * 0.18
    )
    accepted = inside_region and triangulation_confidence >= 0.45 and confidence >= 0.58
    if not accepted:
        confidence = min(confidence, 0.39)

    return {
        "name": name,
        "position": _vec(internal),
        "internalJointPosition": _vec(internal),
        "surfaceDisplayPosition": _vec(surface),
        "displayPosition": _vec(surface),
        "surfaceNormal": list(display_candidate.get("surfaceNormal") or (0.0, 0.0, 1.0)),
        "region": nearest_sample.region if nearest_sample else (allowed[0] if allowed else "unknown"),
        "surfaceRegion": str(display_candidate.get("segmentedRegion") or "unknown"),
        "landmarkType": "internal_joint",
        "accepted": accepted,
        "verified": accepted,
        "display": accepted,
        "confidence": float(confidence),
        "visualConfidence": float(visual_confidence),
        "triangulationConfidence": float(triangulation_confidence),
        "geometryConfidence": float(region_confidence),
        "depthConfidence": float(triangulation_confidence),
        "topologyConfidence": 0.5,
        "viewsConfirmed": len(_unique_views(inliers)),
        "views": _unique_views(inliers),
        "rayResidual": float(mean_residual),
        "regionDistance": float(region_distance),
        "surfaceHitObject": str(display_candidate.get("hitObject") or ""),
        "surfaceHitFace": int(display_candidate.get("faceIndex", -1)),
        "methods": ["region_segmentation", "robust_ray_triangulation", "surface_observation_selection"],
        "method": "anatomy-restricted-ray-triangulation-v2",
        "rejectionReasons": [] if accepted else [
            *( [] if inside_region else ["TRIANGULATED_POINT_OUTSIDE_REGION"] ),
            *( [] if triangulation_confidence >= 0.45 else ["RAY_RESIDUAL_TOO_HIGH"] ),
            *( [] if confidence >= 0.58 else ["COMBINED_CONFIDENCE_LOW"] ),
        ],
        "rejectedCandidates": rejected,
    }
