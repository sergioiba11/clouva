"""Project 2D candidates against exact anatomy-region BVHs.

V3.2 samples a small adaptive pixel neighborhood instead of treating one
sub-pixel MediaPipe coordinate as absolute truth. A nearby sample is only
eligible when it still belongs to the requested region and technical object.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List

import bpy
import numpy as np
from mathutils import Vector

_ARRAY_CACHE: Dict[str, np.ndarray] = {}


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _load_array(path: str | None):
    if not path or not Path(path).is_file():
        return None
    if path not in _ARRAY_CACHE:
        _ARRAY_CACHE[path] = np.load(path, mmap_mode="r")
    return _ARRAY_CACHE[path]


def _orthographic_ray(camera: bpy.types.Object, x: float, y: float, resolution):
    width, height = resolution
    aspect = float(width) / max(float(height), 1.0)
    local_x = (float(x) - 0.5) * camera.data.ortho_scale * aspect
    local_y = (0.5 - float(y)) * camera.data.ortho_scale
    origin = camera.matrix_world @ Vector((local_x, local_y, 0.0))
    direction = camera.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    direction.normalize()
    return origin, direction


def _perspective_ray(camera: bpy.types.Object, x: float, y: float, resolution):
    width, height = resolution
    aspect = float(width) / max(float(height), 1.0)
    ndc_x = float(x) * 2.0 - 1.0
    ndc_y = 1.0 - float(y) * 2.0
    tangent_y = __import__("math").tan(float(camera.data.angle_y) * 0.5)
    local = Vector((ndc_x * tangent_y * aspect, ndc_y * tangent_y, -1.0)).normalized()
    origin = camera.matrix_world.translation.copy()
    direction = camera.matrix_world.to_3x3() @ local
    direction.normalize()
    return origin, direction


def _cast_scene_fallback(origin: Vector, direction: Vector, classifications: Dict[str, str],
                         allowed_classes: set[str], max_distance: float = 10000.0):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    cursor = origin.copy()
    travelled = 0.0
    epsilon = 1e-5
    rejected = []
    for _ in range(16):
        hit, location, normal, face_index, obj, _matrix = bpy.context.scene.ray_cast(
            depsgraph, cursor, direction, distance=max_distance - travelled,
        )
        if not hit or obj is None:
            return None, rejected
        category = classifications.get(obj.name, "unknown_rejected")
        if category in allowed_classes:
            return {
                "location": location, "normal": normal, "faceIndex": int(face_index),
                "sourceObject": obj.name, "objectClass": category,
                "distance": travelled + (location - cursor).length,
                "region": "body" if category == "body" else category,
                "regionId": 0, "objectId": 0, "triangleIndex": int(face_index),
            }, rejected
        rejected.append({"object": obj.name, "class": category})
        step = max((location - cursor).length + epsilon, epsilon)
        travelled += step
        cursor = location + direction * epsilon
        if travelled >= max_distance:
            break
    return None, rejected


def _pixel_from_normalized(x: float, y: float, resolution):
    width, height = max(int(resolution[0]), 1), max(int(resolution[1]), 1)
    column = min(width - 1, max(0, int(float(x) * width)))
    row = min(height - 1, max(0, int(float(y) * height)))
    return column, row


def _technical_sample(view: dict, column: int, row: int):
    technical = view.get("technicalPasses") or {}
    paths = technical.get("paths") or {}
    resolution = technical.get("resolution") or [0, 0]
    if len(resolution) != 2 or not resolution[0] or not resolution[1]:
        return None
    width, height = int(resolution[0]), int(resolution[1])
    column = min(width - 1, max(0, int(column)))
    row = min(height - 1, max(0, int(row)))
    depth = _load_array(paths.get("depthNpy"))
    normal = _load_array(paths.get("normalNpy"))
    world_position = _load_array(paths.get("worldPositionNpy"))
    valid_mask = _load_array(paths.get("validMaskNpy"))
    region_id = _load_array(paths.get("primaryRegionIdNpy") or paths.get("regionIdNpy"))
    primary_weight = _load_array(paths.get("primaryRegionWeightNpy"))
    secondary_mask = _load_array(paths.get("secondaryRegionMaskNpy"))
    object_id = _load_array(paths.get("objectIdNpy"))
    triangle_id = _load_array(paths.get("triangleIdNpy"))
    barycentric = _load_array(paths.get("barycentricNpy"))
    curvature = _load_array(paths.get("curvatureNpy"))
    if depth is None or region_id is None:
        return None
    value = float(depth[row, column])
    valid = bool(valid_mask[row, column]) if valid_mask is not None else bool(
        np.isfinite(value) and int(triangle_id[row, column] if triangle_id is not None else -1) >= 0
    )
    return {
        "row": row, "column": column,
        "valid": valid,
        "depth": value if np.isfinite(value) else None,
        "normal": [float(component) for component in normal[row, column]] if normal is not None else None,
        "worldPosition": (
            [float(component) for component in world_position[row, column]]
            if world_position is not None and np.all(np.isfinite(world_position[row, column]))
            else None
        ),
        "regionId": int(region_id[row, column]),
        "primaryRegionWeight": float(primary_weight[row, column]) if primary_weight is not None else 1.0,
        "secondaryRegionMask": int(secondary_mask[row, column]) if secondary_mask is not None else 0,
        "objectId": int(object_id[row, column]) if object_id is not None else 0,
        "triangleId": int(triangle_id[row, column]) if triangle_id is not None else -1,
        "barycentricCoordinates": (
            [float(component) for component in barycentric[row, column]]
            if barycentric is not None and np.all(np.isfinite(barycentric[row, column]))
            else None
        ),
        "curvature": float(curvature[row, column]) if curvature is not None else 0.0,
        "coverage": float(technical.get("coverage") or 0.0),
    }


def _normal_compatibility(first: Vector, second_values):
    if not second_values:
        return 0.5
    second = Vector(tuple(float(value) for value in second_values))
    if first.length <= 1e-8 or second.length <= 1e-8:
        return 0.5
    first = first.normalized(); second = second.normalized()
    return max(0.0, min(1.0, first.dot(second) * 0.5 + 0.5))


def _offsets(radius: int):
    values = [(0, 0)]
    for ring in range(1, radius + 1):
        for dy in range(-ring, ring + 1):
            for dx in range(-ring, ring + 1):
                if max(abs(dx), abs(dy)) == ring:
                    values.append((dx, dy))
    return values


def _sample_radius(candidate: dict, view: dict):
    name = str(candidate.get("name") or "")
    region = str(candidate.get("region") or view.get("region") or "")
    if region == "hand" or any(name.startswith(prefix) for prefix in ("thumb_", "index_", "middle_", "ring_", "pinky_")):
        base = 6
    elif region == "face" or any(name.startswith(prefix) for prefix in ("eye_", "nose_", "mouth_", "lip_", "brow_")):
        base = 4
    else:
        base = 3
    technical = view.get("technicalPasses") or {}
    resolution = technical.get("resolution") or [256, 256]
    minimum_axis = max(1, min(int(resolution[0]), int(resolution[1])))
    resolution_factor = max(0, int(round(512 / minimum_axis)) - 1)
    projected_region_size = float(candidate.get("projectedRegionSize") or candidate.get("regionPixelSpan") or 0.0)
    region_factor = 2 if projected_region_size and projected_region_size < base * 6 else 0
    boundary_factor = 2 if candidate.get("nearAnatomicalBoundary") else 0
    curvature_factor = 1 if float(candidate.get("curvature") or 0.0) >= 0.45 else 0
    return min(14, base + resolution_factor + region_factor + boundary_factor + curvature_factor)


def _candidate_samples(candidate: dict, view: dict):
    rgb_resolution = view.get("resolution", [512, 512])
    technical_resolution = (view.get("technicalPasses") or {}).get("resolution") or rgb_resolution
    rgb_width = max(int(rgb_resolution[0]), 1)
    rgb_height = max(int(rgb_resolution[1]), 1)
    technical_width = max(int(technical_resolution[0]), 1)
    technical_height = max(int(technical_resolution[1]), 1)
    requested_x = float(candidate["x"])
    requested_y = float(candidate["y"])
    mapped_column, mapped_row = _pixel_from_normalized(
        requested_x, requested_y, (technical_width, technical_height),
    )
    requested_rgb_column, requested_rgb_row = _pixel_from_normalized(
        requested_x, requested_y, (rgb_width, rgb_height),
    )
    radius = _sample_radius(candidate, view)
    for dx, dy in _offsets(radius):
        column = min(technical_width - 1, max(0, mapped_column + dx))
        row = min(technical_height - 1, max(0, mapped_row + dy))
        yield {
            "x": (column + 0.5) / technical_width,
            "y": (row + 0.5) / technical_height,
            "column": column,
            "row": row,
            "dx": column - mapped_column,
            "dy": row - mapped_row,
            "requestedRgbPixel": [requested_rgb_column, requested_rgb_row],
            "mappedTechnicalPixel": [mapped_column, mapped_row],
            "searchRadiusTechnicalPixels": radius,
            "technicalResolution": [technical_width, technical_height],
        }


def _sample_projection(candidate: dict, view: dict, camera, classifications, anatomy_bvh, allowed_regions):
    tested = []
    allowed_region_ids = {
        int(anatomy_bvh.region_ids[name])
        for name in allowed_regions
        if anatomy_bvh is not None and name in anatomy_bvh.region_ids
    }
    for sample in _candidate_samples(candidate, view):
        x, y = float(sample["x"]), float(sample["y"])
        resolution = sample["technicalResolution"]
        if camera.data.type == "ORTHO":
            origin, direction = _orthographic_ray(camera, x, y, resolution)
        else:
            origin, direction = _perspective_ray(camera, x, y, resolution)

        technical = _technical_sample(view, sample["column"], sample["row"])
        if anatomy_bvh is not None:
            # Recasting verifies metadata/visibility; the lossless world-position
            # pass remains the primary 3D observation.
            hit = anatomy_bvh.ray_cast(origin, direction, allowed_regions)
            rejected = []
        else:
            allowed_classes = {"body"}
            if str(candidate.get("name") or "").startswith("eye_"):
                allowed_classes.add("eyes")
            hit, rejected = _cast_scene_fallback(origin, direction, classifications, allowed_classes)

        item = {
            **sample,
            "origin": origin, "direction": direction,
            "hit": hit, "technical": technical, "rejected": rejected,
        }
        world_position = technical.get("worldPosition") if technical else None
        if hit is None and world_position is None:
            item.update({"regionCompatible": False, "objectCompatible": False, "depthConfidence": 0.0,
                         "normalCompatibility": 0.0, "depthResidual": None, "eligible": False})
            tested.append(item)
            continue

        technical_point = Vector(tuple(world_position)) if world_position is not None else None
        hit_distance = float(
            (technical_point - origin).length
            if technical_point is not None
            else hit.get("distance") or (hit["location"] - origin).length
        )
        depth_observation = technical.get("depth") if technical else None
        depth_residual = abs(hit_distance - depth_observation) if depth_observation is not None else None
        expected_region_id = int(technical.get("regionId") or 0) if technical else 0
        expected_object_id = int(technical.get("objectId") or 0) if technical else 0
        secondary_mask = int(technical.get("secondaryRegionMask") or 0) if technical else 0
        secondary_region_compatible = any(
            secondary_mask & (1 << (region_id - 1))
            for region_id in allowed_region_ids
            if 0 < region_id <= 64
        )
        hit_region_penalty = float(hit.get("regionConfidencePenalty") or 1.0) if hit else 0.75
        region_compatible = bool(
            expected_region_id in allowed_region_ids
            or secondary_region_compatible
            or (hit is not None and hit_region_penalty > 0.0)
        )
        object_compatible = bool(
            expected_object_id == 0
            or hit is None
            or expected_object_id == int(hit.get("objectId") or 0)
        )
        verification_normal = hit["normal"] if hit is not None else Vector(tuple(technical.get("normal") or (0.0, 0.0, 1.0)))
        normal_compatibility = _normal_compatibility(
            verification_normal,
            technical.get("normal") if technical else None,
        )
        scale = max(float(camera.data.ortho_scale if camera.data.type == "ORTHO" else 1.0), 1e-5)
        depth_confidence = 0.5 if depth_residual is None else max(0.0, min(1.0, 1.0 - depth_residual / (scale * 0.025)))
        curvature = float(technical.get("curvature") or 0.0) if technical else 0.0
        curvature_confidence = max(0.0, 1.0 - min(curvature, 1.0) * 0.55)
        visibility = bool(technical and technical.get("valid") and world_position is not None)
        pixel_distance = (float(sample["dx"]) ** 2 + float(sample["dy"]) ** 2) ** 0.5
        radius = max(float(sample["searchRadiusTechnicalPixels"]), 1.0)
        pixel_confidence = max(0.0, 1.0 - pixel_distance / radius)
        eligible = bool(region_compatible and object_compatible and visibility and depth_confidence >= 0.25)
        score_components = {
            "pixelDistance": pixel_confidence,
            "region": hit_region_penalty if region_compatible else 0.0,
            "depth": depth_confidence,
            "normal": normal_compatibility,
            "curvature": curvature_confidence,
            "bodyObject": 1.0 if object_compatible else 0.0,
            "visibility": 1.0 if visibility else 0.0,
        }
        item.update({
            "hitDistance": hit_distance,
            "depthObservation": depth_observation,
            "depthResidual": depth_residual,
            "expectedRegionId": expected_region_id,
            "expectedObjectId": expected_object_id,
            "regionCompatible": region_compatible,
            "objectCompatible": object_compatible,
            "normalCompatibility": normal_compatibility,
            "depthConfidence": depth_confidence,
            "silhouette": visibility,
            "visibility": visibility,
            "worldPosition": world_position,
            "scoreComponents": score_components,
            "eligible": eligible,
            "score": 100.0 * (
                pixel_confidence * 0.18
                + score_components["region"] * 0.25
                + depth_confidence * 0.18
                + normal_compatibility * 0.10
                + curvature_confidence * 0.07
                + score_components["bodyObject"] * 0.10
                + score_components["visibility"] * 0.12
            ),
        })
        tested.append(item)

    eligible = [item for item in tested if item.get("eligible")]
    selected = max(eligible, key=lambda item: item.get("score", 0.0)) if eligible else None
    return selected, tested


def _failure_code(tested):
    if not any(item.get("hit") is not None for item in tested):
        return "LANDMARK_REGION_BVH_MISS"
    if not any(item.get("regionCompatible") for item in tested):
        return "LANDMARK_WRONG_REGION"
    if not any(item.get("silhouette") for item in tested):
        return "LANDMARK_SILHOUETTE_MISS"
    if not any(item.get("objectCompatible") for item in tested):
        return "LANDMARK_OBJECT_ID_MISMATCH"
    if not any(float(item.get("depthConfidence") or 0.0) >= 0.25 for item in tested):
        return "LANDMARK_DEPTH_INCONSISTENT"
    return "LANDMARK_TECHNICAL_PASS_MISMATCH"


def project_candidates(detector_output: dict, manifest: dict, classifications: Dict[str, str],
                       anatomy_bvh=None):
    view_lookup = {item["name"]: item for item in manifest.get("views", [])}
    projected: List[dict] = []
    failures: List[dict] = []
    for view_result in detector_output.get("views", []):
        view_name = view_result.get("name")
        view = view_lookup.get(view_name)
        if not view:
            failures.append({"code": "CAMERA_MANIFEST_MISSING", "view": view_name})
            continue
        camera = bpy.data.objects.get(view.get("cameraObject"))
        if camera is None or camera.type != "CAMERA":
            failures.append({"code": "CAMERA_OBJECT_MISSING", "view": view_name})
            continue
        allowed_regions = list(view.get("allowedRegions") or [])
        for candidate in view_result.get("candidates", []):
            selected, tested = _sample_projection(
                candidate, view, camera, classifications, anatomy_bvh, allowed_regions,
            )
            if selected is None:
                code = _failure_code(tested)
                failures.append({
                    "code": code,
                    "name": candidate.get("name"),
                    "landmark": candidate.get("name"),
                    "view": view_name,
                    "region": candidate.get("region"),
                    "side": candidate.get("side"),
                    "allowedRegions": allowed_regions,
                    "requestedPixel": [float(candidate["x"]), float(candidate["y"])],
                    "samplesTested": len(tested),
                    "matchingSamples": 0,
                    "failureStage": "projection",
                })
                continue

            hit = selected.get("hit") or {}
            technical = selected.get("technical") or {}
            world_position = technical.get("worldPosition") or selected.get("worldPosition")
            surface_point = (
                Vector(tuple(float(value) for value in world_position))
                if world_position is not None
                else hit["location"]
            )
            surface_normal_values = technical.get("normal")
            surface_normal = (
                Vector(tuple(float(value) for value in surface_normal_values))
                if surface_normal_values is not None
                else hit.get("normal") or Vector((0.0, 0.0, 1.0))
            )
            hit_distance = float(selected.get("hitDistance") or 0.0)
            depth_residual = selected.get("depthResidual")
            normal_compatibility = float(selected.get("normalCompatibility") or 0.0)
            depth_confidence = float(selected.get("depthConfidence") or 0.0)
            region_confidence = float(
                (selected.get("scoreComponents") or {}).get("region")
                or hit.get("regionConfidencePenalty")
                or 0.72
            )
            silhouette_confidence = 1.0
            geometry_confidence = (
                depth_confidence * 0.35 + normal_compatibility * 0.25
                + region_confidence * 0.30 + silhouette_confidence * 0.10
            )
            projected.append({
                **candidate,
                "position3d": _vec(surface_point),
                "worldPosition": _vec(surface_point),
                "surfaceNormal": _vec(surface_normal),
                "hitObject": hit.get("sourceObject") or "",
                "hitObjectClass": "anatomy_region",
                "hitRegion": hit.get("primaryRegion") or hit.get("region"),
                "primaryRegion": hit.get("primaryRegion") or hit.get("region"),
                "secondaryRegions": list(hit.get("secondaryRegions") or []),
                "semanticWeights": dict(hit.get("semanticWeights") or {}),
                "regionId": int(technical.get("regionId") or hit.get("regionId") or 0),
                "objectId": int(hit.get("objectId") or 0),
                "faceIndex": int(hit.get("sourcePolygon", technical.get("triangleId", -1))),
                "triangleIndex": int(technical.get("triangleId", hit.get("triangleIndex", -1))),
                "triangleId": int(technical.get("triangleId", hit.get("triangleIndex", -1))),
                "barycentricCoordinates": technical.get("barycentricCoordinates"),
                "sourceVertices": list(hit.get("sourceVertices") or []),
                "rayOrigin": _vec(selected["origin"]), "rayDirection": _vec(selected["direction"]),
                "rayHitDistance": hit_distance, "depthObservation": selected.get("depthObservation"),
                "depthResidual": depth_residual,
                "depthConfidence": depth_confidence,
                "normalCompatibility": normal_compatibility,
                "regionCompatibility": region_confidence,
                "silhouetteConfidence": silhouette_confidence,
                "viewCoverage": float(technical.get("coverage") or 0.0),
                "curvatureObservation": float(technical.get("curvature") or 0.0),
                "renderScope": view.get("renderScope"),
                "silhouettePath": view.get("silhouettePath"),
                "technicalPasses": view.get("technicalPasses"),
                "rejectedHits": selected.get("rejected") or [],
                "geometryConfidence": float(geometry_confidence),
                "requestedPixel": [float(candidate["x"]), float(candidate["y"])],
                "selectedPixel": [float(selected["x"]), float(selected["y"])],
                "pixelOffset": [int(selected["dx"]), int(selected["dy"])],
                "requestedRgbPixel": list(selected["requestedRgbPixel"]),
                "mappedTechnicalPixel": list(selected["mappedTechnicalPixel"]),
                "selectedTechnicalPixel": [int(selected["column"]), int(selected["row"])],
                "searchRadiusTechnicalPixels": int(selected["searchRadiusTechnicalPixels"]),
                "samplesTested": len(tested),
                "matchingSamples": sum(1 for item in tested if item.get("eligible")),
                "selectedRegionId": int(technical.get("regionId") or 0),
                "selectedDepthResidual": depth_residual,
                "selectedNormalCompatibility": normal_compatibility,
                "candidateScores": [
                    {
                        "technicalPixel": [int(item["column"]), int(item["row"])],
                        "score": float(item.get("score") or 0.0),
                        "eligible": bool(item.get("eligible")),
                        "components": item.get("scoreComponents") or {},
                    }
                    for item in sorted(
                        tested,
                        key=lambda item: float(item.get("score") or 0.0),
                        reverse=True,
                    )[:24]
                ],
                "legacyProjectionMethod": "adaptive-5x5-region-bvh-technical-pass-v3.2",
                "projectionMethod": "world-position-technical-pixel-search-v4.1" if anatomy_bvh is not None else "adaptive-scene-fallback-v4.1",
            })
    return projected, failures
