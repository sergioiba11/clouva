"""Adaptive body, face and per-hand camera rig for Avatar Analyzer V4."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List

import bpy
from mathutils import Vector

from analyzer_v4_contract import DEFAULT_CONFIG
from multiview_renderer import (
    _average,
    _build_proxies,
    _configure_scene,
    _render_view,
    cleanup_render_proxies,
)

BODY_DIRECTIONS = {
    "body_front": Vector((0.0, -1.0, 0.0)),
    "body_back": Vector((0.0, 1.0, 0.0)),
    "body_left": Vector((1.0, 0.0, 0.0)),
    "body_right": Vector((-1.0, 0.0, 0.0)),
    "body_front_left_45": Vector((0.7071, -0.7071, 0.0)),
    "body_front_right_45": Vector((-0.7071, -0.7071, 0.0)),
    "body_back_left_45": Vector((0.7071, 0.7071, 0.0)),
    "body_back_right_45": Vector((-0.7071, 0.7071, 0.0)),
}
FACE_DIRECTIONS = {
    "face_front": Vector((0.0, -1.0, 0.0)),
    "face_left_30": Vector((0.5, -0.866, 0.0)),
    "face_right_30": Vector((-0.5, -0.866, 0.0)),
    "face_left_profile": Vector((1.0, 0.0, 0.0)),
    "face_right_profile": Vector((-1.0, 0.0, 0.0)),
}
BODY_REGIONS = (
    "torso", "pelvis", "neck", "head", "eyes",
    "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r",
)


def _proxy_vertex_count(objects) -> int:
    return sum(len(obj.data.vertices) for obj in objects if obj and obj.type == "MESH")


def _enrich(view: dict, visible, attempt: str, crop: str) -> dict:
    technical = view.get("technicalPasses") or {}
    coverage = float(technical.get("coverage") or 0.0)
    path = Path(str(view.get("path") or ""))
    view.update({
        "attempt": attempt,
        "crop": crop,
        "rendered": path.is_file() and path.stat().st_size > 0,
        "proxyVertexCount": _proxy_vertex_count(visible),
        "silhouetteCoverage": coverage,
        "framingValid": bool(0.001 <= coverage <= 0.965),
        "clippingDetected": bool(coverage >= 0.965),
        "requiredPasses": ["rgb", "mask", "depth", "normal", "object_id", "region_id"],
    })
    return view


def _scene_meshes() -> list[bpy.types.Object]:
    return [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not bool(obj.get("clouva_visual_only", False))
    ]


def _bounds(meshes: Iterable[bpy.types.Object]):
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    if not points:
        raise RuntimeError("Adaptive camera rig requires mesh geometry")
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum, maximum - minimum


def render_multiview_v4(
    output_dir: Path,
    vectors: Dict[str, Vector],
    height: float,
    meshes: Iterable[bpy.types.Object] | None = None,
    segmentation=None,
    classifications: dict | None = None,
    anatomy_bvh=None,
    attempt: str = "v4",
    config: dict | None = None,
):
    config = config or DEFAULT_CONFIG
    output_dir = Path(output_dir)
    meshes = list(meshes or _scene_meshes())
    classifications = classifications or {}
    proxies = _build_proxies(meshes, segmentation, classifications, anatomy_bvh)
    all_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    original_hide = {obj.name: bool(obj.hide_render) for obj in all_meshes}
    views: List[dict] = []
    body_resolution = int(config["render"]["body_resolution"])
    face_resolution = int(config["render"]["face_crop_resolution"])
    hand_resolution = int(config["render"]["hand_crop_resolution"])
    technical_resolution = int(config["render"]["technical_resolution"])

    try:
        minimum, maximum, size = _bounds(meshes)
        body_target = (minimum + maximum) * 0.5
        body_size = max(float(size.z), height, 0.02)
        body_scene = _configure_scene(output_dir, body_resolution)
        for name, direction in BODY_DIRECTIONS.items():
            rendered = _render_view(
                body_scene, output_dir, name, "body", None, body_target, direction,
                body_size, meshes, all_meshes, anatomy_bvh, BODY_REGIONS,
                framing=1.14, technical_resolution=technical_resolution,
            )
            views.append(_enrich(rendered, meshes, attempt, "body"))

        face_scene = _configure_scene(output_dir, face_resolution)
        skull_base = vectors["skull_base"]
        head_top = vectors["head_top"]
        head_points = segmentation.region_points(("head", "neck")) if segmentation else []
        face_target = _average(head_points, skull_base.lerp(head_top, 0.54))
        face_size = max((head_top - skull_base).length * 1.18, height * 0.12)
        face_visible = proxies["face"] or meshes
        for name, direction in FACE_DIRECTIONS.items():
            rendered = _render_view(
                face_scene, output_dir, name, "face", None, face_target, direction,
                face_size, face_visible, all_meshes, anatomy_bvh, ("head", "eyes"),
                framing=1.78, technical_resolution=technical_resolution,
            )
            views.append(_enrich(rendered, face_visible, attempt, "face"))

        hand_scene = _configure_scene(output_dir, hand_resolution)
        for side, suffix in (("left", "l"), ("right", "r")):
            wrist = vectors[f"wrist_{suffix}"]
            distal = vectors[f"hand_{suffix}"]
            measurement = segmentation.hand_measurement(side) if segmentation else {}
            hand_points = segmentation.region_points(f"hand_{suffix}") if segmentation else []
            target = _average(hand_points, wrist.lerp(distal, 0.56))
            hand_size = max(
                float(measurement.get("handScale") or 0.0),
                (distal - wrist).length * 1.35,
                height * 0.055,
            )
            normal = Vector(tuple(measurement.get("normal") or (0.0, -1.0, 0.0)))
            lateral = Vector(tuple(measurement.get("lateral") or ((1.0, 0.0, 0.0) if suffix == "l" else (-1.0, 0.0, 0.0))))
            forward = Vector(tuple(measurement.get("forward") or (0.0, 0.0, -1.0)))
            if normal.length <= 1e-8:
                normal = Vector((0.0, -1.0, 0.0))
            if lateral.length <= 1e-8:
                lateral = Vector((1.0 if suffix == "l" else -1.0, 0.0, 0.0))
            if forward.length <= 1e-8:
                forward = Vector((0.0, 0.0, -1.0))
            normal.normalize(); lateral.normalize(); forward.normalize()
            directions = {
                f"hand_{suffix}_dorsal": normal,
                f"hand_{suffix}_palmar": -normal,
                f"hand_{suffix}_radial": lateral,
                f"hand_{suffix}_ulnar": -lateral,
                f"hand_{suffix}_oblique": (-normal + lateral * 0.58 + forward * 0.16).normalized(),
            }
            visible = proxies[side] or meshes
            allowed = [f"hand_{suffix}"] + [
                f"{finger}_{suffix}" for finger in ("thumb", "index", "middle", "ring", "pinky")
                if anatomy_bvh is not None and anatomy_bvh.has_region(f"{finger}_{suffix}")
            ]
            for name, direction in directions.items():
                rendered = _render_view(
                    hand_scene, output_dir, name, "hand", side, target, direction,
                    hand_size, visible, all_meshes, anatomy_bvh, allowed,
                    framing=1.72, technical_resolution=technical_resolution,
                )
                rendered["wristTarget"] = [float(value) for value in wrist]
                rendered["distalTarget"] = [float(value) for value in distal]
                views.append(_enrich(rendered, visible, attempt, f"hand_{suffix}"))
    finally:
        for obj in all_meshes:
            if obj.name in original_hide:
                obj.hide_render = original_hide[obj.name]
        for group in proxies.values():
            for proxy in group:
                proxy.hide_render = True

    manifest = {
        "version": "clouva-adaptive-multiview-camera-rig-v4.0",
        "renderer": "BLENDER_WORKBENCH_PLUS_TECHNICAL_PASSES",
        "frontConvention": "-Y",
        "upConvention": "+Z",
        "attempt": attempt,
        "bodyResolution": body_resolution,
        "faceCropResolution": face_resolution,
        "handCropResolution": hand_resolution,
        "technicalResolution": technical_resolution,
        "views": views,
        "handMeasurements": {
            "left": segmentation.hand_measurement("left") if segmentation else {},
            "right": segmentation.hand_measurement("right") if segmentation else {},
        },
        "regionBvh": anatomy_bvh.report() if anatomy_bvh is not None else None,
        "cleanupProxyNames": [proxy.name for group in proxies.values() for proxy in group],
    }
    (output_dir / "camera_manifest_v4.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


__all__ = ["render_multiview_v4", "cleanup_render_proxies"]
