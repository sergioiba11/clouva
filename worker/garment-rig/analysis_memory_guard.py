"""Bound Blender memory for the temporary Avatar Analyzer scene.

The immutable source GLB is never modified. Only the freshly imported analysis
copy is simplified when its topology exceeds the configured cloud budget.
"""
from __future__ import annotations

import gc
import math
import os
from typing import Iterable

import bpy
from mathutils import Vector

VERSION = "clouva-avatar-analysis-memory-guard-v1"
MAX_ANALYSIS_POLYGONS = max(
    20_000,
    int(os.environ.get("CLOUVA_AVATAR_ANALYZER_MAX_POLYGONS", "80000")),
)


def _world_bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def _bounds_error(before, after):
    before_min, before_max = before
    after_min, after_max = after
    before_size = before_max - before_min
    after_size = after_max - after_min
    before_center = (before_min + before_max) * 0.5
    after_center = (after_min + after_max) * 0.5
    reference = max(max(abs(float(value)) for value in before_size), 1e-8)
    size_error = max(
        abs(float(after_size[axis]) - float(before_size[axis]))
        / max(abs(float(before_size[axis])), reference * 0.01)
        for axis in range(3)
    )
    center_error = float((after_center - before_center).length) / reference
    return size_error, center_error


def _select_only(obj):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _release_analysis_images():
    removed = 0
    for image in list(bpy.data.images):
        if image.name in {"Render Result", "Viewer Node"}:
            continue
        bpy.data.images.remove(image)
        removed += 1
    return removed


def _release_orphan_meshes():
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    gc.collect()


def _reduce_object(obj, target_polygons):
    current = len(obj.data.polygons)
    target = max(100, min(current, int(target_polygons)))
    if current <= target:
        return {
            "object": obj.name,
            "reduced": False,
            "before": current,
            "after": current,
            "target": target,
        }

    if obj.data.users > 1:
        obj.data = obj.data.copy()
    if obj.data.shape_keys is not None:
        obj.shape_key_clear()

    before_bounds = _world_bounds(obj)
    _select_only(obj)
    modifier = obj.modifiers.new(name="CLOUVA_AnalyzerMemoryGuard", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(0.01, min(1.0, float(target) / float(current)))
    if hasattr(modifier, "use_collapse_triangulate"):
        modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.update()

    after = len(obj.data.polygons)
    if after < 100:
        raise RuntimeError(
            f"Avatar analysis memory guard produced unusable geometry: {obj.name}={current}->{after}"
        )
    size_error, center_error = _bounds_error(before_bounds, _world_bounds(obj))
    if not math.isfinite(size_error) or not math.isfinite(center_error):
        raise RuntimeError("Avatar analysis memory guard produced non-finite bounds")
    if size_error > 0.08 or center_error > 0.05:
        raise RuntimeError(
            "Avatar analysis memory guard changed the silhouette too much: "
            f"object={obj.name} sizeError={size_error:.4f} centerError={center_error:.4f}"
        )
    return {
        "object": obj.name,
        "reduced": True,
        "before": current,
        "after": after,
        "target": target,
        "sizeError": size_error,
        "centerError": center_error,
    }


def prepare_analysis_meshes(meshes: Iterable[bpy.types.Object]):
    meshes = [obj for obj in meshes if obj.type == "MESH" and len(obj.data.polygons)]
    images_removed = _release_analysis_images()
    total_before = sum(len(obj.data.polygons) for obj in meshes)
    results = []
    if total_before > MAX_ANALYSIS_POLYGONS:
        for obj in sorted(meshes, key=lambda item: len(item.data.polygons), reverse=True):
            current = len(obj.data.polygons)
            proportional = round(MAX_ANALYSIS_POLYGONS * current / max(total_before, 1))
            results.append(_reduce_object(obj, proportional))
        _release_orphan_meshes()
    total_after = sum(len(obj.data.polygons) for obj in meshes)
    report = {
        "version": VERSION,
        "sourceGlbModified": False,
        "analysisCopyOnly": True,
        "polygonLimit": MAX_ANALYSIS_POLYGONS,
        "polygonsBefore": total_before,
        "polygonsAfter": total_after,
        "reduced": total_after < total_before,
        "imagesRemoved": images_removed,
        "objects": results,
    }
    print(
        "[clouva-avatar-analyzer] memory guard "
        f"polygons={total_before}->{total_after} limit={MAX_ANALYSIS_POLYGONS} "
        f"imagesRemoved={images_removed}",
        flush=True,
    )
    return report
