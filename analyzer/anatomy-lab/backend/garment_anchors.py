from __future__ import annotations

from typing import Any

import numpy as np

from body_measurements import section_at, SlicePoint


def _canonical_to_source(position: np.ndarray, canonical) -> list[float]:
    point = np.ones(4, dtype=np.float64)
    point[:3] = np.asarray(position, dtype=np.float64)
    source = canonical.canonical_to_source @ point
    return source[:3].astype(float).tolist()


def _from_landmark(name: str, source_name: str, by_name: dict[str, dict], category: str = "garment") -> dict | None:
    item = by_name.get(source_name)
    if not item:
        return None
    return {
        "name": name,
        "group": "garment_anchor",
        "category": category,
        "state": "surface_anchor_ready",
        "confidence": float(item.get("confidence", 0.75)),
        "geometry_id": item.get("geometry_id"),
        "mesh_id": item.get("mesh_id"),
        "primitive_id": item.get("primitive_id"),
        "triangle_id": item.get("triangle_id"),
        "source_vertex_indices": item.get("source_vertex_indices"),
        "barycentric": item.get("barycentric"),
        "canonical_position": item.get("canonical_position"),
        "source_position": item.get("source_position"),
        "surface_normal": item.get("surface_normal"),
        "method": f"landmark:{source_name}",
        "validation": {"surface_locked": item.get("triangle_id") is not None},
        "warnings": [],
    }


def _anchor_from_slice_point(name: str, point: SlicePoint, ray_scene, canonical, category: str = "garment") -> dict:
    global_face = int(point.face_index)
    geometry_id = int(ray_scene.face_geometry_ids[global_face])
    local_face = int(ray_scene.face_local_ids[global_face])
    details = ray_scene.triangle_details(geometry_id, local_face)
    bary = np.asarray(point.barycentric, dtype=np.float64)
    # Keep the point inside the triangle instead of exactly on an edge.
    bary = bary * 0.97 + np.full(3, 1.0 / 3.0) * 0.03
    record = ray_scene.records[geometry_id]
    local_vertices = record.vertices_canonical[record.faces[local_face]]
    position = np.sum(local_vertices * bary[:, None], axis=0)
    normal = ray_scene.face_normals[global_face].astype(float)
    return {
        "name": name,
        "group": "garment_anchor",
        "category": category,
        "state": "surface_anchor_ready",
        "confidence": 0.90,
        "geometry_id": geometry_id,
        "mesh_id": details["mesh_id"],
        "primitive_id": details["primitive_id"],
        "triangle_id": local_face,
        "source_vertex_indices": details["source_vertex_indices"],
        "barycentric": bary.astype(float).tolist(),
        "canonical_position": position.astype(float).tolist(),
        "source_position": _canonical_to_source(position, canonical),
        "surface_normal": normal.tolist(),
        "method": "mesh_section_extreme",
        "validation": {"surface_locked": True, "triangle_interior": bool(np.all(bary > 0))},
        "warnings": [],
    }


def _section_extreme_anchors(ray_scene, canonical, z: float, target_xy, names: dict[str, str], max_distance: float) -> list[dict]:
    component = section_at(ray_scene, z, target_xy, max_distance=max_distance)
    if component is None or not component.points:
        return []
    points = component.points
    selectors = {
        "front": lambda item: item.point[1],
        "back": lambda item: -item.point[1],
        "left": lambda item: item.point[0],
        "right": lambda item: -item.point[0],
    }
    result = []
    for direction, anchor_name in names.items():
        if direction not in selectors:
            continue
        selected = min(points, key=selectors[direction])
        result.append(_anchor_from_slice_point(anchor_name, selected, ray_scene, canonical))
    return result


def _face_centroid_anchor(name: str, target: np.ndarray, ray_scene, canonical, confidence: float, method: str) -> dict | None:
    triangles = ray_scene.vertices[ray_scene.faces]
    centroids = triangles.mean(axis=1)
    distances = np.linalg.norm(centroids - target[None, :], axis=1)
    if not len(distances):
        return None
    global_face = int(np.argmin(distances))
    geometry_id = int(ray_scene.face_geometry_ids[global_face])
    local_face = int(ray_scene.face_local_ids[global_face])
    details = ray_scene.triangle_details(geometry_id, local_face)
    bary = np.full(3, 1.0 / 3.0, dtype=np.float64)
    position = centroids[global_face]
    return {
        "name": name,
        "group": "garment_anchor",
        "category": "garment",
        "state": "geometry_estimate",
        "confidence": confidence,
        "geometry_id": geometry_id,
        "mesh_id": details["mesh_id"],
        "primitive_id": details["primitive_id"],
        "triangle_id": local_face,
        "source_vertex_indices": details["source_vertex_indices"],
        "barycentric": bary.tolist(),
        "canonical_position": position.astype(float).tolist(),
        "source_position": _canonical_to_source(position, canonical),
        "surface_normal": ray_scene.face_normals[global_face].astype(float).tolist(),
        "method": method,
        "validation": {"surface_locked": True, "triangle_interior": True},
        "warnings": ["GEOMETRY_ESTIMATE"],
    }


def build_garment_anchors(ray_scene, canonical, landmarks: list[dict], measurements: dict) -> tuple[list[dict], list[dict]]:
    by_name = {item.get("name"): item for item in landmarks if item.get("name") and item.get("group") == "body"}
    bounds = ray_scene.bounds_max - ray_scene.bounds_min
    center_xy = np.array([
        (ray_scene.bounds_min[0] + ray_scene.bounds_max[0]) * 0.5,
        (ray_scene.bounds_min[1] + ray_scene.bounds_max[1]) * 0.5,
    ])
    levels = measurements.get("levels", {})
    anchors: list[dict] = []
    warnings: list[dict] = []

    direct = {
        "shoulder_left": "left_shoulder",
        "shoulder_right": "right_shoulder",
        "elbow_left": "left_elbow",
        "elbow_right": "right_elbow",
        "wrist_left": "left_wrist",
        "wrist_right": "right_wrist",
        "hip_left": "left_hip",
        "hip_right": "right_hip",
        "knee_left": "left_knee",
        "knee_right": "right_knee",
        "ankle_left": "left_ankle",
        "ankle_right": "right_ankle",
        "heel_left": "left_heel",
        "heel_right": "right_heel",
        "toe_left": "left_foot_index",
        "toe_right": "right_foot_index",
    }
    for name, source in direct.items():
        anchor = _from_landmark(name, source, by_name)
        if anchor:
            anchors.append(anchor)
        else:
            warnings.append({"code": "GARMENT_ANCHOR_SOURCE_MISSING", "anchor": name, "source": source})

    section_specs = [
        (float(levels.get("neck_z", ray_scene.bounds_min[2] + bounds[2] * 0.75)), {"front": "neck_base_front", "back": "neck_base_back"}),
        (float(levels.get("chest_z", ray_scene.bounds_min[2] + bounds[2] * 0.64)), {"front": "chest_center", "back": "back_center"}),
        (float(levels.get("waist_z", ray_scene.bounds_min[2] + bounds[2] * 0.52)), {"front": "waist_front", "back": "waist_back", "left": "waist_left", "right": "waist_right"}),
        (float(levels.get("hip_z", ray_scene.bounds_min[2] + bounds[2] * 0.45)), {"front": "hip_front", "back": "hip_back"}),
    ]
    for z, names in section_specs:
        created = _section_extreme_anchors(ray_scene, canonical, z, center_xy, names, max_distance=float(bounds[2] * 0.16))
        anchors.extend(created)
        missing = set(names.values()) - {item["name"] for item in created}
        for name in sorted(missing):
            warnings.append({"code": "GARMENT_SECTION_ANCHOR_UNAVAILABLE", "anchor": name})

    left_shoulder = by_name.get("left_shoulder", {}).get("canonical_position")
    right_shoulder = by_name.get("right_shoulder", {}).get("canonical_position")
    left_hip = by_name.get("left_hip", {}).get("canonical_position")
    right_hip = by_name.get("right_hip", {}).get("canonical_position")
    if left_shoulder:
        target = np.asarray(left_shoulder, dtype=np.float64) + np.array([bounds[0] * 0.03, 0.0, -bounds[2] * 0.07])
        anchor = _face_centroid_anchor("armpit_left", target, ray_scene, canonical, 0.66, "geometry_armpit_estimate")
        if anchor: anchors.append(anchor)
    if right_shoulder:
        target = np.asarray(right_shoulder, dtype=np.float64) + np.array([-bounds[0] * 0.03, 0.0, -bounds[2] * 0.07])
        anchor = _face_centroid_anchor("armpit_right", target, ray_scene, canonical, 0.66, "geometry_armpit_estimate")
        if anchor: anchors.append(anchor)
    if left_hip and right_hip:
        hip_center = (np.asarray(left_hip, dtype=np.float64) + np.asarray(right_hip, dtype=np.float64)) * 0.5
        target = hip_center + np.array([0.0, 0.0, -bounds[2] * 0.085])
        anchor = _face_centroid_anchor("crotch", target, ray_scene, canonical, 0.58, "geometry_crotch_estimate")
        if anchor: anchors.append(anchor)

    anchors = sorted({item["name"]: item for item in anchors}.values(), key=lambda item: item["name"])
    required = {
        "neck_base_front", "neck_base_back", "shoulder_left", "shoulder_right",
        "armpit_left", "armpit_right", "chest_center", "back_center",
        "waist_front", "waist_back", "waist_left", "waist_right",
        "hip_left", "hip_right", "crotch", "wrist_left", "wrist_right",
        "knee_left", "knee_right", "ankle_left", "ankle_right",
    }
    present = {item["name"] for item in anchors}
    missing_required = sorted(required - present)
    if missing_required:
        warnings.append({"code": "GARMENT_REQUIRED_ANCHORS_MISSING", "anchors": missing_required})
    return anchors, warnings
