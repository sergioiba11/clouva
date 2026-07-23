"""Avatar Analyzer V3.2 regional renderer.

This wrapper reuses the proven V3 render primitives while adding explicit view
coverage, top/bottom facial evidence, attempt metadata and configurable hand
framing for the controlled second pass.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List

import bpy
from mathutils import Vector

from face_visual_cues import add_visual_face_cues
from multiview_renderer import (
    _average,
    _build_proxies,
    _configure_scene,
    _render_view,
    cleanup_render_proxies,
)

FACE_VIEW_DIRECTIONS = {
    "face_front": Vector((0.0, -1.0, 0.0)),
    "face_left_profile": Vector((1.0, 0.0, 0.0)),
    "face_right_profile": Vector((-1.0, 0.0, 0.0)),
    "face_left_three_quarter": Vector((0.72, -0.72, 0.0)),
    "face_right_three_quarter": Vector((-0.72, -0.72, 0.0)),
    "face_slight_top": Vector((0.0, -0.88, 0.48)),
    "face_slight_bottom": Vector((0.0, -0.88, -0.38)),
}

HAND_VIEW_TOKENS = (
    "palm", "dorsum", "lateral", "medial", "top",
    "three_quarter_palm", "three_quarter_dorsum",
)


def _proxy_vertex_count(objects):
    return sum(len(obj.data.vertices) for obj in objects if obj and obj.type == "MESH")


def _enrich_view(view: dict, visible, attempt: str):
    technical = view.get("technicalPasses") or {}
    coverage = float(technical.get("coverage") or 0.0)
    path = Path(str(view.get("path") or ""))
    proxy_vertices = _proxy_vertex_count(visible)
    visual_cues = [obj.name for obj in visible if bool(obj.get("clouva_visual_only", False))]
    view.update({
        "attempt": attempt,
        "rendered": path.is_file() and path.stat().st_size > 0,
        "proxyVertexCount": proxy_vertices,
        "silhouetteCoverage": coverage,
        "framingValid": bool(proxy_vertices >= 4 and 0.002 <= coverage <= 0.94),
        "clippingDetected": bool(coverage >= 0.94),
        "visualCueObjects": visual_cues,
        "visualCueProjectionAllowed": False,
    })
    return view


def render_multiview_v32(output_dir: Path, vectors: Dict[str, Vector], height: float,
                          meshes: Iterable[bpy.types.Object] | None = None,
                          segmentation=None, classifications: dict | None = None,
                          anatomy_bvh=None, resolution: int = 512,
                          technical_resolution: int = 256,
                          hand_framing: float = 1.72,
                          face_framing: float = 1.98,
                          attempt: str = "initial"):
    output_dir = Path(output_dir)
    scene = _configure_scene(output_dir, resolution)
    meshes = list(meshes or [obj for obj in scene.objects if obj.type == "MESH"])
    classifications = classifications or {}
    proxies = _build_proxies(meshes, segmentation, classifications, anatomy_bvh)
    visual_face_cues = add_visual_face_cues(proxies, meshes, classifications, anatomy_bvh)
    all_meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    original_hide = {obj.name: bool(obj.hide_render) for obj in all_meshes}
    views: List[dict] = []

    try:
        skull_base = vectors["skull_base"]
        head_top = vectors["head_top"]
        head_points = segmentation.region_points(("head", "neck")) if segmentation else []
        face_target = _average(head_points, skull_base.lerp(head_top, 0.53))
        face_size = max((head_top - skull_base).length * 1.24, height * 0.125)
        face_visible = proxies["face"] or meshes
        for name, direction in FACE_VIEW_DIRECTIONS.items():
            rendered = _render_view(
                scene, output_dir, name, "face", None, face_target, direction,
                face_size, face_visible, all_meshes, anatomy_bvh,
                ("head", "eyes"), framing=face_framing,
                technical_resolution=technical_resolution,
            )
            views.append(_enrich_view(rendered, face_visible, attempt))

        for side, short in (("left", "l"), ("right", "r")):
            wrist = vectors[f"wrist_{short}"]
            hand_tip = vectors[f"hand_{short}"]
            measurement = segmentation.hand_measurement(side) if segmentation else {}
            hand_points = segmentation.region_points(f"hand_{short}") if segmentation else []
            target = _average(hand_points, wrist.lerp(hand_tip, 0.56))
            hand_size = max(
                float(measurement.get("handScale") or 0.0),
                (hand_tip - wrist).length * 1.40,
                height * 0.058,
            )
            normal = Vector(tuple(measurement.get("normal") or (0.0, -1.0, 0.0)))
            lateral = Vector(tuple(measurement.get("lateral") or ((1.0, 0.0, 0.0) if short == "l" else (-1.0, 0.0, 0.0))))
            forward = Vector(tuple(measurement.get("forward") or (0.0, 0.0, -1.0)))
            if normal.length <= 1e-8:
                normal = Vector((0.0, -1.0, 0.0))
            if lateral.length <= 1e-8:
                lateral = Vector((1.0 if short == "l" else -1.0, 0.0, 0.0))
            if forward.length <= 1e-8:
                forward = Vector((0.0, 0.0, -1.0))
            normal.normalize(); lateral.normalize(); forward.normalize()
            directions = {
                f"hand_{short}_palm": -normal,
                f"hand_{short}_dorsum": normal,
                f"hand_{short}_lateral": lateral,
                f"hand_{short}_medial": -lateral,
                f"hand_{short}_top": -forward,
                f"hand_{short}_three_quarter_palm": (-normal + lateral * 0.55).normalized(),
                f"hand_{short}_three_quarter_dorsum": (normal - lateral * 0.55).normalized(),
            }
            visible = proxies[side] or meshes
            for name, direction in directions.items():
                rendered = _render_view(
                    scene, output_dir, name, "hand", side, target, direction,
                    hand_size, visible, all_meshes, anatomy_bvh, (f"hand_{short}",),
                    framing=hand_framing, technical_resolution=technical_resolution,
                )
                rendered["wristTarget"] = [float(value) for value in wrist]
                rendered["distalTarget"] = [float(value) for value in hand_tip]
                views.append(_enrich_view(rendered, visible, attempt))
    finally:
        for obj in all_meshes:
            if obj.name in original_hide:
                obj.hide_render = original_hide[obj.name]
        for group in proxies.values():
            for proxy in group:
                proxy.hide_render = True

    manifest = {
        "version": "clouva-multiview-v3.2-final-pass",
        "renderer": "BLENDER_WORKBENCH",
        "frontConvention": "-Y",
        "attempt": attempt,
        "resolution": resolution,
        "technicalResolution": technical_resolution,
        "handFraming": hand_framing,
        "faceFraming": face_framing,
        "views": views,
        "visualOnlyFaceCues": visual_face_cues,
        "visualCueProjectionPolicy": "rgb-and-edges-only-strict-anatomy-bvh-for-final-points",
        "handMeasurements": {
            "left": segmentation.hand_measurement("left") if segmentation else {},
            "right": segmentation.hand_measurement("right") if segmentation else {},
        },
        "regionBvh": anatomy_bvh.report() if anatomy_bvh is not None else None,
        "cleanupProxyNames": [proxy.name for group in proxies.values() for proxy in group],
    }
    (output_dir / "camera_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
