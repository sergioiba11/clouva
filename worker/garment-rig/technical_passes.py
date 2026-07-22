"""Generate exact per-pixel geometry passes from AnatomyBVH.

The arrays are saved as NPY for lossless validation and as PNG for human
inspection. Pixels use top-left image coordinates, matching MediaPipe x/y.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Sequence

import bpy
import numpy as np
from mathutils import Vector


def _camera_ray(camera: bpy.types.Object, x: float, y: float, resolution: Sequence[int]):
    width, height = int(resolution[0]), int(resolution[1])
    aspect = float(width) / max(float(height), 1.0)
    if camera.data.type == "ORTHO":
        local_x = (float(x) - 0.5) * float(camera.data.ortho_scale) * aspect
        local_y = (0.5 - float(y)) * float(camera.data.ortho_scale)
        origin = camera.matrix_world @ Vector((local_x, local_y, 0.0))
        direction = camera.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    else:
        import math
        ndc_x = float(x) * 2.0 - 1.0
        ndc_y = 1.0 - float(y) * 2.0
        tangent_y = math.tan(float(camera.data.angle_y) * 0.5)
        local = Vector((ndc_x * tangent_y * aspect, ndc_y * tangent_y, -1.0)).normalized()
        origin = camera.matrix_world.translation.copy()
        direction = camera.matrix_world.to_3x3() @ local
    if direction.length > 1e-8:
        direction.normalize()
    return origin, direction


def _save_png(path: Path, rgba: np.ndarray):
    height, width, _channels = rgba.shape
    image = bpy.data.images.new(path.stem, width=width, height=height, alpha=True, float_buffer=False)
    try:
        flipped = np.flipud(np.clip(rgba, 0.0, 1.0)).astype(np.float32)
        image.pixels.foreach_set(flipped.reshape(-1))
        image.filepath_raw = str(path)
        image.file_format = "PNG"
        image.save()
    finally:
        bpy.data.images.remove(image)


def _normalize_depth(depth: np.ndarray):
    valid = np.isfinite(depth) & (depth > 0.0)
    output = np.zeros((*depth.shape, 4), dtype=np.float32)
    if np.any(valid):
        values = depth[valid]
        near = float(np.percentile(values, 1.0))
        far = float(np.percentile(values, 99.0))
        denominator = max(far - near, 1e-8)
        normalized = 1.0 - np.clip((depth - near) / denominator, 0.0, 1.0)
        output[..., :3] = normalized[..., None]
        output[..., 3] = valid.astype(np.float32)
    return output


def _id_rgba(values: np.ndarray, maximum: int):
    output = np.zeros((*values.shape, 4), dtype=np.float32)
    valid = values > 0
    if maximum > 0:
        normalized = values.astype(np.float32) / float(maximum)
        output[..., 0] = np.mod(normalized * 7.0, 1.0)
        output[..., 1] = np.mod(normalized * 13.0, 1.0)
        output[..., 2] = np.mod(normalized * 23.0, 1.0)
    output[..., 3] = valid.astype(np.float32)
    return output


def _curvature_from_normals(normals: np.ndarray, valid: np.ndarray):
    encoded = normals.copy()
    gx = np.zeros(valid.shape, dtype=np.float32)
    gy = np.zeros(valid.shape, dtype=np.float32)
    gx[:, 1:] = np.linalg.norm(encoded[:, 1:] - encoded[:, :-1], axis=2)
    gy[1:, :] = np.linalg.norm(encoded[1:, :] - encoded[:-1, :], axis=2)
    curvature = np.clip((gx + gy) * 1.75, 0.0, 1.0)
    curvature[~valid] = 0.0
    rgba = np.zeros((*valid.shape, 4), dtype=np.float32)
    rgba[..., :3] = curvature[..., None]
    rgba[..., 3] = valid.astype(np.float32)
    return curvature, rgba


def generate_technical_passes(output_dir: Path, view_name: str, camera: bpy.types.Object,
                              anatomy_bvh, allowed_regions: str | Iterable[str],
                              resolution: int = 192):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    allowed = [allowed_regions] if isinstance(allowed_regions, str) else list(allowed_regions)
    width = height = int(max(64, resolution))
    depth = np.full((height, width), np.nan, dtype=np.float32)
    normals = np.zeros((height, width, 3), dtype=np.float32)
    region_ids = np.zeros((height, width), dtype=np.int16)
    object_ids = np.zeros((height, width), dtype=np.int16)
    triangle_ids = np.full((height, width), -1, dtype=np.int32)

    for row in range(height):
        y = (row + 0.5) / float(height)
        for column in range(width):
            x = (column + 0.5) / float(width)
            origin, direction = _camera_ray(camera, x, y, (width, height))
            hit = anatomy_bvh.ray_cast(origin, direction, allowed)
            if hit is None:
                continue
            depth[row, column] = float(hit["distance"])
            normal = hit["normal"]
            if normal.length > 1e-8:
                normal = normal.normalized()
            normals[row, column] = (float(normal.x), float(normal.y), float(normal.z))
            region_ids[row, column] = int(hit.get("regionId") or 0)
            object_ids[row, column] = int(hit.get("objectId") or 0)
            triangle_ids[row, column] = int(hit.get("triangleIndex", -1))

    valid = region_ids > 0
    np.save(output_dir / f"{view_name}_depth.npy", depth)
    np.save(output_dir / f"{view_name}_normal.npy", normals)
    np.save(output_dir / f"{view_name}_region_id.npy", region_ids)
    np.save(output_dir / f"{view_name}_object_id.npy", object_ids)
    np.save(output_dir / f"{view_name}_triangle_id.npy", triangle_ids)

    normal_rgba = np.zeros((height, width, 4), dtype=np.float32)
    normal_rgba[..., :3] = normals * 0.5 + 0.5
    normal_rgba[..., 3] = valid.astype(np.float32)
    silhouette_rgba = np.zeros((height, width, 4), dtype=np.float32)
    silhouette_rgba[..., :3] = valid[..., None].astype(np.float32)
    silhouette_rgba[..., 3] = 1.0
    curvature, curvature_rgba = _curvature_from_normals(normals, valid)
    np.save(output_dir / f"{view_name}_curvature.npy", curvature.astype(np.float32))

    paths = {
        "depthNpy": str(output_dir / f"{view_name}_depth.npy"),
        "normalNpy": str(output_dir / f"{view_name}_normal.npy"),
        "regionIdNpy": str(output_dir / f"{view_name}_region_id.npy"),
        "objectIdNpy": str(output_dir / f"{view_name}_object_id.npy"),
        "triangleIdNpy": str(output_dir / f"{view_name}_triangle_id.npy"),
        "curvatureNpy": str(output_dir / f"{view_name}_curvature.npy"),
        "depthPng": str(output_dir / f"{view_name}_depth.png"),
        "normalPng": str(output_dir / f"{view_name}_normal.png"),
        "regionIdPng": str(output_dir / f"{view_name}_region_id.png"),
        "objectIdPng": str(output_dir / f"{view_name}_object_id.png"),
        "curvaturePng": str(output_dir / f"{view_name}_curvature.png"),
        "exactSilhouettePng": str(output_dir / f"{view_name}_exact_silhouette.png"),
    }
    _save_png(Path(paths["depthPng"]), _normalize_depth(depth))
    _save_png(Path(paths["normalPng"]), normal_rgba)
    _save_png(Path(paths["regionIdPng"]), _id_rgba(region_ids, max(anatomy_bvh.region_ids.values(), default=0)))
    _save_png(Path(paths["objectIdPng"]), _id_rgba(object_ids, max(anatomy_bvh.object_ids.values(), default=0)))
    _save_png(Path(paths["curvaturePng"]), curvature_rgba)
    _save_png(Path(paths["exactSilhouettePng"]), silhouette_rgba)

    report = {
        "version": "clouva-technical-passes-v3",
        "view": view_name,
        "resolution": [width, height],
        "allowedRegions": allowed,
        "validPixelCount": int(np.count_nonzero(valid)),
        "coverage": float(np.count_nonzero(valid) / max(width * height, 1)),
        "regionIds": anatomy_bvh.region_ids,
        "objectIds": anatomy_bvh.object_ids,
        "paths": paths,
    }
    report_path = output_dir / f"{view_name}_technical.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["reportPath"] = str(report_path)
    return report
