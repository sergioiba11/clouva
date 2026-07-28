"""Adaptive body, face and context-aware per-hand camera rig for Avatar Analyzer V4.1."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import bpy
from mathutils import Vector

from analyzer_v4_contract import DEFAULT_CONFIG
from multiview_renderer import _average, _build_proxies, _configure_scene, _render_view, cleanup_render_proxies

BODY_DIRECTIONS = {
    "body_front": Vector((0.0, -1.0, 0.0)), "body_back": Vector((0.0, 1.0, 0.0)),
    "body_left": Vector((1.0, 0.0, 0.0)), "body_right": Vector((-1.0, 0.0, 0.0)),
    "body_front_left_45": Vector((0.7071, -0.7071, 0.0)), "body_front_right_45": Vector((-0.7071, -0.7071, 0.0)),
    "body_back_left_45": Vector((0.7071, 0.7071, 0.0)), "body_back_right_45": Vector((-0.7071, 0.7071, 0.0)),
}
FACE_DIRECTIONS = {
    "face_front": Vector((0.0, -1.0, 0.0)), "face_left_30": Vector((0.5, -0.866, 0.0)),
    "face_right_30": Vector((-0.5, -0.866, 0.0)), "face_left_60": Vector((0.866, -0.5, 0.0)),
    "face_right_60": Vector((-0.866, -0.5, 0.0)), "face_left_profile": Vector((1.0, 0.0, 0.0)),
    "face_right_profile": Vector((-1.0, 0.0, 0.0)),
}
BODY_REGIONS = (
    "torso", "pelvis", "neck", "head", "eyes", "upper_arm_l", "forearm_l", "hand_l",
    "upper_arm_r", "forearm_r", "hand_r", "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r",
)
HAND_TARGET_COVERAGE = 0.42
HAND_MIN_COVERAGE = 0.15
HAND_MAX_COVERAGE = 0.90


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _proxy_vertex_count(objects):
    return sum(len(obj.data.vertices) for obj in objects if obj and obj.type == "MESH")


def _points(objects: Sequence[bpy.types.Object]):
    return [obj.matrix_world @ vertex.co for obj in objects if obj and obj.type == "MESH" for vertex in obj.data.vertices]


def _point_bounds(points):
    if not points:
        return {"minimum": [0.0, 0.0, 0.0], "maximum": [0.0, 0.0, 0.0], "size": [0.0, 0.0, 0.0]}
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return {"minimum": _vec(minimum), "maximum": _vec(maximum), "size": _vec(maximum - minimum)}


def _camera_axes(direction: Vector):
    direction = direction.normalized()
    rotation = (-direction).to_track_quat("-Z", "Y")
    right = rotation @ Vector((1.0, 0.0, 0.0)); up = rotation @ Vector((0.0, 1.0, 0.0))
    right.normalize(); up.normalize()
    return right, up


def _projected_extent(points, direction, fallback):
    if not points:
        return max(fallback, 0.02), {"right": [1.0, 0.0, 0.0], "up": [0.0, 0.0, 1.0], "width": fallback, "height": fallback}
    right, up = _camera_axes(direction)
    horizontal = [point.dot(right) for point in points]; vertical = [point.dot(up) for point in points]
    width = max(horizontal) - min(horizontal); height = max(vertical) - min(vertical)
    return max(width, height, fallback * 0.72, 0.02), {"right": _vec(right), "up": _vec(up), "width": float(width), "height": float(height)}


def _enrich(view, visible, attempt, crop):
    technical = view.get("technicalPasses") or {}; coverage = float(technical.get("coverage") or 0.0)
    path = Path(str(view.get("path") or ""))
    view.update({
        "attempt": attempt, "crop": crop, "rendered": path.is_file() and path.stat().st_size > 0,
        "proxyVertexCount": _proxy_vertex_count(visible), "silhouetteCoverage": coverage,
        "framingValid": bool(0.001 <= coverage <= 0.965), "clippingDetected": bool(coverage >= 0.965),
    })
    return view


def _scene_meshes():
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not bool(obj.get("clouva_visual_only", False))]


def _bounds(meshes):
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    if not points:
        raise RuntimeError("Adaptive camera rig requires mesh geometry")
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum, maximum - minimum


def _hand_detection_proxy(anatomy_bvh, side, suffix, fallback):
    if anatomy_bvh is None:
        return list(fallback)
    proxy = anatomy_bvh.proxy((f"forearm_{suffix}", f"hand_{suffix}"), f"CLOUVA_PROXY_{side}_HAND_CONTEXT_V41")
    return [proxy] if proxy is not None else list(fallback)


def _coverage_adjusted_framing(coverage, framing):
    if coverage <= 0.0:
        return max(0.62, framing * 0.58)
    return max(0.62, min(2.40, framing * math.sqrt(coverage / HAND_TARGET_COVERAGE)))


def render_multiview_v4(output_dir: Path, vectors: Dict[str, Vector], height: float, meshes: Iterable[bpy.types.Object] | None = None,
                        segmentation=None, classifications: dict | None = None, anatomy_bvh=None, attempt: str = "v4", config: dict | None = None):
    config = config or DEFAULT_CONFIG; output_dir = Path(output_dir); meshes = list(meshes or _scene_meshes()); classifications = classifications or {}
    proxies = _build_proxies(meshes, segmentation, classifications, anatomy_bvh)
    all_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    original_hide = {obj.name: bool(obj.hide_render) for obj in all_meshes}; views: List[dict] = []; hand_diagnostics = {}
    body_resolution = int(config["render"]["body_resolution"]); face_resolution = int(config["render"]["face_crop_resolution"])
    hand_resolution = int(config["render"]["hand_crop_resolution"]); technical_resolution = int(config["render"]["technical_resolution"])
    try:
        minimum, maximum, size = _bounds(meshes); body_target = (minimum + maximum) * 0.5; body_size = max(float(size.z), height, 0.02)
        body_scene = _configure_scene(output_dir, body_resolution)
        for name, direction in BODY_DIRECTIONS.items():
            views.append(_enrich(_render_view(body_scene, output_dir, name, "body", None, body_target, direction, body_size, meshes, all_meshes,
                                               anatomy_bvh, BODY_REGIONS, framing=1.14, technical_resolution=technical_resolution), meshes, attempt, "body"))
        face_scene = _configure_scene(output_dir, face_resolution); skull_base = vectors["skull_base"]; head_top = vectors["head_top"]
        head_points = segmentation.region_points(("head", "neck")) if segmentation else []; face_target = _average(head_points, skull_base.lerp(head_top, 0.54))
        face_size = max((head_top - skull_base).length * 1.18, height * 0.12); face_visible = proxies["face"] or meshes
        for name, direction in FACE_DIRECTIONS.items():
            views.append(_enrich(_render_view(face_scene, output_dir, name, "face", None, face_target, direction, face_size, face_visible, all_meshes,
                                               anatomy_bvh, ("head", "eyes"), framing=1.78, technical_resolution=technical_resolution), face_visible, attempt, "face"))
        hand_scene = _configure_scene(output_dir, hand_resolution)
        for side, suffix in (("left", "l"), ("right", "r")):
            wrist = vectors[f"wrist_{suffix}"]; distal = vectors[f"hand_{suffix}"]; measurement = segmentation.hand_measurement(side) if segmentation else {}
            detection_visible = _hand_detection_proxy(anatomy_bvh, side, suffix, proxies[side] or meshes)
            for proxy in detection_visible:
                if proxy.name not in [item.name for item in proxies[side]]:
                    proxies[side].append(proxy)
            detection_points = _points(detection_visible); target = _average(detection_points, wrist.lerp(distal, 0.56))
            hand_size = max(float(measurement.get("handScale") or 0.0), (distal - wrist).length * 1.35, height * 0.055)
            normal = Vector(tuple(measurement.get("normal") or (0.0, -1.0, 0.0))); lateral = Vector(tuple(measurement.get("lateral") or ((1.0, 0.0, 0.0) if suffix == "l" else (-1.0, 0.0, 0.0))))
            forward = Vector(tuple(measurement.get("forward") or (0.0, 0.0, -1.0)))
            if normal.length <= 1e-8: normal = Vector((0.0, -1.0, 0.0))
            if lateral.length <= 1e-8: lateral = Vector((1.0 if suffix == "l" else -1.0, 0.0, 0.0))
            if forward.length <= 1e-8: forward = Vector((0.0, 0.0, -1.0))
            normal.normalize(); lateral.normalize(); forward.normalize()
            directions = {
                f"hand_{suffix}_dorsal": normal, f"hand_{suffix}_palmar": -normal, f"hand_{suffix}_radial": lateral,
                f"hand_{suffix}_ulnar": -lateral, f"hand_{suffix}_distal": -forward,
                f"hand_{suffix}_three_quarter_dorsal": (normal + lateral * 0.62 + forward * 0.12).normalized(),
                f"hand_{suffix}_three_quarter_palmar": (-normal - lateral * 0.62 + forward * 0.12).normalized(),
            }
            allowed = [f"forearm_{suffix}", f"hand_{suffix}"] + [f"{finger}_{suffix}" for finger in ("thumb", "index", "middle", "ring", "pinky") if anatomy_bvh is not None and anatomy_bvh.has_region(f"{finger}_{suffix}")]
            side_views = []
            for name, direction in directions.items():
                fitted_size, axes = _projected_extent(detection_points, direction, hand_size); initial_framing = 1.10
                first = _enrich(_render_view(hand_scene, output_dir, name, "hand", side, target, direction, fitted_size, detection_visible, all_meshes,
                                              anatomy_bvh, allowed, framing=initial_framing, technical_resolution=technical_resolution), detection_visible, attempt, f"hand_{suffix}")
                before = float(first.get("silhouetteCoverage") or 0.0); retried = before < HAND_MIN_COVERAGE or before > HAND_MAX_COVERAGE
                final_view = first; retry_framing = initial_framing
                if retried:
                    retry_framing = _coverage_adjusted_framing(before, initial_framing)
                    final_view = _enrich(_render_view(hand_scene, output_dir, name, "hand", side, target, direction, fitted_size, detection_visible, all_meshes,
                                                       anatomy_bvh, allowed, framing=retry_framing, technical_resolution=technical_resolution), detection_visible, f"{attempt}_autofit", f"hand_{suffix}")
                after = float(final_view.get("silhouetteCoverage") or 0.0)
                final_view.update({
                    "wristTarget": _vec(wrist), "distalTarget": _vec(distal), "handProxyBounds": _point_bounds(detection_points), "handCameraAxes": axes,
                    "handCameraOrthoScale": float(final_view.get("orthoScale") or 0.0), "handViewCoverage": after, "beforeCoverage": before,
                    "afterCoverage": after, "handRetryPerformed": retried, "initialFraming": initial_framing, "finalFraming": retry_framing,
                    "detectionProxyRegions": [f"forearm_{suffix}", f"hand_{suffix}"], "projectionRegions": allowed,
                })
                views.append(final_view); side_views.append({"view": name, "beforeCoverage": before, "afterCoverage": after, "retryPerformed": retried, "orthoScale": final_view["handCameraOrthoScale"], "axes": axes})
            hand_diagnostics[side] = {"handProxyBounds": _point_bounds(detection_points), "handViewCoverage": side_views, "handRetryPerformed": any(item["retryPerformed"] for item in side_views), "detectionProxyRegions": [f"forearm_{suffix}", f"hand_{suffix}"]}
    finally:
        for obj in all_meshes:
            if obj.name in original_hide: obj.hide_render = original_hide[obj.name]
        for group in proxies.values():
            for proxy in group: proxy.hide_render = True
    manifest = {
        "version": "clouva-adaptive-multiview-camera-rig-v4.1", "renderer": "BLENDER_WORKBENCH_PLUS_TECHNICAL_PASSES",
        "frontConvention": "-Y", "upConvention": "+Z", "attempt": attempt, "bodyResolution": body_resolution,
        "faceCropResolution": face_resolution, "handCropResolution": hand_resolution, "technicalResolution": technical_resolution,
        "views": views, "handMeasurements": {"left": segmentation.hand_measurement("left") if segmentation else {}, "right": segmentation.hand_measurement("right") if segmentation else {}},
        "handDiagnostics": hand_diagnostics, "regionBvh": anatomy_bvh.report() if anatomy_bvh is not None else None,
        "cleanupProxyNames": sorted({proxy.name for group in proxies.values() for proxy in group}),
    }
    (output_dir / "camera_manifest_v4.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


__all__ = ["render_multiview_v4", "cleanup_render_proxies"]
