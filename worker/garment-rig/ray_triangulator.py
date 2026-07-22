"""Robust multiview triangulation for CLOUVA Avatar Analyzer V3.

Observations must agree with exact regional BVH depth, normal, silhouette and
region-id passes. Detector confidence cannot override invalid geometry.
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
    if abs(float(system.determinant())) <= 1e-10:
        return None
    return system.inverted_safe() @ target


def _unique_views(candidates: Iterable[dict]):
    return sorted({str(item.get("view")) for item in candidates if item.get("view")})


def _surface_point(candidate: dict) -> Vector:
    return Vector(tuple(float(value) for value in candidate["position3d"]))


def _mean(values, fallback=0.0):
    values = [float(value) for value in values if value is not None]
    return sum(values) / len(values) if values else float(fallback)


def _spread(points: Sequence[Vector]):
    if len(points) < 2:
        return 0.0
    distances = [(first - second).length for first, second in combinations(points, 2)]
    return _mean(distances)


def _region_nearest(internal: Vector, allowed: List[str], segmentation, anatomy_bvh=None):
    if anatomy_bvh is not None:
        hit = anatomy_bvh.nearest(internal, allowed)
        if hit is None:
            return None, float("inf"), None
        return hit["location"], float(hit["distance"]), str(hit.get("region") or allowed[0])
    sample, distance = segmentation.nearest(internal, allowed)
    if sample is None:
        return None, float("inf"), None
    return sample.point, float(distance), sample.region


def triangulate_landmark(name: str, candidates: List[dict], segmentation,
                         allowed_regions: str | Iterable[str], region_scale: float,
                         minimum_views: int = 2, preferred_view_tokens: Sequence[str] = (),
                         anatomy_bvh=None):
    scale = max(float(region_scale), 1e-5)
    allowed = [allowed_regions] if isinstance(allowed_regions, str) else list(allowed_regions)
    usable = []
    rejected = []
    for candidate in candidates:
        if not all(key in candidate for key in ("rayOrigin", "rayDirection", "position3d")):
            rejected.append({"view": candidate.get("view"), "reason": "RAY_DATA_MISSING"})
            continue
        region_ok = float(candidate.get("regionCompatibility", 0.0)) >= 0.99
        silhouette_ok = float(candidate.get("silhouetteConfidence", 0.0)) >= 0.5
        depth_ok = float(candidate.get("depthConfidence", 0.0)) >= 0.35
        normal_ok = float(candidate.get("normalCompatibility", 0.0)) >= 0.25
        region_name_ok = str(candidate.get("hitRegion") or "") in allowed
        if not (region_ok and silhouette_ok and depth_ok and normal_ok and region_name_ok):
            rejected.append({
                "view": candidate.get("view"),
                "reason": "TECHNICAL_EVIDENCE_GATE_FAILED",
                "regionCompatibility": candidate.get("regionCompatibility"),
                "silhouetteConfidence": candidate.get("silhouetteConfidence"),
                "depthConfidence": candidate.get("depthConfidence"),
                "normalCompatibility": candidate.get("normalCompatibility"),
                "hitRegion": candidate.get("hitRegion"),
            })
            continue
        usable.append(dict(candidate))

    views = _unique_views(usable)
    if len(views) < minimum_views:
        return {
            "name": name, "accepted": False, "display": False,
            "landmarkType": "internal_joint", "region": allowed[0] if allowed else "unknown",
            "viewsConfirmed": len(views), "confidence": 0.0, "finalConfidence": 0.0,
            "rejectionReasons": ["INSUFFICIENT_TECHNICALLY_VALID_VIEWS"],
            "rejectedCandidates": rejected,
        }

    ray_tolerance = scale * 0.11
    hypotheses = []
    for first, second in combinations(usable, 2):
        if first.get("view") == second.get("view"):
            continue
        midpoint = _closest_midpoint(first, second)
        if midpoint is None:
            continue
        inliers = []
        residuals = []
        for candidate in usable:
            residual = _distance_to_ray(midpoint, *_candidate_ray(candidate))
            residuals.append(residual)
            if residual <= ray_tolerance:
                inliers.append(candidate)
        if len(_unique_views(inliers)) >= minimum_views:
            hypotheses.append((len(_unique_views(inliers)), _mean(residuals, 999.0), midpoint, inliers))

    if not hypotheses:
        return {
            "name": name, "accepted": False, "display": False,
            "landmarkType": "internal_joint", "region": allowed[0] if allowed else "unknown",
            "viewsConfirmed": len(views), "confidence": 0.0, "finalConfidence": 0.0,
            "rejectionReasons": ["RAY_TRIANGULATION_UNSTABLE"],
            "rejectedCandidates": rejected,
        }

    hypotheses.sort(key=lambda item: (-item[0], item[1]))
    _view_count, _residual, hypothesis, inliers = hypotheses[0]
    internal = _least_squares(inliers) or hypothesis
    ray_residuals = [_distance_to_ray(internal, *_candidate_ray(item)) for item in inliers]
    mean_ray_residual = _mean(ray_residuals)
    surface_points = [_surface_point(item) for item in inliers]
    multiview_spread = _spread(surface_points)
    surface, region_distance, nearest_region = _region_nearest(
        internal, allowed, segmentation, anatomy_bvh,
    )

    ray_confidence = max(0.0, min(1.0, 1.0 - mean_ray_residual / max(ray_tolerance, 1e-8)))
    region_confidence = max(0.0, min(1.0, 1.0 - region_distance / max(scale * 0.30, 1e-8)))
    depth_confidence = _mean(item.get("depthConfidence") for item in inliers)
    normal_confidence = _mean(item.get("normalCompatibility") for item in inliers)
    silhouette_confidence = _mean(item.get("silhouetteConfidence") for item in inliers)
    detector_confidence = _mean(item.get("detectorConfidence", item.get("visualConfidence")) for item in inliers)
    view_quality = _mean((item.get("viewQualityConfidence") for item in inliers), 0.5)
    spread_confidence = max(0.0, min(1.0, 1.0 - multiview_spread / max(scale * 0.34, 1e-8)))
    view_confidence = min(1.0, len(_unique_views(inliers)) / max(minimum_views + 1, 1))

    final_confidence = (
        detector_confidence * 0.10
        + view_quality * 0.08
        + depth_confidence * 0.16
        + normal_confidence * 0.10
        + silhouette_confidence * 0.08
        + ray_confidence * 0.20
        + region_confidence * 0.18
        + spread_confidence * 0.06
        + view_confidence * 0.04
    )
    correct_region = nearest_region in allowed
    inside_geometry = surface is not None and region_distance <= scale * 0.30
    accepted = bool(
        correct_region and inside_geometry
        and ray_confidence >= 0.48
        and depth_confidence >= 0.50
        and region_confidence >= 0.45
        and final_confidence >= 0.60
    )
    if not accepted:
        final_confidence = min(final_confidence, 0.39)

    preferred_candidates = sorted(
        inliers,
        key=lambda candidate: (
            0 if any(token in str(candidate.get("view") or "") for token in preferred_view_tokens) else 1,
            (_surface_point(candidate) - internal).length,
            -float(candidate.get("depthConfidence", 0.0)),
        ),
    )
    display_observation = _surface_point(preferred_candidates[0])
    display_surface = surface if surface is not None else display_observation
    depth_residual = _mean((item.get("depthResidual") for item in inliers), 0.0)

    return {
        "name": name,
        "position": _vec(internal),
        "internalJointPosition": _vec(internal),
        "surfaceDisplayPosition": _vec(display_surface),
        "displayPosition": _vec(display_surface),
        "surfaceNormal": list(preferred_candidates[0].get("surfaceNormal") or (0.0, 0.0, 1.0)),
        "region": nearest_region or (allowed[0] if allowed else "unknown"),
        "surfaceRegion": nearest_region or "unknown",
        "landmarkType": "internal_joint",
        "accepted": accepted, "verified": accepted, "display": accepted,
        "confidence": float(final_confidence), "finalConfidence": float(final_confidence),
        "detectorConfidence": float(detector_confidence),
        "viewQualityConfidence": float(view_quality),
        "silhouetteConfidence": float(silhouette_confidence),
        "depthConfidence": float(depth_confidence),
        "normalConfidence": float(normal_confidence),
        "triangulationConfidence": float(ray_confidence),
        "regionConfidence": float(region_confidence),
        "multiviewConfidence": float(spread_confidence),
        "geometryConfidence": float(region_confidence),
        "topologyConfidence": 0.5,
        "geodesicConfidence": 0.0,
        "symmetryConfidence": 0.5,
        "viewsConfirmed": len(_unique_views(inliers)),
        "views": _unique_views(inliers),
        "rayResidual": float(mean_ray_residual),
        "depthResidual": float(depth_residual),
        "multiviewSpread": float(multiview_spread),
        "regionDistance": float(region_distance),
        "surfaceHitObject": str(preferred_candidates[0].get("hitObject") or ""),
        "surfaceHitFace": int(preferred_candidates[0].get("faceIndex", -1)),
        "surfaceTriangle": int(preferred_candidates[0].get("triangleIndex", -1)),
        "methods": [
            "exact_region_bvh", "rgb_edge_detector_agreement",
            "depth_normal_region_validation", "robust_ray_triangulation",
            "regional_surface_projection",
        ],
        "method": "v3-region-bvh-depth-normal-ransac",
        "rejectionReasons": [] if accepted else [
            *( [] if correct_region else ["TRIANGULATED_POINT_WRONG_REGION"] ),
            *( [] if inside_geometry else ["TRIANGULATED_POINT_OUTSIDE_GEOMETRY"] ),
            *( [] if ray_confidence >= 0.48 else ["RAY_RESIDUAL_TOO_HIGH"] ),
            *( [] if depth_confidence >= 0.50 else ["DEPTH_EVIDENCE_LOW"] ),
            *( [] if region_confidence >= 0.45 else ["REGION_EVIDENCE_LOW"] ),
            *( [] if final_confidence >= 0.60 else ["FINAL_CONFIDENCE_LOW"] ),
        ],
        "rejectedCandidates": rejected,
    }
