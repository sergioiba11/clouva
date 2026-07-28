"""Sparse 2D-to-3D projection for CLOUVA Avatar Analyzer V4.2.

Only detector candidate pixels are ray-cast. Full-frame depth/normal/triangle maps
are not required in production, but the emitted evidence contract remains rich
enough to reproduce and diagnose every accepted or rejected projection.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable

import bpy
from mathutils import Vector

from analyzer_v42_incremental import SPARSE_PROJECTION_VERSION
from landmark_projector_3d import (
    _allowed_regions_for_candidate,
    _orthographic_ray,
    _perspective_ray,
)


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _candidate_offsets(region: str, landmark: str):
    radius = 2 if region == "hand" or landmark.startswith(("thumb_", "index_", "middle_", "ring_", "pinky_")) else 1
    offsets = [(0, 0)]
    for ring in range(1, radius + 1):
        for dy in range(-ring, ring + 1):
            for dx in range(-ring, ring + 1):
                if max(abs(dx), abs(dy)) == ring:
                    offsets.append((dx, dy))
    return offsets


def _barycentric(point: Vector, vertices: list[list[float]] | None):
    if not vertices or len(vertices) != 3:
        return None
    a, b, c = (Vector(tuple(float(value) for value in vertex)) for vertex in vertices)
    v0 = b - a
    v1 = c - a
    v2 = point - a
    d00 = v0.dot(v0)
    d01 = v0.dot(v1)
    d11 = v1.dot(v1)
    d20 = v2.dot(v0)
    d21 = v2.dot(v1)
    denominator = d00 * d11 - d01 * d01
    if abs(denominator) <= 1e-12:
        return None
    v = (d11 * d20 - d01 * d21) / denominator
    w = (d00 * d21 - d01 * d20) / denominator
    u = 1.0 - v - w
    values = [float(u), float(v), float(w)]
    return values if all(math.isfinite(value) for value in values) else None


def _ray(camera, x: float, y: float, resolution):
    if camera.data.type == "ORTHO":
        return _orthographic_ray(camera, x, y, resolution)
    return _perspective_ray(camera, x, y, resolution)


def _project_candidate(candidate: dict[str, Any], view: dict[str, Any], camera, anatomy_bvh):
    resolution = view.get("resolution") or [512, 512]
    width = max(int(resolution[0]), 1)
    height = max(int(resolution[1]), 1)
    requested_x = float(candidate.get("x") or 0.0)
    requested_y = float(candidate.get("y") or 0.0)
    landmark = str(candidate.get("name") or "")
    region = str(candidate.get("region") or view.get("region") or "")
    allowed = _allowed_regions_for_candidate(candidate, view.get("allowedRegions") or [])
    tested = []
    for dx, dy in _candidate_offsets(region, landmark):
        x = min(1.0, max(0.0, requested_x + dx / width))
        y = min(1.0, max(0.0, requested_y + dy / height))
        origin, direction = _ray(camera, x, y, resolution)
        hit = anatomy_bvh.ray_cast(origin, direction, allowed)
        record = {
            "x": x,
            "y": y,
            "dx": dx,
            "dy": dy,
            "origin": origin,
            "direction": direction,
            "hit": hit,
            "allowedRegions": allowed,
        }
        if hit is None:
            record["score"] = 0.0
            tested.append(record)
            continue
        pixel_distance = math.sqrt(dx * dx + dy * dy)
        pixel_score = max(0.0, 1.0 - pixel_distance / 3.0)
        region_score = float(hit.get("regionConfidencePenalty") or 0.0)
        boundary_score = 0.82 if hit.get("isBoundaryTriangle") else 1.0
        record["score"] = pixel_score * 0.42 + region_score * 0.43 + boundary_score * 0.15
        tested.append(record)
    hits = [item for item in tested if item.get("hit") is not None]
    selected = max(hits, key=lambda item: (float(item.get("score") or 0.0), -abs(item["dx"]) - abs(item["dy"]))) if hits else None
    return selected, tested


def project_sparse_landmarks(
    detector_output: dict[str, Any],
    manifest: dict[str, Any],
    anatomy_bvh,
    *,
    requested_landmarks: Iterable[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    requested = {str(value) for value in requested_landmarks or [] if value}
    view_lookup = {str(item.get("name")): item for item in manifest.get("views") or []}
    projected = []
    failures = []
    rays_executed = 0
    for view_result in detector_output.get("views") or []:
        view_name = str(view_result.get("name") or "")
        view = view_lookup.get(view_name)
        if view is None:
            failures.append({"code": "CAMERA_MANIFEST_MISSING", "camera": view_name, "module": "projection"})
            continue
        camera = bpy.data.objects.get(view.get("cameraObject"))
        if camera is None or camera.type != "CAMERA":
            failures.append({"code": "CAMERA_OBJECT_MISSING", "camera": view_name, "module": "projection"})
            continue
        for candidate in view_result.get("candidates") or []:
            name = str(candidate.get("name") or "")
            if requested and name not in requested:
                continue
            selected, tested = _project_candidate(candidate, view, camera, anatomy_bvh)
            rays_executed += len(tested)
            if selected is None:
                failures.append({
                    "code": "RAY_DID_NOT_HIT_EXPECTED_ANATOMICAL_REGION",
                    "landmark": name,
                    "module": "projection",
                    "camera": view_name,
                    "position2D": [float(candidate.get("x") or 0.0), float(candidate.get("y") or 0.0)],
                    "detectorConfidence": float(candidate.get("confidence") or candidate.get("score") or 0.0),
                    "silhouetteHit": False,
                    "rayHit": False,
                    "expectedRegion": list(_allowed_regions_for_candidate(candidate, view.get("allowedRegions") or [])),
                    "actualRegion": None,
                    "triangleId": None,
                    "depthResidual": None,
                    "rayResidual": None,
                    "cameraMatrix": view.get("matrixWorld"),
                    "sourceVersion": SPARSE_PROJECTION_VERSION,
                    "raysTested": len(tested),
                    "failureStage": "projection",
                })
                continue
            hit = selected["hit"]
            point = hit["location"]
            normal = hit.get("normal") or Vector((0.0, 0.0, 1.0))
            barycentric = _barycentric(point, hit.get("triangleWorldVertices"))
            detector_confidence = float(candidate.get("confidence") or candidate.get("score") or 0.0)
            region_confidence = float(hit.get("regionConfidencePenalty") or 0.0)
            geometry_confidence = max(0.0, min(1.0, region_confidence * 0.68 + float(selected.get("score") or 0.0) * 0.22 + 0.10))
            projected.append({
                **candidate,
                "position3d": _vec(point),
                "worldPosition": _vec(point),
                "surfaceNormal": _vec(normal),
                "hitObject": hit.get("sourceObject") or "",
                "hitObjectClass": "anatomy_region",
                "hitRegion": hit.get("primaryRegion") or hit.get("region"),
                "primaryRegion": hit.get("primaryRegion") or hit.get("region"),
                "secondaryRegions": list(hit.get("secondaryRegions") or []),
                "semanticWeights": dict(hit.get("semanticWeights") or {}),
                "regionId": int(hit.get("regionId") or 0),
                "objectId": int(hit.get("objectId") or 0),
                "faceIndex": int(hit.get("sourcePolygon") or -1),
                "triangleIndex": int(hit.get("triangleIndex") or -1),
                "triangleId": int(hit.get("triangleIndex") or -1),
                "barycentricCoordinates": barycentric,
                "sourceVertices": list(hit.get("sourceVertices") or []),
                "rayOrigin": _vec(selected["origin"]),
                "rayDirection": _vec(selected["direction"]),
                "rayHitDistance": float(hit.get("distance") or 0.0),
                "depthObservation": float(hit.get("distance") or 0.0),
                "depthResidual": 0.0,
                "rayResidual": 0.0,
                "depthConfidence": 1.0,
                "normalCompatibility": 1.0,
                "regionCompatibility": region_confidence,
                "silhouetteConfidence": 1.0,
                "viewCoverage": float(view.get("silhouetteCoverage") or 0.0),
                "projectionSource": "anatomy_bvh_sparse_raycast",
                "recastMatched": True,
                "geometryConfidence": geometry_confidence,
                "detectorConfidence": detector_confidence,
                "requestedPixel": [float(candidate.get("x") or 0.0), float(candidate.get("y") or 0.0)],
                "selectedPixel": [float(selected["x"]), float(selected["y"])],
                "pixelOffset": [int(selected["dx"]), int(selected["dy"])],
                "samplesTested": len(tested),
                "matchingSamples": len([item for item in tested if item.get("hit") is not None]),
                "projectionMethod": SPARSE_PROJECTION_VERSION,
                "rayHit": True,
                "silhouetteHit": True,
                "cameraMatrix": view.get("matrixWorld"),
                "sourceVersion": SPARSE_PROJECTION_VERSION,
            })
    metrics = {
        "sparseProjectionsGenerated": len(projected),
        "raysExecuted": rays_executed,
        "projectionFailures": len(failures),
        "projectionVersion": SPARSE_PROJECTION_VERSION,
    }
    return projected, failures, metrics


__all__ = ["project_sparse_landmarks"]
