"""Selective sparse renderer for CLOUVA Avatar Analyzer V4.2.

Normal production mode emits RGB + silhouette and relies on sparse ray casts for
2D candidates. Lossless full-frame technical maps remain available behind
CLOUVA_ANALYZER_FULL_TECHNICAL_PASSES=true.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Dict, Iterable, Sequence

import bpy
from mathutils import Vector

from analyzer_v42_incremental import CAMERA_RIG_VERSION, MODULE_CAMERAS
from multiview_renderer import (
    _average,
    _build_proxies,
    _configure_scene,
    _matrix,
    _new_camera,
    _points if False else None,
)
from multiview_renderer import _render_edges, _render_mask, _set_visible_meshes, cleanup_render_proxies
from technical_passes import generate_technical_passes

BODY_REGIONS = (
    "torso", "pelvis", "neck", "head", "eyes", "upper_arm_l", "forearm_l", "hand_l",
    "upper_arm_r", "forearm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r",
)

BODY_DIRECTIONS = {
    "body_front": Vector((0.0, -1.0, 0.0)),
    "body_back": Vector((0.0, 1.0, 0.0)),
    "body_left": Vector((1.0, 0.0, 0.0)),
    "body_right": Vector((-1.0, 0.0, 0.0)),
}
FACE_DIRECTIONS = {
    "face_front": Vector((0.0, -1.0, 0.0)),
    "face_left_30": Vector((0.5, -0.866, 0.0)),
    "face_right_30": Vector((-0.5, -0.866, 0.0)),
}


def _truthy_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _scene_meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not bool(obj.get("clouva_visual_only", False))]


def _all_points(objects: Sequence[bpy.types.Object]):
    return [obj.matrix_world @ vertex.co for obj in objects if obj and obj.type == "MESH" for vertex in obj.data.vertices]


def _bounds(meshes):
    points = _all_points(meshes)
    if not points:
        raise RuntimeError("V4.2 selective renderer requires mesh geometry")
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum, maximum - minimum


def _camera_axes(direction: Vector):
    direction = direction.normalized()
    rotation = (-direction).to_track_quat("-Z", "Y")
    right = rotation @ Vector((1.0, 0.0, 0.0))
    up = rotation @ Vector((0.0, 1.0, 0.0))
    right.normalize(); up.normalize()
    return right, up


def _projected_extent(points, direction: Vector, fallback: float):
    if not points:
        return max(fallback, 0.02)
    right, up = _camera_axes(direction)
    horizontal = [point.dot(right) for point in points]
    vertical = [point.dot(up) for point in points]
    return max(max(horizontal) - min(horizontal), max(vertical) - min(vertical), fallback * 0.72, 0.02)


def _coverage_from_silhouette(path: str | None) -> float:
    if not path or not Path(path).is_file():
        return 0.0
    try:
        import numpy as np
        from PIL import Image
        image = np.asarray(Image.open(path).convert("L"), dtype=np.uint8)
        return float((image > 16).mean())
    except Exception:
        return 0.0


def _render_sparse_view(
    scene,
    output_dir: Path,
    name: str,
    region: str,
    side: str | None,
    target: Vector,
    direction: Vector,
    region_size: float,
    visible_objects,
    all_meshes,
    anatomy_bvh,
    allowed_regions,
    *,
    framing: float,
    technical_resolution: int,
    full_technical_passes: bool,
):
    _set_visible_meshes(all_meshes, visible_objects)
    camera = _new_camera(f"CLOUVA_CAMERA_{name}", target, direction, region_size, framing)
    scene.camera = camera
    path = output_dir / f"{name}.png"
    scene.render.filepath = str(path)
    scene.display.shading.color_type = "MATERIAL"
    bpy.ops.render.render(write_still=True)
    silhouette = _render_mask(scene, output_dir / f"{name}_silhouette.png")
    edge_path = _render_edges(scene, output_dir / f"{name}_edges.png") if _truthy_env("CLOUVA_ANALYZER_RENDER_EDGES", False) else None
    technical = None
    if full_technical_passes and anatomy_bvh is not None:
        technical = generate_technical_passes(
            output_dir, name, camera, anatomy_bvh, allowed_regions, technical_resolution,
        )
        exact = (technical.get("paths") or {}).get("exactSilhouettePng") if technical else None
        if exact:
            silhouette = exact
    coverage = float((technical or {}).get("coverage") or _coverage_from_silhouette(silhouette))
    return {
        "name": name,
        "region": region,
        "side": side,
        "path": str(path),
        "edgePath": edge_path,
        "silhouettePath": silhouette,
        "cameraObject": camera.name,
        "cameraType": camera.data.type,
        "orthoScale": float(camera.data.ortho_scale),
        "matrixWorld": _matrix(camera.matrix_world),
        "resolution": [int(scene.render.resolution_x), int(scene.render.resolution_y)],
        "target": _vec(target),
        "directionToCamera": _vec(direction.normalized()),
        "allowedRegions": list(allowed_regions),
        "technicalPasses": technical,
        "projectionMode": "full_technical_passes" if technical else "sparse_ray_cast",
        "sparseProjection": technical is None,
        "silhouetteCoverage": coverage,
        "framingValid": bool(0.001 <= coverage <= 0.965),
        "clippingDetected": bool(coverage >= 0.965),
        "rendered": path.is_file() and path.stat().st_size > 0,
    }


def _hand_directions(measurement: dict, suffix: str):
    normal = Vector(tuple(measurement.get("normal") or (0.0, -1.0, 0.0)))
    lateral = Vector(tuple(measurement.get("lateral") or ((1.0, 0.0, 0.0) if suffix == "l" else (-1.0, 0.0, 0.0))))
    if normal.length <= 1e-8:
        normal = Vector((0.0, -1.0, 0.0))
    if lateral.length <= 1e-8:
        lateral = Vector((1.0 if suffix == "l" else -1.0, 0.0, 0.0))
    normal.normalize(); lateral.normalize()
    return {
        f"hand_{suffix}_dorsal": normal,
        f"hand_{suffix}_palmar": -normal,
        f"hand_{suffix}_radial": lateral,
        f"hand_{suffix}_ulnar": -lateral,
        f"hand_{suffix}_oblique": (normal + lateral * 0.62).normalized(),
    }


def render_multiview_v42(
    output_dir: Path,
    vectors: Dict[str, Vector],
    height: float,
    *,
    modules: Iterable[str],
    cameras: Iterable[str] | None = None,
    meshes: Iterable[bpy.types.Object] | None = None,
    segmentation=None,
    classifications: dict | None = None,
    anatomy_bvh=None,
    config: dict | None = None,
):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    modules = list(dict.fromkeys(str(value) for value in modules))
    requested_cameras = {str(value) for value in cameras or [] if value}
    meshes = list(meshes or _scene_meshes())
    classifications = classifications or {}
    config = config or {}
    render_config = config.get("render") or {}
    body_resolution = int(render_config.get("body_resolution") or 384)
    face_resolution = int(render_config.get("face_crop_resolution") or 384)
    hand_resolution = int(render_config.get("hand_crop_resolution") or 320)
    technical_resolution = int(render_config.get("technical_resolution") or 160)
    full_technical_passes = _truthy_env("CLOUVA_ANALYZER_FULL_TECHNICAL_PASSES", False)
    proxies = _build_proxies(meshes, segmentation, classifications, anatomy_bvh)
    all_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    original_hide = {obj.name: bool(obj.hide_render) for obj in all_meshes}
    views = []
    rendered = 0
    skipped = 0

    def wanted(name: str, module: str) -> bool:
        nonlocal skipped
        default = name in MODULE_CAMERAS.get(module, ()) or name.endswith("_oblique")
        selected = name in requested_cameras if requested_cameras else default
        if not selected:
            skipped += 1
        return selected

    try:
        minimum, maximum, size = _bounds(meshes)
        if "body" in modules and requested_cameras:
            scene = _configure_scene(output_dir, body_resolution)
            target = (minimum + maximum) * 0.5
            region_size = max(float(size.z), float(height), 0.02)
            for name, direction in BODY_DIRECTIONS.items():
                if not wanted(name, "body"):
                    continue
                views.append(_render_sparse_view(scene, output_dir, name, "body", None, target, direction, region_size, meshes, all_meshes, anatomy_bvh, BODY_REGIONS, framing=1.14, technical_resolution=technical_resolution, full_technical_passes=full_technical_passes))
                rendered += 1

        if "face" in modules:
            scene = _configure_scene(output_dir, face_resolution)
            skull_base = vectors["skull_base"]
            head_top = vectors["head_top"]
            points = segmentation.region_points(("head", "neck")) if segmentation else []
            target = _average(points, skull_base.lerp(head_top, 0.54))
            region_size = max((head_top - skull_base).length * 1.18, height * 0.12)
            visible = proxies["face"] or meshes
            for name, direction in FACE_DIRECTIONS.items():
                if not wanted(name, "face"):
                    continue
                views.append(_render_sparse_view(scene, output_dir, name, "face", None, target, direction, region_size, visible, all_meshes, anatomy_bvh, ("head", "eyes"), framing=1.78, technical_resolution=technical_resolution, full_technical_passes=full_technical_passes))
                rendered += 1

        for module, side, suffix in (("left_hand", "left", "l"), ("right_hand", "right", "r")):
            if module not in modules:
                continue
            scene = _configure_scene(output_dir, hand_resolution)
            measurement = segmentation.hand_measurement(side) if segmentation else {}
            wrist = vectors[f"wrist_{suffix}"]
            distal = vectors[f"hand_{suffix}"]
            proxy = anatomy_bvh.proxy((f"forearm_{suffix}", f"hand_{suffix}"), f"CLOUVA_PROXY_{side}_HAND_CONTEXT_V42") if anatomy_bvh is not None else None
            visible = [proxy] if proxy is not None else (proxies[side] or meshes)
            if proxy is not None and proxy not in proxies[side]:
                proxies[side].append(proxy)
            points = _all_points(visible)
            target = _average(points, wrist.lerp(distal, 0.56))
            hand_scale = max(float(measurement.get("handScale") or 0.0), (distal - wrist).length * 1.35, height * 0.055)
            allowed = [f"forearm_{suffix}", f"hand_{suffix}"] + [f"{finger}_{suffix}" for finger in ("thumb", "index", "middle", "ring", "pinky") if anatomy_bvh is not None and anatomy_bvh.has_region(f"{finger}_{suffix}")]
            directions = _hand_directions(measurement, suffix)
            side_valid = 0
            for name, direction in directions.items():
                if not wanted(name, module):
                    continue
                fitted = _projected_extent(points, direction, hand_scale)
                view = _render_sparse_view(scene, output_dir, name, "hand", side, target, direction, fitted, visible, all_meshes, anatomy_bvh, allowed, framing=1.10, technical_resolution=technical_resolution, full_technical_passes=full_technical_passes)
                views.append(view)
                rendered += 1
                if view["framingValid"]:
                    side_valid += 1
                # Production early exit: two technically valid views are enough to
                # run sparse projection. Oblique remains available when explicitly requested.
                if not requested_cameras and side_valid >= 2:
                    skipped += max(0, len(directions) - 2)
                    break
    finally:
        for obj in all_meshes:
            if obj.name in original_hide:
                obj.hide_render = original_hide[obj.name]
        for group in proxies.values():
            for proxy in group:
                proxy.hide_render = True

    manifest = {
        "version": CAMERA_RIG_VERSION,
        "renderer": "BLENDER_WORKBENCH_SPARSE_RAY_CAST",
        "projectionMode": "full_technical_passes" if full_technical_passes else "sparse_ray_cast",
        "frontConvention": "-Y",
        "upConvention": "+Z",
        "modules": modules,
        "requestedCameras": sorted(requested_cameras),
        "views": views,
        "camerasRendered": rendered,
        "camerasSkipped": skipped,
        "fullTechnicalPassesGenerated": rendered if full_technical_passes else 0,
        "sparseProjectionsEnabled": not full_technical_passes,
        "cleanupProxyNames": sorted({proxy.name for group in proxies.values() for proxy in group}),
    }
    (output_dir / "camera_manifest_v42.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


__all__ = ["render_multiview_v42", "cleanup_render_proxies"]
