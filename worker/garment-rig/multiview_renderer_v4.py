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
DEFAULT_HAND_CAMERA_CONFIG = {
    "distal_forearm_ratio": 0.35,
    "target_coverage": 0.42,
    "minimum_coverage": 0.15,
    "maximum_coverage": 0.90,
    "maximum_retries": 2,
    "context_frame_margin": 1.06,
}
# Backward-compatible public constants retained for V4.1 callers and source contracts.
HAND_TARGET_COVERAGE = DEFAULT_HAND_CAMERA_CONFIG["target_coverage"]
HAND_MIN_COVERAGE = DEFAULT_HAND_CAMERA_CONFIG["minimum_coverage"]
HAND_MAX_COVERAGE = DEFAULT_HAND_CAMERA_CONFIG["maximum_coverage"]


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


def _projection_frame(points, target: Vector, direction: Vector, ortho_scale: float):
    """Return exact orthographic occupancy for proxy geometry around the fixed target."""
    half = max(float(ortho_scale) * 0.5, 1e-8)
    right, up = _camera_axes(direction)
    if not points:
        return {
            "minimum": [0.5, 0.5], "maximum": [0.5, 0.5],
            "width": 0.0, "height": 0.0, "touchesFrame": False,
        }
    horizontal = [(point - target).dot(right) for point in points]
    vertical = [(point - target).dot(up) for point in points]
    minimum = [0.5 + min(horizontal) / (2.0 * half), 0.5 - max(vertical) / (2.0 * half)]
    maximum = [0.5 + max(horizontal) / (2.0 * half), 0.5 - min(vertical) / (2.0 * half)]
    touches = bool(minimum[0] <= 0.0 or minimum[1] <= 0.0 or maximum[0] >= 1.0 or maximum[1] >= 1.0)
    return {
        "minimum": [float(value) for value in minimum],
        "maximum": [float(value) for value in maximum],
        "width": float(maximum[0] - minimum[0]),
        "height": float(maximum[1] - minimum[1]),
        "touchesFrame": touches,
    }


def _required_framing(points, target: Vector, direction: Vector, fitted_size: float, margin: float):
    """Minimum framing that contains the rendered context without moving the hand target."""
    if not points:
        return 1.0
    right, up = _camera_axes(direction)
    maximum = max(
        max(abs((point - target).dot(right)), abs((point - target).dot(up)))
        for point in points
    )
    required_scale = max(2.0 * maximum * margin, 0.02)
    return max(0.12, required_scale / max(float(fitted_size), 1e-8))


def _point_visible(point: Vector, target: Vector, direction: Vector, ortho_scale: float):
    frame = _projection_frame([point], target, direction, ortho_scale)
    x, y = frame["minimum"]
    return bool(0.0 < x < 1.0 and 0.0 < y < 1.0)


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


def _hand_camera_config(config: dict) -> dict:
    provided = config.get("hand_camera") if isinstance(config.get("hand_camera"), dict) else {}
    merged = {**DEFAULT_HAND_CAMERA_CONFIG, **provided}
    return {
        "distal_forearm_ratio": max(0.05, min(0.80, float(merged["distal_forearm_ratio"]))),
        "target_coverage": max(0.15, min(0.75, float(merged["target_coverage"]))),
        "minimum_coverage": max(0.15, min(0.50, float(merged["minimum_coverage"]))),
        "maximum_coverage": max(0.55, min(0.90, float(merged["maximum_coverage"]))),
        "maximum_retries": max(0, min(2, int(merged["maximum_retries"]))),
        "context_frame_margin": max(1.01, min(1.25, float(merged["context_frame_margin"]))),
    }


def _filtered_axis_proxy(source: bpy.types.Object, name: str, wrist: Vector, hand_axis: Vector,
                         distal_forearm_length: float, forward_limit: float):
    selected = []
    for polygon in source.data.polygons:
        if not polygon.vertices:
            continue
        points = [source.matrix_world @ source.data.vertices[index].co for index in polygon.vertices]
        centroid = sum(points, Vector((0.0, 0.0, 0.0))) / len(points)
        signed = (centroid - wrist).dot(hand_axis)
        if -distal_forearm_length <= signed <= forward_limit:
            selected.append(polygon)
    if not selected:
        return None
    indices = sorted({int(index) for polygon in selected for index in polygon.vertices})
    remap = {old: new for new, old in enumerate(indices)}
    vertices = [source.matrix_world @ source.data.vertices[index].co for index in indices]
    faces = [[remap[int(index)] for index in polygon.vertices] for polygon in selected]
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    proxy = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(proxy)
    proxy["clouva_render_proxy"] = True
    proxy["source_proxy"] = source.name
    proxy["distal_forearm_length"] = float(distal_forearm_length)
    proxy["forward_limit"] = float(forward_limit)
    return proxy


def _hand_proxies(anatomy_bvh, side: str, suffix: str, wrist: Vector, distal: Vector,
                  height: float, distal_forearm_ratio: float, fallback):
    fallback = list(fallback)
    focus_regions = [f"hand_{suffix}"]
    if anatomy_bvh is not None:
        focus_regions.extend(
            f"{finger}_{suffix}"
            for finger in ("thumb", "index", "middle", "ring", "pinky")
            if anatomy_bvh.has_region(f"{finger}_{suffix}")
        )
    if anatomy_bvh is None:
        return fallback, fallback, focus_regions, focus_regions, []

    created = []
    focus = anatomy_bvh.proxy(tuple(focus_regions), f"CLOUVA_PROXY_{side}_HAND_FOCUS_V41")
    focus_visible = [focus] if focus is not None else fallback
    if focus is not None:
        created.append(focus)

    full_regions = [f"forearm_{suffix}", *focus_regions]
    context_regions = [f"forearm_{suffix}_distal", *focus_regions]
    full_context = anatomy_bvh.proxy(tuple(full_regions), f"CLOUVA_PROXY_{side}_HAND_CONTEXT_FULL_V41")
    if full_context is not None:
        created.append(full_context)
        full_context.hide_render = True

    axis = distal - wrist
    hand_length = max(float(axis.length), height * 0.04)
    if axis.length <= 1e-8:
        axis = Vector((1.0 if suffix == "l" else -1.0, 0.0, 0.0))
    axis.normalize()
    distal_length = hand_length * distal_forearm_ratio
    context = _filtered_axis_proxy(
        full_context,
        f"CLOUVA_PROXY_{side}_HAND_CONTEXT_DISTAL_V41",
        wrist,
        axis,
        distal_length,
        hand_length * 2.75,
    ) if full_context is not None else None
    if context is not None:
        created.append(context)
        context_visible = [context]
    else:
        context_visible = focus_visible
    return focus_visible, context_visible, focus_regions, context_regions, created


def _coverage_adjusted_framing(coverage, framing, target_coverage):
    if coverage <= 0.0:
        return max(0.12, framing * 0.55)
    return max(0.12, min(2.40, framing * math.sqrt(coverage / target_coverage)))


def render_multiview_v4(output_dir: Path, vectors: Dict[str, Vector], height: float, meshes: Iterable[bpy.types.Object] | None = None,
                        segmentation=None, classifications: dict | None = None, anatomy_bvh=None, attempt: str = "v4", config: dict | None = None):
    config = config or DEFAULT_CONFIG; output_dir = Path(output_dir); meshes = list(meshes or _scene_meshes()); classifications = classifications or {}
    hand_config = _hand_camera_config(config)
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
            focus_visible, context_visible, focus_regions, context_regions, created = _hand_proxies(
                anatomy_bvh, side, suffix, wrist, distal, height,
                hand_config["distal_forearm_ratio"], proxies[side] or meshes,
            )
            for proxy in created:
                if proxy.name not in [item.name for item in proxies[side]]:
                    proxies[side].append(proxy)
                if proxy.name not in [item.name for item in all_meshes]:
                    all_meshes.append(proxy)
                    original_hide[proxy.name] = bool(proxy.hide_render)
            focus_points = _points(focus_visible)
            context_points = _points(context_visible)
            target = _average(focus_points, wrist.lerp(distal, 0.56))
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
            # Coverage is hand/finger evidence only. The distal forearm context is
            # rendered separately and checked geometrically for clipping.
            projection_regions = list(focus_regions)
            side_views = []
            for name, direction in directions.items():
                fitted_size, axes = _projected_extent(focus_points, direction, hand_size)
                context_minimum_framing = _required_framing(
                    context_points, target, direction, fitted_size,
                    hand_config["context_frame_margin"],
                )
                initial_framing = max(1.10, context_minimum_framing)
                current_framing = initial_framing
                final_view = _enrich(_render_view(hand_scene, output_dir, name, "hand", side, target, direction, fitted_size, context_visible, all_meshes,
                                                  anatomy_bvh, projection_regions, framing=current_framing, technical_resolution=technical_resolution), context_visible, attempt, f"hand_{suffix}")
                context_frame = _projection_frame(context_points, target, direction, float(final_view.get("orthoScale") or 0.0))
                final_view["clippingDetected"] = bool(context_frame["touchesFrame"])
                before = float(final_view.get("silhouetteCoverage") or 0.0)
                retry_count = 0
                while retry_count < hand_config["maximum_retries"] and (
                    float(final_view.get("silhouetteCoverage") or 0.0) < hand_config["minimum_coverage"]
                    or float(final_view.get("silhouetteCoverage") or 0.0) > hand_config["maximum_coverage"]
                    or bool(final_view.get("clippingDetected"))
                ):
                    current_coverage = float(final_view.get("silhouetteCoverage") or 0.0)
                    desired_framing = _coverage_adjusted_framing(
                        current_coverage, current_framing, hand_config["target_coverage"],
                    )
                    current_framing = max(desired_framing, context_minimum_framing)
                    retry_count += 1
                    final_view = _enrich(_render_view(hand_scene, output_dir, name, "hand", side, target, direction, fitted_size, context_visible, all_meshes,
                                                       anatomy_bvh, projection_regions, framing=current_framing, technical_resolution=technical_resolution), context_visible, f"{attempt}_autofit_{retry_count}", f"hand_{suffix}")
                    context_frame = _projection_frame(context_points, target, direction, float(final_view.get("orthoScale") or 0.0))
                    final_view["clippingDetected"] = bool(context_frame["touchesFrame"])
                after = float(final_view.get("silhouetteCoverage") or 0.0)
                wrist_visible = _point_visible(wrist, target, direction, float(final_view.get("orthoScale") or 0.0))
                final_view.update({
                    "wristTarget": _vec(wrist), "distalTarget": _vec(distal),
                    "focusProxyRegions": focus_regions, "contextProxyRegions": context_regions,
                    "distalForearmRatio": hand_config["distal_forearm_ratio"],
                    "focusProxyBounds": _point_bounds(focus_points), "contextProxyBounds": _point_bounds(context_points),
                    "focusProxyVertexCount": _proxy_vertex_count(focus_visible), "contextProxyVertexCount": _proxy_vertex_count(context_visible),
                    "handCameraAxes": axes, "handCameraOrthoScale": float(final_view.get("orthoScale") or 0.0),
                    "handViewCoverage": after, "beforeCoverage": before, "afterCoverage": after,
                    "retryCount": retry_count, "handRetryPerformed": retry_count > 0,
                    "initialFraming": initial_framing, "finalFraming": current_framing,
                    "contextMinimumFraming": context_minimum_framing,
                    "contextProjectionBounds": context_frame,
                    "wristVisible": wrist_visible,
                    "framingValid": bool(
                        hand_config["minimum_coverage"] <= after <= hand_config["maximum_coverage"]
                        and not final_view.get("clippingDetected")
                        and wrist_visible
                    ),
                    "clippingDetected": bool(final_view.get("clippingDetected")),
                    "projectionRegions": projection_regions,
                })
                views.append(final_view)
                side_views.append({
                    "view": name, "beforeCoverage": before, "afterCoverage": after,
                    "retryCount": retry_count, "retryPerformed": retry_count > 0,
                    "orthoScale": final_view["handCameraOrthoScale"], "axes": axes,
                    "contextMinimumFraming": context_minimum_framing,
                    "contextProjectionBounds": context_frame,
                    "wristVisible": wrist_visible,
                    "framingValid": final_view["framingValid"], "clippingDetected": final_view["clippingDetected"],
                })
            hand_diagnostics[side] = {
                "focusProxyBounds": _point_bounds(focus_points), "contextProxyBounds": _point_bounds(context_points),
                "focusProxyRegions": focus_regions, "contextProxyRegions": context_regions,
                "focusProxyVertexCount": _proxy_vertex_count(focus_visible), "contextProxyVertexCount": _proxy_vertex_count(context_visible),
                "distalForearmRatio": hand_config["distal_forearm_ratio"], "handViewCoverage": side_views,
                "handRetryPerformed": any(item["retryPerformed"] for item in side_views),
                "allViewsFramingValid": all(item["framingValid"] and not item["clippingDetected"] for item in side_views),
                "allWristsVisible": all(item["wristVisible"] for item in side_views),
            }
    finally:
        for obj in all_meshes:
            if obj.name in original_hide: obj.hide_render = original_hide[obj.name]
        for group in proxies.values():
            for proxy in group: proxy.hide_render = True
    manifest = {
        "version": "clouva-adaptive-multiview-camera-rig-v4.1", "renderer": "BLENDER_WORKBENCH_PLUS_TECHNICAL_PASSES",
        "frontConvention": "-Y", "upConvention": "+Z", "attempt": attempt, "bodyResolution": body_resolution,
        "faceCropResolution": face_resolution, "handCropResolution": hand_resolution, "technicalResolution": technical_resolution,
        "handCameraConfig": hand_config,
        "views": views, "handMeasurements": {"left": segmentation.hand_measurement("left") if segmentation else {}, "right": segmentation.hand_measurement("right") if segmentation else {}},
        "handDiagnostics": hand_diagnostics, "regionBvh": anatomy_bvh.report() if anatomy_bvh is not None else None,
        "cleanupProxyNames": sorted({proxy.name for group in proxies.values() for proxy in group}),
    }
    (output_dir / "camera_manifest_v4.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


__all__ = ["render_multiview_v4", "cleanup_render_proxies"]
