"""Targeted hand-camera corrections installed over the retained V4.1 renderer."""
from __future__ import annotations

from array import array
from pathlib import Path
from typing import Sequence

import bpy
from mathutils import Vector

from multiview_renderer import _render_mask, _set_visible_meshes

FINGER_NAMES = ("thumb", "index", "middle", "ring", "pinky")
HAND_MIN_COVERAGE = 0.15
HAND_MAX_COVERAGE = 0.90
HAND_CENTER_TOLERANCE = 0.20

_BASE = None
_ORIGINAL_RENDER_VIEW = None
_ORIGINAL_ENRICH = None


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _verified_region(anatomy_bvh, region: str) -> bool:
    """Reject adjacency-only BVH aliases and require real semantic triangles."""
    if anatomy_bvh is None:
        return False
    geometry = anatomy_bvh.regions.get(region)
    if geometry is None:
        return False
    return any(
        metadata.primary_region == region or region in metadata.secondary_regions
        for metadata in geometry.metadata
    )


def _clip_polygon_halfspace(points, wrist, hand_axis, bound, keep_above):
    """Clip a polygon geometrically; do not retain a long triangle by centroid."""
    if not points:
        return []
    output = []
    previous = points[-1]
    previous_distance = (previous - wrist).dot(hand_axis)
    previous_inside = previous_distance >= bound if keep_above else previous_distance <= bound
    for current in points:
        current_distance = (current - wrist).dot(hand_axis)
        current_inside = current_distance >= bound if keep_above else current_distance <= bound
        if current_inside != previous_inside:
            denominator = current_distance - previous_distance
            if abs(float(denominator)) > 1e-12:
                factor = max(0.0, min(1.0, float((bound - previous_distance) / denominator)))
                output.append(previous.lerp(current, factor))
        if current_inside:
            output.append(current.copy())
        previous = current
        previous_distance = current_distance
        previous_inside = current_inside
    return output


def _filtered_axis_proxy(source: bpy.types.Object, name: str, wrist: Vector, hand_axis: Vector,
                         distal_forearm_length: float, forward_limit: float):
    vertices = []
    faces = []
    if source is None:
        return None
    for polygon in source.data.polygons:
        points = [source.matrix_world @ source.data.vertices[index].co for index in polygon.vertices]
        clipped = _clip_polygon_halfspace(points, wrist, hand_axis, -distal_forearm_length, True)
        clipped = _clip_polygon_halfspace(clipped, wrist, hand_axis, forward_limit, False)
        if len(clipped) < 3:
            continue
        start = len(vertices)
        vertices.extend(clipped)
        for index in range(1, len(clipped) - 1):
            faces.append([start, start + index, start + index + 1])
    if not faces:
        return None
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
    focus_regions.extend(
        region
        for finger in FINGER_NAMES
        if _verified_region(anatomy_bvh, region := f"{finger}_{suffix}")
    )
    if anatomy_bvh is None:
        return fallback, fallback, focus_regions, focus_regions, []

    created = []
    focus = anatomy_bvh.proxy(tuple(focus_regions), f"CLOUVA_PROXY_{side}_HAND_FOCUS_V41")
    focus_visible = [focus] if focus is not None else fallback
    if focus is not None:
        created.append(focus)

    forearm_region = f"forearm_{suffix}"
    context_regions = [*focus_regions, f"forearm_{suffix}_distal"]
    full_forearm = anatomy_bvh.proxy((forearm_region,), f"CLOUVA_PROXY_{side}_FOREARM_SOURCE_V41")
    if full_forearm is not None:
        full_forearm.hide_render = True
        created.append(full_forearm)

    axis = distal - wrist
    hand_length = max(float(axis.length), height * 0.04)
    if axis.length <= 1e-8:
        axis = Vector((1.0 if suffix == "l" else -1.0, 0.0, 0.0))
    axis.normalize()
    distal_forearm = _filtered_axis_proxy(
        full_forearm,
        f"CLOUVA_PROXY_{side}_HAND_CONTEXT_DISTAL_V41",
        wrist,
        axis,
        hand_length * distal_forearm_ratio,
        0.0,
    ) if full_forearm is not None else None
    context_visible = list(focus_visible)
    if distal_forearm is not None:
        created.append(distal_forearm)
        context_visible.append(distal_forearm)
    return focus_visible, context_visible, focus_regions, context_regions, created


def _mask_diagnostics(path):
    path = Path(str(path or ""))
    result = {
        "path": str(path), "coverage": 0.0, "center": [None, None], "bbox": None,
        "touchesEdge": False, "pixelCount": 0,
    }
    if not path.is_file() or path.stat().st_size <= 0:
        return result
    image = None
    try:
        image = bpy.data.images.load(str(path), check_existing=False)
        width, height = int(image.size[0]), int(image.size[1])
        if width <= 0 or height <= 0:
            return result
        pixels = array("f", [0.0]) * (width * height * 4)
        image.pixels.foreach_get(pixels)
        count = 0
        sum_x = sum_y = 0.0
        min_x, min_y, max_x, max_y = width, height, -1, -1
        for index in range(width * height):
            offset = index * 4
            occupied = (
                max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) >= 0.5
                and pixels[offset + 3] >= 0.5
            )
            if not occupied:
                continue
            x, y = index % width, index // width
            count += 1
            sum_x += x
            sum_y += y
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x), max(max_y, y)
        result["pixelCount"] = count
        result["coverage"] = float(count / max(width * height, 1))
        if count:
            result["center"] = [float(sum_x / count / width), float(sum_y / count / height)]
            result["bbox"] = [int(min_x), int(min_y), int(max_x + 1), int(max_y + 1)]
            result["touchesEdge"] = bool(
                min_x == 0 or min_y == 0 or max_x == width - 1 or max_y == height - 1
            )
        return result
    finally:
        if image is not None:
            bpy.data.images.remove(image)


def _is_centered(mask) -> bool:
    center = mask.get("center") or [None, None]
    return bool(
        center[0] is not None and center[1] is not None
        and abs(float(center[0]) - 0.5) <= HAND_CENTER_TOLERANCE
        and abs(float(center[1]) - 0.5) <= HAND_CENTER_TOLERANCE
    )


def _render_view(*args, **kwargs):
    view = _ORIGINAL_RENDER_VIEW(*args, **kwargs)
    region = args[3] if len(args) > 3 else kwargs.get("region")
    if region != "hand":
        return view
    scene = args[0]
    output_dir = Path(args[1])
    name = args[2]
    visible_objects: Sequence[bpy.types.Object] = args[8]
    all_meshes: Sequence[bpy.types.Object] = args[9]
    focus_visible = [obj for obj in visible_objects if "HAND_FOCUS_V41" in obj.name]
    if not focus_visible:
        focus_visible = [obj for obj in visible_objects if "CONTEXT_DISTAL" not in obj.name]
    context_mask = _mask_diagnostics(output_dir / f"{name}_silhouette.png")
    _set_visible_meshes(all_meshes, focus_visible)
    focus_path = output_dir / f"{name}_focus_silhouette.png"
    _render_mask(scene, focus_path)
    focus_mask = _mask_diagnostics(focus_path)
    technical = dict(view.get("technicalPasses") or {})
    technical["coverage"] = float(focus_mask.get("coverage") or 0.0)
    view["technicalPasses"] = technical
    view["_focusMaskV41"] = focus_mask
    view["_contextMaskV41"] = context_mask
    return view


def _enrich(view, visible, attempt, crop):
    view = _ORIGINAL_ENRICH(view, visible, attempt, crop)
    focus = view.pop("_focusMaskV41", None)
    context = view.pop("_contextMaskV41", None)
    if focus is None or context is None:
        return view
    coverage = float(focus.get("coverage") or 0.0)
    clipping = bool(focus.get("touchesEdge") or context.get("touchesEdge"))
    centered = _is_centered(focus)
    view.update({
        "silhouetteCoverage": coverage,
        "technicalSilhouetteCoverage": coverage,
        "focusSilhouetteCoverage": coverage,
        "focusSilhouettePath": focus.get("path"),
        "focusSilhouetteBounds": focus.get("bbox"),
        "focusSilhouetteCenter": focus.get("center"),
        "focusSilhouetteCentered": centered,
        "focusSilhouetteTouchesEdge": bool(focus.get("touchesEdge")),
        "contextSilhouetteCoverage": float(context.get("coverage") or 0.0),
        "contextSilhouettePath": context.get("path"),
        "contextSilhouetteBounds": context.get("bbox"),
        "contextSilhouetteCenter": context.get("center"),
        "contextSilhouetteTouchesEdge": bool(context.get("touchesEdge")),
        "framingValid": bool(HAND_MIN_COVERAGE <= coverage <= HAND_MAX_COVERAGE and not clipping and centered),
        "clippingDetected": clipping,
    })
    return view


def install_hand_framing_patch(base_module):
    global _BASE, _ORIGINAL_RENDER_VIEW, _ORIGINAL_ENRICH
    if getattr(base_module, "_clouva_hand_framing_v41_installed", False):
        return base_module
    _BASE = base_module
    _ORIGINAL_RENDER_VIEW = base_module._render_view
    _ORIGINAL_ENRICH = base_module._enrich
    base_module._filtered_axis_proxy = _filtered_axis_proxy
    base_module._hand_proxies = _hand_proxies
    base_module._render_view = _render_view
    base_module._enrich = _enrich
    base_module._clouva_hand_framing_v41_installed = True
    return base_module


__all__ = ["install_hand_framing_patch"]
