"""Pre-detector camera and ray-projection validation for Avatar Analyzer V4."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from analyzer_v4_contract import DEFAULT_CONFIG


def _float(value: Any, fallback: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def _determinant3(matrix: list[list[float]]) -> float:
    values = [[_float(matrix[row][column]) for column in range(3)] for row in range(3)]
    return (
        values[0][0] * (values[1][1] * values[2][2] - values[1][2] * values[2][1])
        - values[0][1] * (values[1][0] * values[2][2] - values[1][2] * values[2][0])
        + values[0][2] * (values[1][0] * values[2][1] - values[1][1] * values[2][0])
    )


def _matrix_valid(value: Any, minimum_determinant: float) -> tuple[bool, float]:
    if not isinstance(value, list) or len(value) != 4:
        return False, 0.0
    if any(not isinstance(row, list) or len(row) != 4 for row in value):
        return False, 0.0
    flat = [_float(component, float("nan")) for row in value for component in row]
    if not all(math.isfinite(component) for component in flat):
        return False, 0.0
    determinant = _determinant3(value)
    return abs(determinant) >= minimum_determinant, determinant


def _matrix_distance(first: Any, second: Any) -> float | None:
    if not isinstance(first, list) or len(first) != 4:
        return None
    try:
        return max(
            abs(float(first[row][column]) - float(second[row][column]))
            for row in range(4) for column in range(4)
        )
    except (TypeError, ValueError, IndexError):
        return None


def _measure_round_trip(view: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct sampled 3D surface points from pixel+depth and reproject.

    It is optional outside Blender, which keeps the pure contract unit-testable.
    Inside the Worker, missing/invalid depth or camera objects invalidate the view.
    """
    try:
        import bpy
        import numpy as np
        from mathutils import Vector
        from technical_passes import _camera_ray
    except Exception:
        return {"available": False, "reason": "blender_runtime_unavailable"}
    technical = view.get("technicalPasses") if isinstance(view.get("technicalPasses"), dict) else {}
    paths = technical.get("paths") if isinstance(technical.get("paths"), dict) else {}
    depth_path = Path(str(paths.get("depthNpy") or ""))
    region_path = Path(str(paths.get("regionIdNpy") or ""))
    camera = bpy.data.objects.get(str(view.get("cameraObject") or ""))
    if camera is None or not depth_path.is_file() or not region_path.is_file():
        return {"available": True, "valid": False, "reason": "camera_or_depth_id_missing"}
    try:
        depth = np.load(depth_path)
        region_ids = np.load(region_path)
    except Exception as exc:
        return {"available": True, "valid": False, "reason": f"technical_pass_load_failed:{exc}"}
    if depth.ndim != 2 or region_ids.shape != depth.shape:
        return {"available": True, "valid": False, "reason": "technical_pass_shape_mismatch"}
    height, width = depth.shape
    valid = np.argwhere(np.isfinite(depth) & (depth > 0.0) & (region_ids > 0))
    if len(valid) == 0:
        return {"available": True, "valid": False, "reason": "no_valid_depth_id_samples"}
    sample_indices = np.linspace(0, len(valid) - 1, min(16, len(valid)), dtype=int)
    aspect = float(width) / max(float(height), 1.0)
    inverse = camera.matrix_world.inverted_safe()
    errors = []
    depths = []
    clip_failures = 0
    for sample_index in sample_indices:
        row, column = [int(value) for value in valid[sample_index]]
        x = (column + 0.5) / float(width)
        y = (row + 0.5) / float(height)
        origin, direction = _camera_ray(camera, x, y, (width, height))
        distance = float(depth[row, column])
        point = origin + direction * distance
        local = inverse @ Vector(point)
        if camera.data.type == "ORTHO":
            projected_x = float(local.x) / (float(camera.data.ortho_scale) * aspect) + 0.5
            projected_y = 0.5 - float(local.y) / float(camera.data.ortho_scale)
        else:
            if float(local.z) >= -1e-9:
                clip_failures += 1
                continue
            tangent_y = math.tan(float(camera.data.angle_y) * 0.5)
            projected_x = (float(local.x) / (-float(local.z) * tangent_y * aspect) + 1.0) * 0.5
            projected_y = (1.0 - float(local.y) / (-float(local.z) * tangent_y)) * 0.5
        error = math.hypot((projected_x - x) * width, (projected_y - y) * height)
        errors.append(error)
        depths.append(distance)
        if distance < float(camera.data.clip_start) or distance > float(camera.data.clip_end):
            clip_failures += 1
    actual_matrix = [[float(camera.matrix_world[row][column]) for column in range(4)] for row in range(4)]
    matrix_error = _matrix_distance(view.get("matrixWorld"), actual_matrix)
    if not errors:
        return {"available": True, "valid": False, "reason": "round_trip_samples_unprojectable"}
    return {
        "available": True,
        "valid": clip_failures == 0,
        "sample_count": len(errors),
        "maximum_error_pixels": max(errors),
        "mean_error_pixels": sum(errors) / len(errors),
        "minimum_depth": min(depths),
        "maximum_depth": max(depths),
        "clip_failure_count": clip_failures,
        "manifest_camera_matrix_error": matrix_error,
        "depth_scale": "world_distance_along_camera_ray",
    }


def validate_view(view: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or DEFAULT_CONFIG
    minimum_determinant = float(config["camera"]["minimum_matrix_determinant"])
    maximum_round_trip = float(config["camera"]["maximum_round_trip_error_pixels"])
    name = str(view.get("name") or view.get("camera_id") or "unknown")
    matrix_valid, determinant = _matrix_valid(view.get("matrixWorld") or view.get("object_to_world"), minimum_determinant)
    resolution = view.get("resolution") or [0, 0]
    resolution_valid = (
        isinstance(resolution, list) and len(resolution) == 2
        and int(resolution[0] or 0) > 0 and int(resolution[1] or 0) > 0
    )
    direction = view.get("directionToCamera") or []
    direction_length = math.sqrt(sum(_float(value) ** 2 for value in direction)) if isinstance(direction, list) else 0.0
    direction_valid = 0.95 <= direction_length <= 1.05
    ortho_scale = _float(view.get("orthoScale"))
    clipping_valid = bool(ortho_scale > 0.0 and not view.get("clippingDetected", False))
    technical = view.get("technicalPasses") if isinstance(view.get("technicalPasses"), dict) else {}
    paths = technical.get("paths") if isinstance(technical.get("paths"), dict) else {}
    pass_names = {
        "depth": paths.get("depthNpy") or paths.get("depth") or technical.get("depthPath"),
        "normal": paths.get("normalNpy") or paths.get("normal") or technical.get("normalPath"),
        "region_id": paths.get("regionIdNpy") or paths.get("regionId") or technical.get("regionIdPath"),
        "object_id": paths.get("objectIdNpy") or paths.get("objectId") or technical.get("objectIdPath"),
        "silhouette": paths.get("exactSilhouettePng") or view.get("silhouettePath"),
    }
    technical_passes_valid = all(bool(value) for value in pass_names.values())
    measured = _measure_round_trip(view)
    measured_error = measured.get("maximum_error_pixels") if measured.get("available") else None
    round_trip_error = _float(
        measured_error if measured_error is not None else view.get("roundTripErrorPixels", technical.get("roundTripErrorPixels", 0.0)),
        float("inf"),
    )
    round_trip_measured = math.isfinite(round_trip_error)
    round_trip_valid = (not round_trip_measured) or round_trip_error <= maximum_round_trip
    if measured.get("available") and not measured.get("valid", True):
        round_trip_valid = False
    manifest_matrix_error = measured.get("manifest_camera_matrix_error")
    matrix_matches_runtime = manifest_matrix_error is None or float(manifest_matrix_error) <= 1e-6
    handedness = "mirrored" if determinant < 0.0 else "right_handed"
    failures = []
    for condition, code in (
        (matrix_valid, "MATRIX_INVERTIBILITY_FAILED"),
        (resolution_valid, "INVALID_RENDER_RESOLUTION"),
        (direction_valid, "CAMERA_DIRECTION_INVALID"),
        (clipping_valid, "NEAR_FAR_OR_FRAMING_INVALID"),
        (technical_passes_valid, "TECHNICAL_PASSES_MISSING"),
        (round_trip_valid, "ROUND_TRIP_ERROR_EXCEEDED"),
        (matrix_matches_runtime, "CAMERA_MATRIX_RUNTIME_MISMATCH"),
    ):
        if not condition:
            failures.append(code)
    return {
        "camera_id": name,
        "valid": not failures,
        "failures": failures,
        "object_to_world_valid": matrix_valid,
        "world_to_camera_valid": matrix_valid,
        "camera_to_clip_valid": resolution_valid and ortho_scale > 0.0,
        "clip_to_pixel_valid": resolution_valid,
        "matrix_determinant": determinant,
        "handedness": handedness,
        "vertical_axis": "+Z",
        "front_axis": "-Y",
        "direction_length": direction_length,
        "ortho_scale": ortho_scale,
        "technical_passes": pass_names,
        "round_trip_error_pixels": round_trip_error if round_trip_measured else None,
        "round_trip_error_measured": round_trip_measured,
        "round_trip_diagnostics": measured,
        "matrix_matches_runtime": matrix_matches_runtime,
        "maximum_round_trip_error_pixels": maximum_round_trip,
    }


def validate_manifest(manifest: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    views = [item for item in manifest.get("views") or [] if isinstance(item, dict)]
    reports = [validate_view(item, config) for item in views]
    invalid = [item["camera_id"] for item in reports if not item["valid"]]
    return {
        "version": "clouva-camera-projection-self-test-v4.0",
        "manifest_version": manifest.get("version"),
        "views": reports,
        "valid_views": [item["camera_id"] for item in reports if item["valid"]],
        "invalid_views": invalid,
        "all_views_invalid": bool(reports and len(invalid) == len(reports)),
        "status": "valid" if not invalid else "invalid",
        "root_failure": "CAMERA_PROJECTION_INVALID" if invalid else None,
    }


def filter_invalid_views(manifest: dict[str, Any], calibration: dict[str, Any]) -> dict[str, Any]:
    invalid = set(calibration.get("invalid_views") or [])
    filtered = dict(manifest)
    filtered["views"] = [
        item for item in manifest.get("views") or []
        if str(item.get("name") or "") not in invalid
    ]
    filtered["invalidatedViews"] = sorted(invalid)
    filtered["cameraProjectionSelfTest"] = calibration
    return filtered
