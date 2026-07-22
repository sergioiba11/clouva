"""Create anatomically isolated technical renders inside Blender."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import bpy
from mathutils import Vector


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _matrix(value):
    return [[float(value[row][column]) for column in range(4)] for row in range(4)]


def _look_at(camera: bpy.types.Object, target: Vector):
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _new_camera(name: str, target: Vector, direction: Vector, region_size: float,
                framing: float = 1.78):
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    data.ortho_scale = max(region_size * framing, 0.02)
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


def _proxy_from_regions(source: bpy.types.Object, labels: Sequence[str], regions: set[str], name: str):
    selected_faces = [
        polygon for polygon in source.data.polygons
        if polygon.vertices and all(labels[index] in regions for index in polygon.vertices)
    ]
    if not selected_faces:
        return None
    selected_indices = sorted({index for polygon in selected_faces for index in polygon.vertices})
    remap = {old: new for new, old in enumerate(selected_indices)}
    vertices = [source.matrix_world @ source.data.vertices[index].co for index in selected_indices]
    faces = [[remap[index] for index in polygon.vertices] for polygon in selected_faces]
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    proxy = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(proxy)
    for slot in source.material_slots:
        if slot.material:
            mesh.materials.append(slot.material)
    for target_polygon, source_polygon in zip(mesh.polygons, selected_faces):
        if mesh.materials:
            target_polygon.material_index = min(source_polygon.material_index, len(mesh.materials) - 1)
    proxy["clouva_render_proxy"] = True
    proxy["source_object"] = source.name
    proxy["regions"] = sorted(regions)
    return proxy


def _complete_proxy(source: bpy.types.Object, name: str):
    indices = list(range(len(source.data.vertices)))
    vertices = [source.matrix_world @ source.data.vertices[index].co for index in indices]
    faces = [list(polygon.vertices) for polygon in source.data.polygons]
    if not faces:
        return None
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    proxy = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(proxy)
    for slot in source.material_slots:
        if slot.material:
            mesh.materials.append(slot.material)
    for target_polygon, source_polygon in zip(mesh.polygons, source.data.polygons):
        if mesh.materials:
            target_polygon.material_index = min(source_polygon.material_index, len(mesh.materials) - 1)
    proxy["clouva_render_proxy"] = True
    proxy["source_object"] = source.name
    return proxy


def _build_proxies(meshes: Iterable[bpy.types.Object], segmentation, classifications: dict):
    groups = {"face": [], "left": [], "right": []}
    if segmentation is None:
        return groups
    for obj in meshes:
        category = classifications.get(obj.name, "unknown")
        labels = segmentation.labels.get(obj.name) or []
        if labels:
            for key, regions in {
                "face": {"head", "neck"},
                "left": {"hand_l"},
                "right": {"hand_r"},
            }.items():
                proxy = _proxy_from_regions(obj, labels, regions, f"CLOUVA_PROXY_{key}_{obj.name}")
                if proxy:
                    groups[key].append(proxy)
        if category == "eyes":
            proxy = _complete_proxy(obj, f"CLOUVA_PROXY_face_{obj.name}")
            if proxy:
                groups["face"].append(proxy)
    return groups


def _set_visible_meshes(all_meshes: Sequence[bpy.types.Object], visible: Sequence[bpy.types.Object]):
    visible_names = {obj.name for obj in visible}
    for obj in all_meshes:
        obj.hide_render = obj.name not in visible_names


def _render_mask(scene, path: Path):
    previous_type = scene.display.shading.color_type
    previous_transparent = scene.render.film_transparent
    previous_background = tuple(scene.world.color)
    try:
        scene.display.shading.color_type = "SINGLE"
        scene.display.shading.single_color = (1.0, 1.0, 1.0)
        scene.world.color = (0.0, 0.0, 0.0)
        scene.render.film_transparent = False
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        return str(path) if path.is_file() else None
    except Exception:
        return None
    finally:
        scene.display.shading.color_type = previous_type
        scene.render.film_transparent = previous_transparent
        scene.world.color = previous_background


def _render_view(scene, output_dir: Path, name: str, region: str, side: str | None,
                 target: Vector, direction: Vector, region_size: float,
                 visible_objects: Sequence[bpy.types.Object], all_meshes: Sequence[bpy.types.Object],
                 framing: float = 1.78):
    _set_visible_meshes(all_meshes, visible_objects)
    camera = _new_camera(f"CLOUVA_CAMERA_{name}", target, direction, region_size, framing)
    scene.camera = camera
    path = output_dir / f"{name}.png"
    scene.render.filepath = str(path)
    scene.display.shading.color_type = "MATERIAL"
    bpy.ops.render.render(write_still=True)
    mask_path = _render_mask(scene, output_dir / f"{name}_silhouette.png")
    return {
        "name": name,
        "region": region,
        "side": side,
        "path": str(path),
        "silhouettePath": mask_path,
        "cameraObject": camera.name,
        "cameraType": camera.data.type,
        "orthoScale": float(camera.data.ortho_scale),
        "matrixWorld": _matrix(camera.matrix_world),
        "resolution": [int(scene.render.resolution_x), int(scene.render.resolution_y)],
        "target": _vec(target),
        "directionToCamera": _vec(direction.normalized()),
        "renderScope": "anatomically-isolated-proxy" if visible_objects else "full-scene-fallback",
        "proxyObjects": [obj.name for obj in visible_objects],
        "geometryPass": "raycast-on-demand",
    }


def _average(points: Sequence[Vector], fallback: Vector):
    if not points:
        return fallback.copy()
    return sum(points, Vector((0.0, 0.0, 0.0))) / len(points)


def render_multiview(output_dir: Path, vectors: Dict[str, Vector], height: float,
                     meshes: Iterable[bpy.types.Object] | None = None, segmentation=None,
                     classifications: dict | None = None, resolution: int = 512):
    """Render isolated face and per-hand views while retaining camera matrices."""
    output_dir = Path(output_dir)
    scene = _configure_scene(output_dir, resolution)
    meshes = list(meshes or [obj for obj in scene.objects if obj.type == "MESH"])
    classifications = classifications or {}
    proxies = _build_proxies(meshes, segmentation, classifications)
    all_meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    original_hide = {obj.name: bool(obj.hide_render) for obj in all_meshes}
    views: List[dict] = []

    try:
        skull_base = vectors["skull_base"]
        head_top = vectors["head_top"]
        head_points = segmentation.region_points(("head", "neck")) if segmentation else []
        face_target = _average(head_points, skull_base.lerp(head_top, 0.53))
        face_size = max((head_top - skull_base).length * 1.22, height * 0.12)
        face_directions = {
            "face_front": Vector((0.0, -1.0, 0.0)),
            "face_left_profile": Vector((1.0, 0.0, 0.0)),
            "face_right_profile": Vector((-1.0, 0.0, 0.0)),
            "face_left_three_quarter": Vector((0.72, -0.72, 0.0)),
            "face_right_three_quarter": Vector((-0.72, -0.72, 0.0)),
        }
        face_visible = proxies["face"] or meshes
        for name, direction in face_directions.items():
            views.append(_render_view(
                scene, output_dir, name, "face", None, face_target, direction,
                face_size, face_visible, all_meshes, framing=1.92,
            ))

        for side, short in (("left", "l"), ("right", "r")):
            wrist = vectors[f"wrist_{short}"]
            hand_tip = vectors[f"hand_{short}"]
            measurement = segmentation.hand_measurement(side) if segmentation else {}
            hand_points = segmentation.region_points(f"hand_{short}") if segmentation else []
            target = _average(hand_points, wrist.lerp(hand_tip, 0.56))
            hand_size = max(
                float(measurement.get("handScale") or 0.0),
                (hand_tip - wrist).length * 1.35,
                height * 0.055,
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
                views.append(_render_view(
                    scene, output_dir, name, "hand", side, target, direction,
                    hand_size, visible, all_meshes, framing=1.58,
                ))
    finally:
        for obj in all_meshes:
            if obj.name in original_hide:
                obj.hide_render = original_hide[obj.name]
        for group in proxies.values():
            for proxy in group:
                mesh_data = proxy.data
                bpy.data.objects.remove(proxy, do_unlink=True)
                if mesh_data.users == 0:
                    bpy.data.meshes.remove(mesh_data)

    manifest = {
        "version": "clouva-multiview-v2-anatomy-isolated",
        "renderer": "BLENDER_WORKBENCH",
        "frontConvention": "-Y",
        "views": views,
        "handMeasurements": {
            "left": segmentation.hand_measurement("left") if segmentation else {},
            "right": segmentation.hand_measurement("right") if segmentation else {},
        },
    }
    manifest_path = output_dir / "camera_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest
