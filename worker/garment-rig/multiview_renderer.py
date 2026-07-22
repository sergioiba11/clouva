"""Create deterministic technical face and hand renders inside Blender."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List

import bpy
from mathutils import Vector


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _matrix(value):
    return [[float(value[row][column]) for column in range(4)] for row in range(4)]


def _look_at(camera: bpy.types.Object, target: Vector):
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _new_camera(name: str, target: Vector, direction: Vector, region_size: float):
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    data.ortho_scale = max(region_size * 2.35, 0.02)
    camera = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(camera)
    distance = max(region_size * 4.0, 0.15)
    camera.location = target + direction.normalized() * distance
    _look_at(camera, target)
    return camera


def _configure_scene(output_dir: Path, resolution: int):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    try:
        scene.display.shading.studio_light = "paint.sl"
    except (TypeError, ValueError):
        pass
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.background_type = "WORLD"
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.92, 0.92, 0.92)
    output_dir.mkdir(parents=True, exist_ok=True)
    return scene


def _render_view(scene, output_dir: Path, name: str, region: str, side: str | None,
                 target: Vector, direction: Vector, region_size: float):
    camera = _new_camera(f"CLOUVA_CAMERA_{name}", target, direction, region_size)
    scene.camera = camera
    path = output_dir / f"{name}.png"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return {
        "name": name,
        "region": region,
        "side": side,
        "path": str(path),
        "cameraObject": camera.name,
        "cameraType": camera.data.type,
        "orthoScale": float(camera.data.ortho_scale),
        "matrixWorld": _matrix(camera.matrix_world),
        "resolution": [int(scene.render.resolution_x), int(scene.render.resolution_y)],
        "target": _vec(target),
        "directionToCamera": _vec(direction.normalized()),
    }


def render_multiview(output_dir: Path, vectors: Dict[str, Vector], height: float,
                     resolution: int = 512):
    """Render face and isolated camera crops for each hand.

    The geometry is not modified. Camera object names and matrices are retained
    so the Blender-side projector can turn 2D detector coordinates back into
    world-space ray casts.
    """
    output_dir = Path(output_dir)
    scene = _configure_scene(output_dir, resolution)
    views: List[dict] = []

    skull_base = vectors["skull_base"]
    head_top = vectors["head_top"]
    face_target = skull_base.lerp(head_top, 0.53)
    face_size = max((head_top - skull_base).length * 1.15, height * 0.12)
    face_directions = {
        "face_front": Vector((0.0, -1.0, 0.0)),
        "face_left_profile": Vector((1.0, 0.0, 0.0)),
        "face_right_profile": Vector((-1.0, 0.0, 0.0)),
        "face_left_three_quarter": Vector((0.72, -0.72, 0.0)),
        "face_right_three_quarter": Vector((-0.72, -0.72, 0.0)),
    }
    for name, direction in face_directions.items():
        views.append(_render_view(scene, output_dir, name, "face", None, face_target, direction, face_size))

    for side, short, outward in (("left", "l", Vector((1.0, 0.0, 0.0))),
                                  ("right", "r", Vector((-1.0, 0.0, 0.0)))):
        wrist = vectors[f"wrist_{short}"]
        hand_tip = vectors[f"hand_{short}"]
        target = wrist.lerp(hand_tip, 0.56)
        hand_size = max((hand_tip - wrist).length * 1.65, height * 0.075)
        directions = {
            f"hand_{short}_palm": Vector((0.0, -1.0, 0.0)),
            f"hand_{short}_dorsum": Vector((0.0, 1.0, 0.0)),
            f"hand_{short}_lateral": outward,
            f"hand_{short}_top": Vector((0.0, 0.0, 1.0)),
        }
        for name, direction in directions.items():
            views.append(_render_view(scene, output_dir, name, "hand", side, target, direction, hand_size))

    manifest = {
        "version": "clouva-multiview-v1",
        "renderer": "BLENDER_WORKBENCH",
        "frontConvention": "-Y",
        "views": views,
    }
    manifest_path = output_dir / "camera_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
