from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import trimesh

FIT_EASE = {
    "base": {
        "shoulder_extra_cm": 1.2,
        "chest_extra_cm": 2.2,
        "waist_extra_cm": 2.0,
        "hem_extra_cm": 2.4,
        "sleeve_radius_extra_cm": 1.2,
        "length_extra_cm": 0.5,
        "collar_extra_cm": 0.6,
    },
    "regular": {
        "shoulder_extra_cm": 2.2,
        "chest_extra_cm": 3.5,
        "waist_extra_cm": 3.2,
        "hem_extra_cm": 3.8,
        "sleeve_radius_extra_cm": 1.8,
        "length_extra_cm": 1.2,
        "collar_extra_cm": 1.0,
    },
    "oversized": {
        "shoulder_extra_cm": 4.0,
        "chest_extra_cm": 6.4,
        "waist_extra_cm": 5.6,
        "hem_extra_cm": 6.2,
        "sleeve_radius_extra_cm": 2.6,
        "length_extra_cm": 2.2,
        "collar_extra_cm": 1.3,
    },
}

CATEGORY_DEFAULTS = {
    "r1": {"garment_type": "tshirt", "sleeve_length_ratio": 0.18},
    "h1": {"garment_type": "hoodie", "sleeve_length_ratio": 0.34},
}


class TemplateFitError(RuntimeError):
    pass


@dataclass
class FitArtifacts:
    garment_id: str
    glb_path: Path
    fit_json_path: Path
    meshy_payload_path: Path
    collision_json_path: Path
    fit_json: dict[str, Any]


@dataclass
class PreviewArtifacts:
    glb_path: Path
    alignment_json_path: Path
    payload: dict[str, Any]


def _combined_mesh(path: Path) -> trimesh.Trimesh:
    loaded = trimesh.load(path, force="scene", process=False)
    if isinstance(loaded, trimesh.Trimesh):
        mesh = loaded.copy()
    elif isinstance(loaded, trimesh.Scene):
        geoms = []
        for node_name in loaded.graph.nodes_geometry:
            transform, geometry_name = loaded.graph[node_name]
            geom = loaded.geometry.get(geometry_name)
            if not isinstance(geom, trimesh.Trimesh):
                continue
            g = geom.copy()
            g.apply_transform(np.asarray(transform, dtype=np.float64))
            geoms.append(g)
        if not geoms:
            raise TemplateFitError("La plantilla no contiene geometría triangular")
        mesh = trimesh.util.concatenate(geoms)
    else:  # pragma: no cover - defensive
        raise TemplateFitError("No se pudo abrir el GLB de la plantilla")
    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise TemplateFitError("La plantilla GLB está vacía")
    return mesh


def _load_scene(path: Path) -> trimesh.Scene:
    loaded = trimesh.load(path, force="scene", process=False)
    if isinstance(loaded, trimesh.Trimesh):
        loaded = trimesh.Scene(loaded)
    if not isinstance(loaded, trimesh.Scene) or not loaded.geometry:
        raise TemplateFitError("La plantilla no contiene una escena GLB válida")
    return loaded


def _anchor_source(run_result: dict[str, Any], name: str) -> np.ndarray | None:
    for item in run_result.get("garment_anchors", []) or []:
        if item.get("name") != name:
            continue
        value = item.get("source_position") or item.get("canonical_position")
        if isinstance(value, list) and len(value) == 3:
            array = np.asarray(value, dtype=np.float64)
            if np.isfinite(array).all():
                return array
    for item in run_result.get("landmarks", []) or []:
        if item.get("name") != name:
            continue
        value = item.get("source_position") or item.get("canonical_position")
        if isinstance(value, list) and len(value) == 3:
            array = np.asarray(value, dtype=np.float64)
            if np.isfinite(array).all():
                return array
    return None


def _alignment_target(run_result: dict[str, Any], template_info: dict[str, Any], fit_mode: str) -> dict[str, Any]:
    measurements = run_result.get("body_measurements") or {}
    scale_info = measurements.get("scale") or {}
    geometry_to_meters = float(scale_info.get("geometry_to_meters") or 1.0)
    cm_to_geometry = 0.01 / max(geometry_to_meters, 1e-9)
    normalized_category = str(template_info.get("normalized_category") or template_info.get("category") or "tshirt").lower()
    garment_type = "hoodie" if normalized_category == "hoodie" else "tshirt"
    targets_cm = _measure_targets(measurements, fit_mode, garment_type)

    left_shoulder = _anchor_source(run_result, "shoulder_left")
    if left_shoulder is None:
        left_shoulder = _anchor_source(run_result, "left_shoulder")
    right_shoulder = _anchor_source(run_result, "shoulder_right")
    if right_shoulder is None:
        right_shoulder = _anchor_source(run_result, "right_shoulder")
    neck_front = _anchor_source(run_result, "neck_base_front")
    neck_back = _anchor_source(run_result, "neck_base_back")
    chest_front = _anchor_source(run_result, "chest_center")
    chest_back = _anchor_source(run_result, "back_center")

    shoulder_points = [point for point in (left_shoulder, right_shoulder) if point is not None]
    if shoulder_points:
        shoulder_center = np.mean(np.stack(shoulder_points), axis=0)
    else:
        levels = measurements.get("levels") or {}
        shoulder_center = np.array([0.0, 0.0, float(levels.get("chest_z", 1.15)) + 0.12], dtype=np.float64)

    depth_points = [point for point in (neck_front, neck_back, chest_front, chest_back) if point is not None]
    if depth_points:
        torso_center_y = float(np.mean([point[1] for point in depth_points]))
    else:
        torso_center_y = float(shoulder_center[1])

    sleeve_ratio = 0.58 if garment_type == "tshirt" else 0.78
    overall_width_cm = max(
        targets_cm["chest_width_cm"] * 1.25,
        targets_cm["shoulder_width_cm"] + targets_cm["sleeve_length_cm"] * 2.0 * sleeve_ratio,
    )
    target_dims = np.array([
        overall_width_cm * cm_to_geometry,
        targets_cm["chest_depth_cm"] * cm_to_geometry,
        targets_cm["garment_length_cm"] * cm_to_geometry,
    ], dtype=np.float64)
    collar_rise = (2.0 if garment_type == "hoodie" else 0.8) * cm_to_geometry
    target_shoulder = np.array([
        float(shoulder_center[0]),
        torso_center_y,
        float(shoulder_center[2]) + collar_rise,
    ], dtype=np.float64)
    return {
        "garment_type": garment_type,
        "targets_cm": targets_cm,
        "target_dims": target_dims,
        "target_shoulder": target_shoulder,
        "geometry_to_meters": geometry_to_meters,
        "cm_to_geometry": cm_to_geometry,
    }



def _normalize(vector: np.ndarray, fallback: np.ndarray | None = None) -> np.ndarray:
    value = np.asarray(vector, dtype=np.float64)
    length = float(np.linalg.norm(value))
    if length > 1e-9 and np.isfinite(length):
        return value / length
    if fallback is None:
        fallback = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    fallback = np.asarray(fallback, dtype=np.float64)
    fallback_length = float(np.linalg.norm(fallback))
    return fallback / max(fallback_length, 1e-9)


def _first_point(*points: np.ndarray | None) -> np.ndarray | None:
    for point in points:
        if point is not None:
            return np.asarray(point, dtype=np.float64)
    return None


def _average_points(*points: np.ndarray | None) -> np.ndarray | None:
    valid = [np.asarray(point, dtype=np.float64) for point in points if point is not None]
    if not valid:
        return None
    return np.mean(np.stack(valid), axis=0)


def _body_semantic_frame(run_result: dict[str, Any]) -> dict[str, Any]:
    left_shoulder = _first_point(_anchor_source(run_result, "shoulder_left"), _anchor_source(run_result, "left_shoulder"))
    right_shoulder = _first_point(_anchor_source(run_result, "shoulder_right"), _anchor_source(run_result, "right_shoulder"))
    left_hip = _first_point(_anchor_source(run_result, "hip_left"), _anchor_source(run_result, "left_hip"))
    right_hip = _first_point(_anchor_source(run_result, "hip_right"), _anchor_source(run_result, "right_hip"))
    neck_front = _anchor_source(run_result, "neck_base_front")
    neck_back = _anchor_source(run_result, "neck_base_back")
    chest_front = _anchor_source(run_result, "chest_center")
    chest_back = _anchor_source(run_result, "back_center")
    waist_front = _anchor_source(run_result, "waist_front")
    waist_back = _anchor_source(run_result, "waist_back")

    shoulder_center = _average_points(left_shoulder, right_shoulder)
    hip_center = _average_points(left_hip, right_hip)
    neck_center = _average_points(neck_front, neck_back)
    chest_center = _average_points(chest_front, chest_back)
    waist_center = _average_points(waist_front, waist_back)

    if shoulder_center is None:
        shoulder_center = neck_center if neck_center is not None else np.array([0.0, 1.25, 0.0], dtype=np.float64)
    if neck_center is None:
        neck_center = shoulder_center.copy()
    if hip_center is None:
        hip_center = waist_center if waist_center is not None else shoulder_center - np.array([0.0, 0.45, 0.0], dtype=np.float64)
    if chest_center is None:
        chest_center = shoulder_center * 0.65 + hip_center * 0.35

    if left_shoulder is not None and right_shoulder is not None:
        right_axis = _normalize(right_shoulder - left_shoulder, np.array([1.0, 0.0, 0.0]))
    else:
        right_axis = np.array([1.0, 0.0, 0.0], dtype=np.float64)

    up_axis = _normalize(shoulder_center - hip_center, np.array([0.0, 1.0, 0.0]))
    right_axis = right_axis - up_axis * float(np.dot(right_axis, up_axis))
    right_axis = _normalize(right_axis, np.array([1.0, 0.0, 0.0]))

    front_hint_points = []
    if neck_front is not None and neck_back is not None:
        front_hint_points.append(neck_front - neck_back)
    if chest_front is not None and chest_back is not None:
        front_hint_points.append(chest_front - chest_back)
    if waist_front is not None and waist_back is not None:
        front_hint_points.append(waist_front - waist_back)
    front_hint = np.mean(np.stack(front_hint_points), axis=0) if front_hint_points else np.cross(up_axis, right_axis)
    front_hint = front_hint - up_axis * float(np.dot(front_hint, up_axis)) - right_axis * float(np.dot(front_hint, right_axis))
    front_axis = _normalize(front_hint, np.cross(up_axis, right_axis))

    # Enforce a right-handed semantic frame: X=right, Y=front, Z=up.
    computed_up = _normalize(np.cross(right_axis, front_axis), up_axis)
    if float(np.dot(computed_up, up_axis)) < 0.0:
        front_axis = -front_axis
    up_axis = _normalize(np.cross(right_axis, front_axis), up_axis)

    frame = np.column_stack([right_axis, front_axis, up_axis])
    torso_center = chest_center
    return {
        "matrix": frame,
        "right": right_axis,
        "front": front_axis,
        "up": up_axis,
        "neck_center": neck_center,
        "shoulder_center": shoulder_center,
        "hip_center": hip_center,
        "torso_center": torso_center,
        "source": {
            "left_shoulder": left_shoulder.tolist() if left_shoulder is not None else None,
            "right_shoulder": right_shoulder.tolist() if right_shoulder is not None else None,
            "neck_front": neck_front.tolist() if neck_front is not None else None,
            "neck_back": neck_back.tolist() if neck_back is not None else None,
            "chest_front": chest_front.tolist() if chest_front is not None else None,
            "chest_back": chest_back.tolist() if chest_back is not None else None,
        },
    }


def _rotation_candidates() -> list[np.ndarray]:
    import itertools

    rotations: list[np.ndarray] = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((-1.0, 1.0), repeat=3):
            matrix = np.zeros((3, 3), dtype=np.float64)
            for new_axis, old_axis in enumerate(perm):
                matrix[new_axis, old_axis] = signs[new_axis]
            if np.linalg.det(matrix) > 0.5:
                rotations.append(matrix)
    return rotations


def _boundary_loops(mesh: trimesh.Trimesh) -> list[np.ndarray]:
    faces = np.asarray(mesh.faces, dtype=np.int64)
    if len(faces) == 0:
        return []
    edges = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    sorted_edges = np.sort(edges, axis=1)
    unique, counts = np.unique(sorted_edges, axis=0, return_counts=True)
    boundary = unique[counts == 1]
    if len(boundary) == 0:
        return []
    adjacency: dict[int, set[int]] = {}
    for a, b in boundary:
        ia, ib = int(a), int(b)
        adjacency.setdefault(ia, set()).add(ib)
        adjacency.setdefault(ib, set()).add(ia)
    loops: list[np.ndarray] = []
    remaining = set(adjacency)
    while remaining:
        seed = remaining.pop()
        stack = [seed]
        component = {seed}
        while stack:
            current = stack.pop()
            for neighbor in adjacency.get(current, ()):
                if neighbor not in component:
                    component.add(neighbor)
                    remaining.discard(neighbor)
                    stack.append(neighbor)
        if len(component) >= 3:
            loops.append(np.asarray(sorted(component), dtype=np.int64))
    return loops


def _loop_features(vertices_local: np.ndarray, loops: list[np.ndarray], bounds_min: np.ndarray, size: np.ndarray) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for indices in loops:
        points = vertices_local[indices]
        center = points.mean(axis=0)
        spans = np.maximum(points.max(axis=0) - points.min(axis=0), 1e-9)
        closed_edges = np.roll(points, -1, axis=0) - points
        perimeter = float(np.sum(np.linalg.norm(closed_edges, axis=1)))
        z01 = float((center[2] - bounds_min[2]) / max(size[2], 1e-9))
        x_center = float(abs(center[0] - (bounds_min[0] + size[0] * 0.5)) / max(size[0], 1e-9))
        y_center = float(abs(center[1] - (bounds_min[1] + size[1] * 0.5)) / max(size[1], 1e-9))
        features.append({
            "indices": indices,
            "center": center,
            "spans": spans,
            "perimeter": perimeter,
            "z01": z01,
            "x_center_norm": x_center,
            "y_center_norm": y_center,
        })
    return features


def _fallback_collar(vertices_local: np.ndarray, bounds_min: np.ndarray, size: np.ndarray) -> dict[str, Any]:
    z_threshold = bounds_min[2] + size[2] * 0.78
    x_center = bounds_min[0] + size[0] * 0.5
    central = np.abs(vertices_local[:, 0] - x_center) <= size[0] * 0.22
    mask = (vertices_local[:, 2] >= z_threshold) & central
    indices = np.where(mask)[0]
    if not len(indices):
        indices = np.argsort(vertices_local[:, 2])[-max(12, min(128, len(vertices_local) // 40)) :]
    points = vertices_local[indices]
    return {
        "indices": indices,
        "center": points.mean(axis=0),
        "spans": np.maximum(points.max(axis=0) - points.min(axis=0), 1e-9),
        "perimeter": 0.0,
        "z01": float((points[:, 2].mean() - bounds_min[2]) / max(size[2], 1e-9)),
        "x_center_norm": float(abs(points[:, 0].mean() - x_center) / max(size[0], 1e-9)),
        "y_center_norm": 0.0,
        "fallback": True,
    }


def _estimate_shoulder_reference(vertices_local: np.ndarray, bounds_min: np.ndarray, size: np.ndarray) -> np.ndarray:
    center_x = bounds_min[0] + size[0] * 0.5
    upper_mask = vertices_local[:, 2] >= bounds_min[2] + size[2] * 0.72
    body_mask = np.abs(vertices_local[:, 0] - center_x) <= size[0] * 0.42
    mask = upper_mask & body_mask
    if int(np.count_nonzero(mask)) < 12:
        mask = upper_mask
    if int(np.count_nonzero(mask)) < 8:
        mask = np.ones(len(vertices_local), dtype=bool)
    points = vertices_local[mask]
    if len(points) == 0:
        return np.array([center_x, float(vertices_local[:, 1].mean()), bounds_min[2] + size[2] * 0.78], dtype=np.float64)
    return np.array([float(np.mean(points[:, 0])), float(np.median(points[:, 1])), float(np.quantile(points[:, 2], 0.45))], dtype=np.float64)


def _estimate_torso_reference(vertices_local: np.ndarray, bounds_min: np.ndarray, size: np.ndarray) -> np.ndarray:
    center_x = bounds_min[0] + size[0] * 0.5
    z_min = bounds_min[2] + size[2] * 0.32
    z_max = bounds_min[2] + size[2] * 0.68
    body_mask = np.abs(vertices_local[:, 0] - center_x) <= size[0] * 0.30
    z_mask = (vertices_local[:, 2] >= z_min) & (vertices_local[:, 2] <= z_max)
    mask = body_mask & z_mask
    if int(np.count_nonzero(mask)) < 12:
        mask = z_mask
    if int(np.count_nonzero(mask)) < 8:
        mask = np.ones(len(vertices_local), dtype=bool)
    points = vertices_local[mask]
    if len(points) == 0:
        return np.array([center_x, float(vertices_local[:, 1].mean()), bounds_min[2] + size[2] * 0.50], dtype=np.float64)
    return np.array([float(np.mean(points[:, 0])), float(np.mean(points[:, 1])), float(np.mean(points[:, 2]))], dtype=np.float64)


def _choose_semantic_loops(vertices_local: np.ndarray, loops: list[np.ndarray]) -> tuple[dict[str, Any], dict[str, Any] | None, list[dict[str, Any]]]:
    bounds_min = vertices_local.min(axis=0)
    bounds_max = vertices_local.max(axis=0)
    size = np.maximum(bounds_max - bounds_min, 1e-9)
    features = _loop_features(vertices_local, loops, bounds_min, size)
    noisy_boundary_mode = len(features) >= 12
    collar_candidates = [
        item for item in features
        if item["z01"] >= 0.50 and item["x_center_norm"] <= 0.32 and item["spans"][0] <= size[0] * 0.62
    ]
    if collar_candidates and not noisy_boundary_mode:
        collar = min(
            collar_candidates,
            key=lambda item: (1.0 - item["z01"]) * 2.0 + item["x_center_norm"] * 1.5 + item["spans"][0] / size[0],
        )
    else:
        collar = _fallback_collar(vertices_local, bounds_min, size)
        collar["fallback_reason"] = "too_many_boundary_loops" if noisy_boundary_mode else "no_reliable_collar_loop"

    hem_candidates = [
        item for item in features
        if item is not collar and item["z01"] <= 0.48 and item["spans"][0] >= size[0] * 0.28
    ]
    hem = min(
        hem_candidates,
        key=lambda item: item["z01"] * 2.0 - item["spans"][0] / size[0],
    ) if hem_candidates else None
    collar["noisy_boundary_mode"] = noisy_boundary_mode
    return collar, hem, features

def _candidate_score(
    vertices: np.ndarray,
    loops: list[np.ndarray],
    rotation: np.ndarray,
    target_dims: np.ndarray,
) -> tuple[float, dict[str, Any]]:
    local = vertices @ rotation.T
    bounds_min = local.min(axis=0)
    bounds_max = local.max(axis=0)
    size = np.maximum(bounds_max - bounds_min, 1e-9)
    ratios = np.maximum(target_dims, 1e-9) / size
    uniform = float(np.exp(np.mean(np.log(ratios))))
    fitted = size * uniform
    dimension_score = float(np.sum(np.abs(np.log(np.maximum(fitted, 1e-9) / np.maximum(target_dims, 1e-9)))))

    collar, hem, loop_features = _choose_semantic_loops(local, loops)
    collar_score = (1.0 - collar["z01"]) * 3.0 + collar["x_center_norm"] * 2.0
    collar_score += float(collar["spans"][0] / max(size[0], 1e-9)) * 0.8

    if hem is not None:
        hem_score = hem["z01"] * 2.5 + max(0.0, 0.36 - float(hem["spans"][0] / size[0])) * 3.0
        vertical_order_penalty = 0.0 if collar["center"][2] > hem["center"][2] else 8.0
    else:
        hem_score = 1.8
        vertical_order_penalty = 0.8

    # The front of a crew-neck garment is normally lower than the back.
    collar_points = local[collar["indices"]]
    center_y = float(collar["center"][1])
    positive = collar_points[collar_points[:, 1] >= center_y]
    negative = collar_points[collar_points[:, 1] < center_y]
    if len(positive) >= 2 and len(negative) >= 2:
        front_drop = float(np.mean(negative[:, 2]) - np.mean(positive[:, 2]))
        front_score = 0.0 if front_drop >= -size[2] * 0.01 else min(2.0, abs(front_drop) / size[2] * 8.0)
    else:
        front_drop = 0.0
        front_score = 0.25

    side_loops = [
        item for item in loop_features
        if item is not collar and item is not hem and abs(item["center"][0] - (bounds_min[0] + size[0] * 0.5)) >= size[0] * 0.18
    ]
    left = [item for item in side_loops if item["center"][0] < bounds_min[0] + size[0] * 0.5]
    right = [item for item in side_loops if item["center"][0] > bounds_min[0] + size[0] * 0.5]
    cuff_score = 0.0 if left and right else 0.7
    if left and right:
        left_best = max(left, key=lambda item: abs(item["center"][0]))
        right_best = max(right, key=lambda item: abs(item["center"][0]))
        cuff_score += abs(float(left_best["center"][2] - right_best["center"][2])) / size[2]

    total = dimension_score + collar_score + hem_score + vertical_order_penalty + front_score + cuff_score
    return total, {
        "local_vertices": local,
        "bounds_min": bounds_min,
        "bounds_max": bounds_max,
        "size": size,
        "collar": collar,
        "hem": hem,
        "loop_count": len(loop_features),
        "dimension_score": dimension_score,
        "front_drop": front_drop,
        "cuff_pair_detected": bool(left and right),
    }


def _semantic_alignment_matrix(
    mesh: trimesh.Trimesh,
    run_result: dict[str, Any],
    template_info: dict[str, Any],
    fit_mode: str,
) -> tuple[np.ndarray, dict[str, Any]]:
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    target = _alignment_target(run_result, template_info, fit_mode)
    target_dims = np.asarray(target["target_dims"], dtype=np.float64)
    body = _body_semantic_frame(run_result)
    loops = _boundary_loops(mesh)

    evaluated: list[tuple[float, np.ndarray, dict[str, Any]]] = []
    for rotation in _rotation_candidates():
        score, details = _candidate_score(vertices, loops, rotation, target_dims)
        evaluated.append((score, rotation, details))
    evaluated.sort(key=lambda item: item[0])
    best_score, rotation, details = evaluated[0]

    local = details["local_vertices"]
    size = np.maximum(details["size"], 1e-9)
    raw_scales = target_dims / size
    # Prevent a corrupted GLB from exploding in a single axis while still allowing
    # the non-uniform normalization needed by r1/h1.
    geometric = float(np.exp(np.mean(np.log(np.maximum(raw_scales, 1e-9)))))
    scales = np.clip(raw_scales, geometric * 0.52, geometric * 1.92)
    collar_local = np.asarray(details["collar"]["center"], dtype=np.float64)
    shoulder_local = _estimate_shoulder_reference(local, details["bounds_min"], size)
    torso_local = _estimate_torso_reference(local, details["bounds_min"], size)

    body_matrix = np.asarray(body["matrix"], dtype=np.float64)
    target_neck = np.asarray(body["neck_center"], dtype=np.float64)
    target_shoulder = np.asarray(body["shoulder_center"], dtype=np.float64)
    target_torso = np.asarray(body["torso_center"], dtype=np.float64)
    scaled_rotation = np.diag(scales) @ rotation
    linear = body_matrix @ scaled_rotation

    noisy_boundary_mode = bool(details["collar"].get("noisy_boundary_mode"))
    collar_weight = 0.15 if noisy_boundary_mode or details["collar"].get("fallback") else 0.55
    shoulder_weight = 0.35 if noisy_boundary_mode else 0.25
    torso_weight = 0.50 if noisy_boundary_mode else 0.20
    translation_terms: list[np.ndarray] = []
    translation_weights: list[float] = []
    translation_terms.append(target_neck - body_matrix @ (np.diag(scales) @ collar_local))
    translation_weights.append(collar_weight)
    translation_terms.append(target_shoulder - body_matrix @ (np.diag(scales) @ shoulder_local))
    translation_weights.append(shoulder_weight)
    translation_terms.append(target_torso - body_matrix @ (np.diag(scales) @ torso_local))
    translation_weights.append(torso_weight)
    weight_sum = float(sum(translation_weights)) if translation_weights else 1.0
    translation = sum(term * weight for term, weight in zip(translation_terms, translation_weights)) / max(weight_sum, 1e-9)

    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = linear
    matrix[:3, 3] = translation

    hom = np.ones((len(vertices), 4), dtype=np.float64)
    hom[:, :3] = vertices
    aligned = (matrix @ hom.T).T[:, :3]
    body_local = (aligned - target_neck[None, :]) @ body_matrix

    target_width, target_depth, target_length = target_dims.tolist()
    center_x = float(np.median(body_local[:, 0]))
    center_y = float(np.median(body_local[:, 1]))
    fraction_below_neck = float(np.mean(body_local[:, 2] <= target_length * 0.08))
    vertical_min = float(np.min(body_local[:, 2]))
    vertical_max = float(np.max(body_local[:, 2]))

    chest_center_world = np.asarray(body["torso_center"], dtype=np.float64)
    chest_local = (chest_center_world - target_neck) @ body_matrix
    chest_band = np.abs(body_local[:, 2] - chest_local[2]) <= target_length * 0.20
    chest_points = body_local[chest_band] if np.any(chest_band) else body_local
    depth_min = float(np.min(chest_points[:, 1]))
    depth_max = float(np.max(chest_points[:, 1]))
    straddles_torso = depth_min <= chest_local[1] + target_depth * 0.18 and depth_max >= chest_local[1] - target_depth * 0.18

    left_shoulder = _first_point(_anchor_source(run_result, "shoulder_left"), _anchor_source(run_result, "left_shoulder"))
    right_shoulder = _first_point(_anchor_source(run_result, "shoulder_right"), _anchor_source(run_result, "right_shoulder"))
    shoulder_coverage = True
    shoulder_local_targets: list[float] = []
    for shoulder in (left_shoulder, right_shoulder):
        if shoulder is not None:
            shoulder_local_targets.append(float((shoulder - target_neck) @ body_matrix[:, 0]))
    if shoulder_local_targets:
        shoulder_band = body_local[:, 2] >= -target_length * 0.28
        upper = body_local[shoulder_band] if np.any(shoulder_band) else body_local
        shoulder_coverage = float(np.min(upper[:, 0])) <= min(shoulder_local_targets) and float(np.max(upper[:, 0])) >= max(shoulder_local_targets)

    collar_after = body_matrix @ (np.diag(scales) @ collar_local) + translation
    collar_error = float(np.linalg.norm(collar_after - target_neck))
    centered = abs(center_x) <= target_width * 0.14 and abs(center_y - chest_local[1]) <= target_depth * 0.55
    hangs_down = fraction_below_neck >= 0.72 and vertical_min <= -target_length * 0.58 and vertical_max <= target_length * 0.35
    orientation_confident = bool(best_score <= evaluated[min(1, len(evaluated) - 1)][0] + 2.5)
    semantic_ready = bool(
        np.isfinite(matrix).all()
        and collar_error <= max(target_depth * 0.08, target["cm_to_geometry"] * 1.5)
        and centered
        and hangs_down
        and straddles_torso
        and shoulder_coverage
        and details["collar"]["z01"] >= 0.52
    )

    report = {
        "version": "clouva-template-semantic-auto-align-v1.1.3",
        "method": "body-frame-loop-gated-weighted-translation-v1.1.3",
        "garment_type": target["garment_type"],
        "candidate_count": len(evaluated),
        "selected_orientation_score": float(best_score),
        "second_orientation_score": float(evaluated[min(1, len(evaluated) - 1)][0]),
        "orientation_confident": orientation_confident,
        "boundary_loop_count": int(details["loop_count"]),
        "collar_detected_from_boundary": not bool(details["collar"].get("fallback")),
        "cuff_pair_detected": bool(details["cuff_pair_detected"]),
        "front_neck_drop_geometry": float(details["front_drop"]),
        "source_to_semantic_rotation": rotation.astype(float).tolist(),
        "scale_xyz_semantic": scales.astype(float).tolist(),
        "target_dimensions_geometry": target_dims.astype(float).tolist(),
        "target_dimensions_cm": {
            "overall_width": float(target_dims[0] * target["geometry_to_meters"] * 100.0),
            "depth": float(target_dims[1] * target["geometry_to_meters"] * 100.0),
            "length": float(target_dims[2] * target["geometry_to_meters"] * 100.0),
        },
        "body_frame_matrix": body_matrix.astype(float).tolist(),
        "body_frame_axes": {
            "right": body["right"].astype(float).tolist(),
            "front": body["front"].astype(float).tolist(),
            "up": body["up"].astype(float).tolist(),
        },
        "target_neck_source": target_neck.astype(float).tolist(),
        "target_shoulder_source": np.asarray(body["shoulder_center"], dtype=np.float64).astype(float).tolist(),
        "collar_reference_local": collar_local.astype(float).tolist(),
        "shoulder_reference_local": shoulder_local.astype(float).tolist(),
        "torso_reference_local": torso_local.astype(float).tolist(),
        "boundary_mode": "fallback_top_center" if noisy_boundary_mode or bool(details["collar"].get("fallback")) else "boundary_loop",
        "translation_strategy": {
            "collar_weight": float(collar_weight),
            "shoulder_weight": float(shoulder_weight),
            "torso_weight": float(torso_weight),
        },
        "translation": translation.astype(float).tolist(),
        "matrix": matrix.astype(float).tolist(),
        "validation": {
            "collar_error_geometry": collar_error,
            "center_x_geometry": center_x,
            "center_depth_geometry": center_y,
            "fraction_vertices_below_neck": fraction_below_neck,
            "vertical_min_geometry": vertical_min,
            "vertical_max_geometry": vertical_max,
            "depth_min_at_chest_geometry": depth_min,
            "depth_max_at_chest_geometry": depth_max,
            "torso_depth_straddled": bool(straddles_torso),
            "shoulders_covered": bool(shoulder_coverage),
            "centered_on_torso": bool(centered),
            "hangs_down_body": bool(hangs_down),
        },
        "ready": semantic_ready,
    }
    return matrix, report


def auto_align_template_mesh(mesh: trimesh.Trimesh, run_result: dict[str, Any], template_info: dict[str, Any], fit_mode: str = "oversized") -> tuple[trimesh.Trimesh, dict[str, Any]]:
    matrix, report = _semantic_alignment_matrix(mesh, run_result, template_info, fit_mode)
    aligned = mesh.copy()
    aligned.apply_transform(matrix)
    return aligned, report


def create_aligned_preview(
    run_result: dict[str, Any],
    template_info: dict[str, Any],
    template_glb: Path,
    output_dir: Path,
    fit_mode: str = "oversized",
    avatar_glb: Path | None = None,
) -> PreviewArtifacts:
    if fit_mode not in FIT_EASE:
        raise TemplateFitError(f"Fit no soportado: {fit_mode}")
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_mesh = _combined_mesh(template_glb)
    matrix, alignment = _semantic_alignment_matrix(raw_mesh, run_result, template_info, fit_mode)
    scene = _load_scene(template_glb)
    scene.apply_transform(matrix)
    safe_code = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in str(template_info.get("code") or "garment")).strip("-") or "garment"
    glb_path = output_dir / f"{safe_code}_aligned_preview.glb"
    alignment_json_path = output_dir / "template_alignment.json"
    scene.export(glb_path)

    aligned_mesh = raw_mesh.copy()
    aligned_mesh.apply_transform(matrix)
    body_vertices = _avatar_vertices(avatar_glb) if avatar_glb and avatar_glb.is_file() else np.zeros((0, 3), dtype=np.float64)
    clearance = _nearest_vertex_distances(np.asarray(aligned_mesh.vertices, dtype=np.float64), body_vertices)
    ready = bool(alignment.get("ready"))
    payload = {
        "version": "clouva-template-semantic-auto-align-v1.1.3",
        "status": "template_semantically_aligned_preview_ready" if ready else "template_alignment_review_required",
        "template": {
            "asset_key": template_info.get("asset_key"),
            "id": template_info.get("id"),
            "code": template_info.get("code"),
            "name": template_info.get("name"),
            "category": template_info.get("category"),
            "normalized_category": template_info.get("normalized_category"),
        },
        "fit": fit_mode,
        "alignment": alignment,
        "mesh": {
            "vertex_count": int(len(raw_mesh.vertices)),
            "triangle_count": int(len(raw_mesh.faces)),
        },
        "readiness": {
            "preview_ready": True,
            "template_library_connected": True,
            "auto_alignment_ready": ready,
            "semantic_orientation_ready": ready,
            "meshy_payload_ready": False,
        },
        "asset_paths": {
            "glb": glb_path.name,
            "alignment_json": alignment_json_path.name,
        },
        "clearance": {
            "available": bool(clearance["sample_count"] > 0),
            "method": "nearest_body_vertex_estimate",
            "minimum_vertex_body_distance_cm": float(clearance["minimum_vertex_body_distance_cm"]),
            "median_vertex_body_distance_cm": float(clearance["median_vertex_body_distance_cm"]),
            "sample_count": int(clearance["sample_count"]),
        },
        "warnings": [] if ready else ["SEMANTIC_ALIGNMENT_REVIEW_REQUIRED"],
    }
    alignment_json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return PreviewArtifacts(glb_path=glb_path, alignment_json_path=alignment_json_path, payload=payload)


def _value_cm(measurements: dict[str, Any], key: str, default: float | None = None) -> float:
    values = measurements.get("values", {})
    item = values.get(key) if isinstance(values, dict) else None
    if isinstance(item, dict) and item.get("status") in {"valid", "estimated_open_section"}:
        value = item.get("value_cm")
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            return float(value)
    if default is None:
        raise TemplateFitError(f"Falta la medida {key}")
    return float(default)


def _section_dim_cm(measurements: dict[str, Any], section_name: str, dim_key: str, default: float | None = None) -> float:
    section = measurements.get("sections", {}).get(section_name, {}) if isinstance(measurements.get("sections"), dict) else {}
    value = section.get(dim_key)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if default is None:
        raise TemplateFitError(f"Falta la dimensión {section_name}.{dim_key}")
    return float(default)


def _body_height_m(measurements: dict[str, Any]) -> float:
    scale = measurements.get("scale", {})
    height_cm = scale.get("height_cm")
    if isinstance(height_cm, (int, float)) and height_cm > 0:
        return float(height_cm) / 100.0
    return _value_cm(measurements, "height", 180.0) / 100.0


def _avatar_vertices(avatar_glb: Path) -> np.ndarray:
    try:
        mesh = _combined_mesh(avatar_glb)
    except Exception:
        return np.zeros((0, 3), dtype=np.float64)
    return np.asarray(mesh.vertices, dtype=np.float64)


def _nearest_vertex_distances(vertices: np.ndarray, body_vertices: np.ndarray, limit: int = 2000) -> dict[str, float]:
    if len(vertices) == 0 or len(body_vertices) == 0:
        return {
            "sample_count": 0,
            "minimum_vertex_body_distance_cm": 0.0,
            "median_vertex_body_distance_cm": 0.0,
        }
    if len(vertices) > limit:
        index = np.linspace(0, len(vertices) - 1, limit).astype(np.int64)
        sample = vertices[index]
    else:
        sample = vertices
    min_distances = []
    step = 250
    for vertex in sample:
        best = float("inf")
        for start in range(0, len(body_vertices), step):
            block = body_vertices[start : start + step]
            delta = block - vertex[None, :]
            block_best = np.sqrt(np.sum(delta * delta, axis=1)).min()
            if block_best < best:
                best = float(block_best)
        min_distances.append(best)
    data = np.asarray(min_distances, dtype=np.float64)
    return {
        "sample_count": int(len(data)),
        "minimum_vertex_body_distance_cm": float(np.min(data) * 100.0),
        "median_vertex_body_distance_cm": float(np.median(data) * 100.0),
    }


def _measure_targets(measurements: dict[str, Any], fit_mode: str, garment_type: str) -> dict[str, float]:
    ease = FIT_EASE[fit_mode]
    shoulder = _value_cm(measurements, "shoulder_width", 22.0)
    chest_width = _section_dim_cm(measurements, "chest", "width_cm", shoulder * 0.82)
    chest_depth = _section_dim_cm(measurements, "chest", "depth_cm", chest_width * 0.70)
    waist_width = _section_dim_cm(measurements, "waist", "width_cm", chest_width * 0.91)
    waist_depth = _section_dim_cm(measurements, "waist", "depth_cm", chest_depth * 0.96)
    neck_width = _section_dim_cm(measurements, "neck", "width_cm", shoulder * 0.33)
    neck_depth = _section_dim_cm(measurements, "neck", "depth_cm", chest_depth * 0.36)
    torso_height = max(_section_dim_cm(measurements, "chest", "z", 0.0) - _section_dim_cm(measurements, "hip", "z", 0.0), 0.0)
    left_arm = _value_cm(measurements, "left_arm_length", 57.0)
    right_arm = _value_cm(measurements, "right_arm_length", 57.0)
    avg_arm = (left_arm + right_arm) * 0.5

    defaults = CATEGORY_DEFAULTS["h1"] if garment_type == "hoodie" else CATEGORY_DEFAULTS["r1"]
    sleeve_length = avg_arm * defaults["sleeve_length_ratio"]
    if garment_type == "hoodie":
        sleeve_length = max(sleeve_length, avg_arm * 0.40)

    hem_width = max(chest_width, waist_width) + ease["hem_extra_cm"]
    return {
        "shoulder_width_cm": shoulder + ease["shoulder_extra_cm"],
        "chest_width_cm": chest_width + ease["chest_extra_cm"],
        "chest_depth_cm": chest_depth + ease["chest_extra_cm"] * 0.55,
        "waist_width_cm": waist_width + ease["waist_extra_cm"],
        "waist_depth_cm": waist_depth + ease["waist_extra_cm"] * 0.45,
        "hem_width_cm": hem_width,
        "hem_depth_cm": waist_depth + ease["hem_extra_cm"] * 0.42,
        "neck_width_cm": neck_width + ease["collar_extra_cm"],
        "neck_depth_cm": neck_depth + ease["collar_extra_cm"] * 0.60,
        "sleeve_length_cm": sleeve_length,
        "sleeve_radius_cm": max(3.0, _section_dim_cm(measurements, "left_bicep", "width_cm", 9.0) * 0.32 + ease["sleeve_radius_extra_cm"]),
        "garment_length_cm": max(32.0, torso_height * 100.0 * 0.82 + 20.0 + ease["length_extra_cm"]),
    }


def _smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _apply_fit(mesh: trimesh.Trimesh, targets_cm: dict[str, float], fit_mode: str) -> tuple[trimesh.Trimesh, dict[str, Any]]:
    mesh = mesh.copy()
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    bounds_min = vertices.min(axis=0)
    bounds_max = vertices.max(axis=0)
    center = (bounds_min + bounds_max) * 0.5
    size = bounds_max - bounds_min
    eps = 1e-8

    x = vertices[:, 0] - center[0]
    y = vertices[:, 1] - center[1]
    z = vertices[:, 2] - bounds_min[2]
    z01 = z / max(size[2], eps)
    absx01 = np.abs(x) / max(size[0] * 0.5, eps)

    body_band = 1.0 - _smoothstep((absx01 - 0.58) / 0.22)
    upper_band = _smoothstep((z01 - 0.58) / 0.14)
    top_band = _smoothstep((z01 - 0.82) / 0.12)
    sleeve_weight = np.clip(_smoothstep((absx01 - 0.48) / 0.18) * _smoothstep((z01 - 0.36) / 0.12), 0.0, 1.0)
    torso_weight = np.clip(body_band * (1.0 - sleeve_weight * 0.75), 0.0, 1.0)

    # Template baseline dimensions.
    shoulder_width_0 = size[0] * 0.88 * 100.0
    chest_width_0 = size[0] * 0.76 * 100.0
    waist_width_0 = size[0] * 0.68 * 100.0
    hem_width_0 = size[0] * 0.76 * 100.0
    depth_0 = size[1] * 100.0
    neck_width_0 = size[0] * 0.22 * 100.0
    neck_depth_0 = size[1] * 0.22 * 100.0
    garment_length_0 = size[2] * 100.0

    chest_scale_x = targets_cm["chest_width_cm"] / max(chest_width_0, eps)
    waist_scale_x = targets_cm["waist_width_cm"] / max(waist_width_0, eps)
    hem_scale_x = targets_cm["hem_width_cm"] / max(hem_width_0, eps)
    shoulder_scale_x = targets_cm["shoulder_width_cm"] / max(shoulder_width_0, eps)

    chest_scale_y = targets_cm["chest_depth_cm"] / max(depth_0 * 0.96, eps)
    waist_scale_y = targets_cm["waist_depth_cm"] / max(depth_0 * 0.92, eps)
    hem_scale_y = targets_cm["hem_depth_cm"] / max(depth_0 * 0.88, eps)

    vertical_profile = np.where(
        z01 > 0.72,
        shoulder_scale_x,
        np.where(
            z01 > 0.48,
            chest_scale_x + (shoulder_scale_x - chest_scale_x) * _smoothstep((z01 - 0.48) / 0.24),
            np.where(
                z01 > 0.22,
                waist_scale_x + (chest_scale_x - waist_scale_x) * _smoothstep((z01 - 0.22) / 0.26),
                hem_scale_x + (waist_scale_x - hem_scale_x) * _smoothstep(z01 / 0.22),
            ),
        ),
    )

    vertical_profile_y = np.where(
        z01 > 0.48,
        chest_scale_y,
        np.where(z01 > 0.22, waist_scale_y, hem_scale_y),
    )

    new_x = center[0] + x * (1.0 + (vertical_profile - 1.0) * torso_weight)
    new_y = center[1] + y * (1.0 + (vertical_profile_y - 1.0) * torso_weight)

    garment_length_scale = targets_cm["garment_length_cm"] / max(garment_length_0, eps)
    new_z = bounds_min[2] + z * garment_length_scale

    # Neck opening preservation / widening.
    collar_radius_scale = targets_cm["neck_width_cm"] / max(neck_width_0, eps)
    front_depth_scale = targets_cm["neck_depth_cm"] / max(neck_depth_0, eps)
    neck_mask = np.clip(top_band * body_band, 0.0, 1.0)
    new_x = center[0] + (new_x - center[0]) * (1.0 + (collar_radius_scale - 1.0) * neck_mask)
    front_mask = neck_mask * _smoothstep((center[1] - y) / max(size[1] * 0.35, eps))
    back_mask = neck_mask * _smoothstep((y - center[1]) / max(size[1] * 0.35, eps))
    new_y = new_y - front_mask * (targets_cm["neck_depth_cm"] - neck_depth_0) / 100.0
    new_y = new_y + back_mask * min((targets_cm["neck_depth_cm"] - neck_depth_0) / 100.0, 0.003)

    # Sleeve expansion.
    sleeve_length_scale = targets_cm["sleeve_length_cm"] / max(size[0] * 0.16 * 100.0, eps)
    sleeve_radius_scale = targets_cm["sleeve_radius_cm"] / max(size[0] * 0.06 * 100.0, eps)
    side_sign = np.sign(x)
    new_x = new_x + sleeve_weight * side_sign * (np.abs(x) * (sleeve_length_scale - 1.0)) * 0.42
    new_y = center[1] + (new_y - center[1]) * (1.0 + (sleeve_radius_scale - 1.0) * sleeve_weight)
    new_z = new_z - sleeve_weight * (1.0 - z01) * 0.06 * (sleeve_length_scale - 1.0)

    fitted_vertices = np.column_stack([new_x, new_y, new_z])

    # Soft shoulder drop for cleaner collar/armhole transition.
    shoulder_drop = 0.006 if fit_mode == "base" else 0.009 if fit_mode == "regular" else 0.012
    fitted_vertices[:, 2] -= top_band * (1.0 - body_band * 0.65) * shoulder_drop

    fitted = trimesh.Trimesh(vertices=fitted_vertices, faces=mesh.faces.copy(), process=False)
    try:
        fitted.update_faces(fitted.unique_faces())
    except Exception:
        pass
    fitted.remove_unreferenced_vertices()
    try:
        fitted.merge_vertices()
    except Exception:
        pass
    try:
        fitted.fix_normals()
    except Exception:
        pass

    bounds = fitted.bounds
    size_f = bounds[1] - bounds[0]
    report = {
        "vertex_count": int(len(fitted.vertices)),
        "triangle_count": int(len(fitted.faces)),
        "bounds_min": bounds[0].astype(float).tolist(),
        "bounds_max": bounds[1].astype(float).tolist(),
        "outer_dimensions_cm": {
            "width": float(size_f[0] * 100.0),
            "depth": float(size_f[1] * 100.0),
            "height": float(size_f[2] * 100.0),
        },
        "topology": {
            "connected_shells": int(len(fitted.split(only_watertight=False))),
            "watertight": bool(fitted.is_watertight),
            "euler_number": int(fitted.euler_number),
        },
    }
    return fitted, report


def fit_template_to_run(
    run_result: dict[str, Any],
    template_info: dict[str, Any],
    template_glb: Path,
    avatar_glb: Path | None,
    output_dir: Path,
    fit_mode: str = "oversized",
) -> FitArtifacts:
    if fit_mode not in FIT_EASE:
        raise TemplateFitError(f"Fit no soportado: {fit_mode}")
    output_dir.mkdir(parents=True, exist_ok=True)
    measurements = run_result.get("body_measurements")
    if not isinstance(measurements, dict):
        raise TemplateFitError("El run anatómico no tiene body_measurements")

    template_code = str(template_info.get("code") or "garment").lower()
    normalized_category = str(template_info.get("normalized_category") or template_info.get("category") or "tshirt").lower()
    garment_type = "hoodie" if normalized_category == "hoodie" else "tshirt"
    targets = _measure_targets(measurements, fit_mode, garment_type)
    raw_mesh = _combined_mesh(template_glb)
    mesh, alignment = auto_align_template_mesh(raw_mesh, run_result, template_info, fit_mode)

    # The avatar GLB may use Y-up (as this project does) or another source frame.
    # Apply the shape fit in semantic garment coordinates and then return to the
    # original avatar coordinate system. This avoids repeating the v1.1.1 error
    # where the preview aligned in one frame but the fit deformed in global XYZ.
    body_matrix = np.asarray(alignment.get("body_frame_matrix"), dtype=np.float64)
    target_neck = np.asarray(alignment.get("target_neck_source"), dtype=np.float64)
    if body_matrix.shape != (3, 3) or target_neck.shape != (3,):
        raise TemplateFitError("El alineado semántico no devolvió un frame corporal válido")
    semantic_vertices = (np.asarray(mesh.vertices, dtype=np.float64) - target_neck[None, :]) @ body_matrix
    semantic_mesh = trimesh.Trimesh(vertices=semantic_vertices, faces=np.asarray(mesh.faces, dtype=np.int64).copy(), process=False)
    fitted_semantic, mesh_report = _apply_fit(semantic_mesh, targets, fit_mode)
    fitted_world_vertices = target_neck[None, :] + np.asarray(fitted_semantic.vertices, dtype=np.float64) @ body_matrix.T
    fitted_mesh = trimesh.Trimesh(vertices=fitted_world_vertices, faces=np.asarray(fitted_semantic.faces, dtype=np.int64).copy(), process=False)
    try:
        fitted_mesh.fix_normals()
    except Exception:
        pass

    garment_id = uuid.uuid4().hex
    safe_code = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in template_code).strip("-") or "garment"
    glb_path = output_dir / f"{safe_code}_fitted.glb"
    fit_json_path = output_dir / "garment_fit.json"
    meshy_payload_path = output_dir / "meshy_template_payload.json"
    collision_json_path = output_dir / "garment_collision_report.json"

    fitted_mesh.export(glb_path)
    body_vertices = _avatar_vertices(avatar_glb) if avatar_glb and avatar_glb.is_file() else np.zeros((0, 3), dtype=np.float64)
    clearance = _nearest_vertex_distances(np.asarray(fitted_mesh.vertices, dtype=np.float64), body_vertices)
    min_clearance = clearance["minimum_vertex_body_distance_cm"]

    fit_json = {
        "version": "clouva-template-fit-engine-v1.1.3",
        "garment_id": garment_id,
        "input_run_id": run_result.get("run_id"),
        "template": {
            "asset_key": template_info.get("asset_key"),
            "id": template_info.get("id"),
            "code": template_code,
            "name": template_info.get("name"),
            "category": template_info.get("category"),
            "normalized_category": normalized_category,
            "bucket": template_info.get("bucket"),
            "storage_path": template_info.get("storage_path"),
            "source_table": template_info.get("source_table"),
        },
        "garment_type": garment_type,
        "fit": fit_mode,
        "status": "template_semantically_aligned_and_fitted_ready" if alignment.get("ready") else "template_fit_alignment_review_required",
        "readiness": {
            "preview_ready": True,
            "export_glb_ready": True,
            "template_library_connected": True,
            "auto_alignment_ready": bool(alignment.get("ready")),
            "collision_review_ready": bool(min_clearance >= 0.7),
            "meshy_payload_ready": True,
        },
        "mesh": mesh_report,
        "alignment": alignment,
        "measurements_used": {
            key: float(value) for key, value in targets.items()
        },
        "clearance": {
            "available": bool(clearance["sample_count"] > 0),
            "method": "nearest_body_vertex_estimate",
            "minimum_vertex_body_distance_cm": float(clearance["minimum_vertex_body_distance_cm"]),
            "median_vertex_body_distance_cm": float(clearance["median_vertex_body_distance_cm"]),
            "sample_count": int(clearance["sample_count"]),
            "warning_below_0_7cm": bool(clearance["sample_count"] > 0 and clearance["minimum_vertex_body_distance_cm"] < 0.7),
        },
        "exports": {
            "glb": glb_path.name,
            "fit_json": fit_json_path.name,
            "meshy_payload": meshy_payload_path.name,
            "collision_json": collision_json_path.name,
        },
        "warnings": [],
    }
    if clearance["sample_count"] == 0:
        fit_json["warnings"].append("CLEARANCE_ESTIMATE_UNAVAILABLE")
    elif min_clearance < 0.7:
        fit_json["warnings"].append("LOW_CLEARANCE_REVIEW_SHOULDERS_OR_ARMPITS")

    meshy_payload = {
        "version": "clouva-meshy-template-payload-v1.1.3",
        "source": "CLOUVA Anatomy Lab Template Fit Engine",
        "run_id": run_result.get("run_id"),
        "garment_id": garment_id,
        "asset_key": template_info.get("asset_key"),
        "template_code": template_code,
        "template_name": template_info.get("name"),
        "fit_mode": fit_mode,
        "avatar_measurements": run_result.get("body_measurements"),
        "garment_measurements": targets,
        "template_alignment": alignment,
        "garment_anchors": run_result.get("garment_anchors"),
        "internal_joints": run_result.get("internal_joints"),
        "exports": {
            "base_fitted_glb": glb_path.name,
            "fit_json": fit_json_path.name,
        },
        "instruction": (
            "Usar este GLB ajustado como molde base real para generar la versión artística final, "
            "sin alterar cuello, sisas ni proporciones anatómicas validadas."
        ),
    }
    collision_report = {
        "version": "clouva-template-fit-engine-v1.1.3",
        "status": "review_required" if min_clearance < 0.7 else "ok",
        "method": "nearest_body_vertex_estimate",
        "body_clearance": fit_json["clearance"],
        "limitations": [
            "Esta validación es una estimación por distancia a vértices del avatar, no una simulación de tela.",
            "Conviene revisar hombros, cuello y axilas visualmente en el preview antes de exportar a producción.",
        ],
    }

    fit_json_path.write_text(json.dumps(fit_json, ensure_ascii=False, indent=2), encoding="utf-8")
    meshy_payload_path.write_text(json.dumps(meshy_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    collision_json_path.write_text(json.dumps(collision_report, ensure_ascii=False, indent=2), encoding="utf-8")

    return FitArtifacts(
        garment_id=garment_id,
        glb_path=glb_path,
        fit_json_path=fit_json_path,
        meshy_payload_path=meshy_payload_path,
        collision_json_path=collision_json_path,
        fit_json=fit_json,
    )
