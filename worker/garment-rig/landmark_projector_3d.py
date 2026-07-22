"""Project 2D candidates onto approved Blender anatomy surfaces."""
from __future__ import annotations

from typing import Dict, List

import bpy
from mathutils import Vector


def _vec(value: Vector):
    return [float(value.x), float(value.y), float(value.z)]


def _orthographic_ray(camera: bpy.types.Object, x: float, y: float, resolution):
    width, height = resolution
    aspect = float(width) / max(float(height), 1.0)
    local_x = (float(x) - 0.5) * camera.data.ortho_scale * aspect
    local_y = (0.5 - float(y)) * camera.data.ortho_scale
    origin = camera.matrix_world @ Vector((local_x, local_y, 0.0))
    direction = camera.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    direction.normalize()
    return origin, direction


def _perspective_ray(camera: bpy.types.Object, x: float, y: float, resolution):
    width, height = resolution
    aspect = float(width) / max(float(height), 1.0)
    ndc_x = float(x) * 2.0 - 1.0
    ndc_y = 1.0 - float(y) * 2.0
    tangent_y = __import__("math").tan(float(camera.data.angle_y) * 0.5)
    local = Vector((ndc_x * tangent_y * aspect, ndc_y * tangent_y, -1.0)).normalized()
    origin = camera.matrix_world.translation.copy()
    direction = camera.matrix_world.to_3x3() @ local
    direction.normalize()
    return origin, direction


def _cast_allowed(origin: Vector, direction: Vector, classifications: Dict[str, str],
                  allowed_classes: set[str], max_distance: float = 10000.0):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    cursor = origin.copy()
    travelled = 0.0
    epsilon = 1e-5
    rejected = []
    for _ in range(16):
        hit, location, normal, face_index, obj, _matrix = bpy.context.scene.ray_cast(
            depsgraph, cursor, direction, distance=max_distance - travelled,
        )
        if not hit or obj is None:
            return None, rejected
        category = classifications.get(obj.name, "unknown_rejected")
        if category in allowed_classes:
            return {
                "location": location,
                "normal": normal,
                "faceIndex": int(face_index),
                "object": obj.name,
                "objectClass": category,
                "travelled": travelled + (location - cursor).length,
            }, rejected
        rejected.append({"object": obj.name, "class": category})
        step = max((location - cursor).length + epsilon, epsilon)
        travelled += step
        cursor = location + direction * epsilon
        if travelled >= max_distance:
            break
    return None, rejected


def project_candidates(detector_output: dict, manifest: dict, classifications: Dict[str, str]):
    view_lookup = {item["name"]: item for item in manifest.get("views", [])}
    projected: List[dict] = []
    failures: List[dict] = []
    for view_result in detector_output.get("views", []):
        view_name = view_result.get("name")
        view = view_lookup.get(view_name)
        if not view:
            failures.append({"code": "CAMERA_MANIFEST_MISSING", "view": view_name})
            continue
        camera = bpy.data.objects.get(view.get("cameraObject"))
        if camera is None or camera.type != "CAMERA":
            failures.append({"code": "CAMERA_OBJECT_MISSING", "view": view_name})
            continue
        for candidate in view_result.get("candidates", []):
            if camera.data.type == "ORTHO":
                origin, direction = _orthographic_ray(camera, candidate["x"], candidate["y"], view.get("resolution", [512, 512]))
            else:
                origin, direction = _perspective_ray(camera, candidate["x"], candidate["y"], view.get("resolution", [512, 512]))
            name = str(candidate.get("name") or "")
            allowed = {"body"}
            if name.startswith("eye_"):
                allowed.add("eyes")
            hit, rejected = _cast_allowed(origin, direction, classifications, allowed)
            if hit is None:
                failures.append({
                    "code": "LANDMARK_RAY_MISS_OR_NON_ANATOMY_HIT",
                    "name": name,
                    "view": view_name,
                    "rejected": rejected,
                })
                continue
            hit_distance = (hit["location"] - origin).length
            projected.append({
                **candidate,
                "position3d": _vec(hit["location"]),
                "surfaceNormal": _vec(hit["normal"]),
                "hitObject": hit["object"],
                "hitObjectClass": hit["objectClass"],
                "faceIndex": hit["faceIndex"],
                "rayOrigin": _vec(origin),
                "rayDirection": _vec(direction),
                "rayHitDistance": float(hit_distance),
                "depthObservation": float(hit_distance),
                "renderScope": view.get("renderScope"),
                "silhouettePath": view.get("silhouettePath"),
                "rejectedHits": rejected,
                "geometryConfidence": 0.95 if not rejected else 0.76,
            })
    return projected, failures
