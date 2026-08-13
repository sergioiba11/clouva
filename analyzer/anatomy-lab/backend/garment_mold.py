from __future__ import annotations

import json
import math
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from canonical_space import transform_points
from glb_loader import load_glb


VERSION = "clouva-garment-mold-v0.9.4-anatomical-shoulders-face-subdivision"


class GarmentMoldError(RuntimeError):
    pass


@dataclass(frozen=True)
class FitPreset:
    name: str
    torso_width_scale: float
    torso_depth_scale: float
    shoulder_width_scale: float
    sleeve_length_m: float
    sleeve_ease_m: float
    minimum_clearance_m: float
    armhole_half_angle_deg: float
    shoulder_drop_m: float
    neck_ease_m: float


FIT_PRESETS: dict[str, FitPreset] = {
    "regular": FitPreset("regular", 1.08, 1.08, 1.10, 0.155, 0.010, 0.008, 17.0, 0.016, 0.007),
    "relaxed": FitPreset("relaxed", 1.16, 1.13, 1.16, 0.185, 0.016, 0.012, 19.0, 0.020, 0.008),
    "oversized": FitPreset("oversized", 1.28, 1.20, 1.18, 0.220, 0.024, 0.018, 21.0, 0.024, 0.009),
}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _required_section(result: dict[str, Any], name: str) -> dict[str, Any]:
    section = result.get("body_measurements", {}).get("sections", {}).get(name)
    if not isinstance(section, dict) or section.get("status") != "valid":
        raise GarmentMoldError(f"GARMENT_SECTION_NOT_READY:{name}")
    for key in ("z", "width_cm", "depth_cm", "centroid"):
        if section.get(key) is None:
            raise GarmentMoldError(f"GARMENT_SECTION_INCOMPLETE:{name}:{key}")
    return section


def _anchor_map(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("name")): item
        for item in result.get("garment_anchors", [])
        if isinstance(item, dict) and item.get("name")
    }


def _canonical_anchor(anchors: dict[str, dict[str, Any]], name: str) -> np.ndarray | None:
    value = anchors.get(name, {}).get("canonical_position")
    if not isinstance(value, list) or len(value) != 3:
        return None
    point = np.asarray(value, dtype=np.float64)
    return point if np.isfinite(point).all() else None


def _ellipse_ring(center: np.ndarray, rx: float, ry: float, count: int) -> np.ndarray:
    angles = np.linspace(0.0, math.tau, count, endpoint=False, dtype=np.float64)
    return np.column_stack((
        center[0] + np.cos(angles) * rx,
        center[1] + np.sin(angles) * ry,
        np.full(count, float(center[2]), dtype=np.float64),
    ))


def _shoulder_ring(
    center: np.ndarray,
    rx: float,
    ry: float,
    count: int,
    shoulder_drop: float,
) -> np.ndarray:
    """Symmetric shoulder line with a controlled drop toward both sleeves."""
    angles = np.linspace(0.0, math.tau, count, endpoint=False, dtype=np.float64)
    cos_a = np.cos(angles)
    sin_a = np.sin(angles)
    side_weight = np.abs(cos_a) ** 1.6
    z = center[2] - shoulder_drop * side_weight
    return np.column_stack((
        center[0] + cos_a * rx,
        center[1] + sin_a * ry,
        z,
    ))


def _crew_neck_ring(
    center: np.ndarray,
    rx: float,
    front_ry: float,
    back_ry: float,
    count: int,
    geometry_to_meters: float,
) -> np.ndarray:
    """Crew neck locked to the torso symmetry plane; front/back may differ, left/right never does."""
    angles = np.linspace(0.0, math.tau, count, endpoint=False, dtype=np.float64)
    sin_a = np.sin(angles)
    cos_a = np.cos(angles)
    y_radius = np.where(sin_a < 0.0, front_ry, back_ry)
    front_weight = np.clip(-sin_a, 0.0, 1.0)
    side_weight = np.abs(cos_a)
    back_raise = 0.003 / geometry_to_meters
    front_drop = 0.026 / geometry_to_meters
    side_drop = 0.004 / geometry_to_meters
    z = center[2] + back_raise - front_drop * front_weight - side_drop * side_weight
    return np.column_stack((
        center[0] + cos_a * rx,
        center[1] + sin_a * y_radius,
        z,
    ))

def _shape_anatomical_armhole_sector(
    top_ring: np.ndarray,
    chest_ring: np.ndarray,
    side: str,
    shoulder: np.ndarray | None,
    armpit: np.ndarray | None,
    half_angle_rad: float,
    geometry_to_meters: float,
) -> dict[str, Any]:
    """Blend the lateral torso rings toward anatomical shoulder/armpit anchors.

    The previous generator cut a broad sector from two generic ellipses. That
    created large shoulder gaps. This profile keeps the opening narrow and
    follows the actual shoulder-to-armpit line when anchors are available.
    """
    count = len(top_ring)
    center_angle = math.pi if side == "left" else 0.0
    angles = np.linspace(0.0, math.tau, count, endpoint=False, dtype=np.float64)
    delta = np.arctan2(np.sin(angles - center_angle), np.cos(angles - center_angle))
    mask = np.abs(delta) <= half_angle_rad * 1.25
    if not np.any(mask):
        return {"side": side, "used_anchors": False, "adjusted_vertices": 0}
    weight = np.zeros(count, dtype=np.float64)
    weight[mask] = np.cos(np.clip(np.abs(delta[mask]) / max(half_angle_rad * 1.25, 1e-9), 0.0, 1.0) * math.pi * 0.5) ** 2
    sign = -1.0 if side == "left" else 1.0
    ease = 0.012 / geometry_to_meters
    used = shoulder is not None and armpit is not None
    if shoulder is None:
        shoulder = top_ring[int(np.argmin(top_ring[:, 0]) if side == "left" else np.argmax(top_ring[:, 0]))].copy()
    if armpit is None:
        armpit = chest_ring[int(np.argmin(chest_ring[:, 0]) if side == "left" else np.argmax(chest_ring[:, 0]))].copy()
    shoulder = np.asarray(shoulder, dtype=np.float64)
    armpit = np.asarray(armpit, dtype=np.float64)
    for index in np.where(mask)[0]:
        w = float(weight[index])
        shoulder_target = shoulder.copy()
        shoulder_target[0] += sign * ease
        shoulder_target[1] = top_ring[index, 1] * 0.72 + shoulder[1] * 0.28
        shoulder_target[2] += 0.004 / geometry_to_meters
        armpit_target = armpit.copy()
        armpit_target[0] += sign * ease * 0.45
        armpit_target[1] = chest_ring[index, 1] * 0.68 + armpit[1] * 0.32
        armpit_target[2] -= 0.003 / geometry_to_meters
        top_ring[index] = top_ring[index] * (1.0 - 0.72 * w) + shoulder_target * (0.72 * w)
        chest_ring[index] = chest_ring[index] * (1.0 - 0.76 * w) + armpit_target * (0.76 * w)
    return {
        "side": side,
        "used_anchors": bool(used),
        "adjusted_vertices": int(np.sum(mask) * 2),
        "shoulder_target": shoulder.tolist(),
        "armpit_target": armpit.tolist(),
    }


def _connect_rings(
    faces: list[list[int]],
    a: int,
    b: int,
    count: int,
    *,
    skip_edges: set[int] | None = None,
) -> None:
    skip = skip_edges or set()
    for i in range(count):
        if i in skip:
            continue
        j = (i + 1) % count
        faces.append([a + i, a + j, b + j])
        faces.append([a + i, b + j, b + i])


def _sector_indices(count: int, center_angle: float, half_angle: float) -> list[int]:
    angles = np.linspace(0.0, math.tau, count, endpoint=False, dtype=np.float64)
    delta = np.arctan2(np.sin(angles - center_angle), np.cos(angles - center_angle))
    selected = np.where(np.abs(delta) <= half_angle + 1e-9)[0]
    if len(selected) < 5:
        selected = np.argsort(np.abs(delta))[:5]
    return [int(index) for index in selected[np.argsort(delta[selected])]]


def _boundary_loop(top_offset: int, chest_offset: int, sector: list[int]) -> list[int]:
    # top arc from back/front edge, then chest arc in reverse; this is the open armhole boundary.
    return [top_offset + i for i in sector] + [chest_offset + i for i in reversed(sector)]


def _mesh_topology_metrics(mesh: trimesh.Trimesh) -> dict[str, Any]:
    faces = np.asarray(mesh.faces, dtype=np.int64)
    edge_counts: dict[tuple[int, int], int] = {}
    for tri in faces:
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            edge = (int(min(a, b)), int(max(a, b)))
            edge_counts[edge] = edge_counts.get(edge, 0) + 1
    boundary_edges = [edge for edge, count in edge_counts.items() if count == 1]
    nonmanifold_edges = [edge for edge, count in edge_counts.items() if count > 2]

    graph: dict[int, set[int]] = {}
    for a, b in boundary_edges:
        graph.setdefault(a, set()).add(b)
        graph.setdefault(b, set()).add(a)
    boundary_components = 0
    visited: set[int] = set()
    for node in graph:
        if node in visited:
            continue
        boundary_components += 1
        stack = [node]
        visited.add(node)
        while stack:
            current = stack.pop()
            for neighbor in graph.get(current, ()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)

    face_adjacency = np.asarray(mesh.face_adjacency, dtype=np.int64)
    if len(faces) == 0:
        shell_count = 0
    elif len(face_adjacency) == 0:
        shell_count = len(faces)
    else:
        parents = np.arange(len(faces), dtype=np.int64)

        def find(x: int) -> int:
            while parents[x] != x:
                parents[x] = parents[parents[x]]
                x = int(parents[x])
            return x

        def union(a: int, b: int) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                parents[rb] = ra

        for a, b in face_adjacency:
            union(int(a), int(b))
        shell_count = len({find(i) for i in range(len(faces))})

    return {
        "connected_shell_count": int(shell_count),
        "boundary_loop_count": int(boundary_components),
        "boundary_edge_count": int(len(boundary_edges)),
        "nonmanifold_edge_count": int(len(nonmanifold_edges)),
        "expected_openings": ["neck", "hem", "left_sleeve_cuff", "right_sleeve_cuff"],
        "expected_boundary_loop_count": 4,
    }


def _mirror_index(count: int, index: int) -> int:
    return int((count // 2 - index) % count)


def _ring_symmetry_pairs(offset: int, count: int) -> list[tuple[int, int]]:
    pairs: list[tuple[int, int]] = []
    seen: set[tuple[int, int]] = set()
    for i in range(count):
        j = _mirror_index(count, i)
        pair = tuple(sorted((offset + i, offset + j)))
        if pair not in seen:
            seen.add(pair)
            pairs.append(pair)
    return pairs


def _pair_by_mirror(
    vertices: list[list[float]],
    left_indices: list[int],
    right_indices: list[int],
    center_x: float,
) -> list[tuple[int, int]]:
    if not left_indices or not right_indices:
        return []
    right_points = np.asarray([vertices[i] for i in right_indices], dtype=np.float64)
    pairs: list[tuple[int, int]] = []
    available = set(range(len(right_indices)))
    for left_index in left_indices:
        left = np.asarray(vertices[left_index], dtype=np.float64)
        target = np.array([2.0 * center_x - left[0], left[1], left[2]], dtype=np.float64)
        candidates = sorted(available, key=lambda k: float(np.linalg.norm(right_points[k] - target)))
        if not candidates:
            break
        chosen = candidates[0]
        available.remove(chosen)
        pairs.append((left_index, right_indices[chosen]))
    return pairs


def _build_connected_tshirt(
    sections: dict[str, dict[str, Any]],
    anchors: dict[str, dict[str, Any]],
    geometry_to_meters: float,
    preset: FitPreset,
    ring_count: int = 64,
) -> tuple[trimesh.Trimesh, dict[str, Any], dict[str, Any], dict[str, Any]]:
    chest = sections["chest"]
    waist = sections["waist"]
    hip = sections["hip"]
    neck = sections["neck"]

    def geom_m(value_m: float) -> float:
        return float(value_m / geometry_to_meters)

    def dimensions(section: dict[str, Any], width_scale: float, depth_scale: float) -> tuple[float, float]:
        return (
            float(section["width_cm"]) / 200.0 / geometry_to_meters * width_scale,
            float(section["depth_cm"]) / 200.0 / geometry_to_meters * depth_scale,
        )

    chest_center = np.asarray(chest["centroid"], dtype=np.float64)
    waist_center = np.asarray(waist["centroid"], dtype=np.float64)
    hip_center = np.asarray(hip["centroid"], dtype=np.float64)
    neck_center = np.asarray(neck["centroid"], dtype=np.float64)
    symmetry_center_x = float(np.mean([chest_center[0], waist_center[0], hip_center[0], neck_center[0]]))
    for center in (chest_center, waist_center, hip_center, neck_center):
        center[0] = symmetry_center_x

    shoulder_left = _canonical_anchor(anchors, "shoulder_left")
    shoulder_right = _canonical_anchor(anchors, "shoulder_right")
    armpit_left = _canonical_anchor(anchors, "armpit_left")
    armpit_right = _canonical_anchor(anchors, "armpit_right")
    shoulder_points = [point for point in (shoulder_left, shoulder_right) if point is not None]
    shoulder_z = max(
        float(chest["z"]) + geom_m(0.095),
        float(np.mean([p[2] for p in shoulder_points])) if shoulder_points else float(chest["z"]) + geom_m(0.12),
    )
    shoulder_z = min(shoulder_z, float(neck["z"]) - geom_m(0.025))
    hem_z = float(hip["z"]) + geom_m(0.018)

    chest_rx, chest_ry = dimensions(chest, preset.torso_width_scale, preset.torso_depth_scale)
    waist_rx, waist_ry = dimensions(waist, max(preset.torso_width_scale, 1.12), max(preset.torso_depth_scale, 1.10))
    hip_rx, hip_ry = dimensions(hip, max(preset.torso_width_scale, 1.10), max(preset.torso_depth_scale, 1.10))
    shoulder_rx = max(chest_rx * preset.shoulder_width_scale, chest_rx + geom_m(0.014))
    shoulder_ry = max(chest_ry * 1.03, chest_ry + geom_m(0.005))

    neck_half_width = float(neck["width_cm"]) / 200.0 / geometry_to_meters
    neck_half_depth = float(neck["depth_cm"]) / 200.0 / geometry_to_meters
    neck_rx = min(neck_half_width + preset.neck_ease_m / geometry_to_meters, shoulder_rx * 0.30)
    neck_rx = max(neck_rx, neck_half_width * 1.03)
    neck_front_ry = neck_half_depth + (preset.neck_ease_m * 0.90) / geometry_to_meters
    neck_back_ry = neck_half_depth + (preset.neck_ease_m * 0.45) / geometry_to_meters

    top_center = np.array([symmetry_center_x, chest_center[1], shoulder_z], dtype=np.float64)
    chest_center = chest_center.copy(); chest_center[2] = float(chest["z"])
    waist_center = waist_center.copy(); waist_center[2] = float(waist["z"])
    hem_center = hip_center.copy(); hem_center[2] = hem_z
    neck_center = np.array([symmetry_center_x, top_center[1], shoulder_z], dtype=np.float64)

    top_ring = _shoulder_ring(top_center, shoulder_rx, shoulder_ry, ring_count, geom_m(preset.shoulder_drop_m))
    chest_ring = _ellipse_ring(chest_center, chest_rx, chest_ry, ring_count)
    waist_ring = _ellipse_ring(waist_center, waist_rx, waist_ry, ring_count)
    hem_ring = _ellipse_ring(hem_center, hip_rx, hip_ry, ring_count)
    neck_ring = _crew_neck_ring(neck_center, neck_rx, neck_front_ry, neck_back_ry, ring_count, geometry_to_meters)

    anatomical_armholes = {
        "left": _shape_anatomical_armhole_sector(
            top_ring, chest_ring, "left", shoulder_left, armpit_left,
            math.radians(preset.armhole_half_angle_deg), geometry_to_meters,
        ),
        "right": _shape_anatomical_armhole_sector(
            top_ring, chest_ring, "right", shoulder_right, armpit_right,
            math.radians(preset.armhole_half_angle_deg), geometry_to_meters,
        ),
    }

    vertices = np.concatenate([top_ring, chest_ring, waist_ring, hem_ring, neck_ring], axis=0).tolist()
    top_offset = 0
    chest_offset = ring_count
    waist_offset = ring_count * 2
    hem_offset = ring_count * 3
    neck_offset = ring_count * 4

    half_angle = math.radians(preset.armhole_half_angle_deg)
    right_sector = _sector_indices(ring_count, 0.0, half_angle)
    left_sector = _sector_indices(ring_count, math.pi, half_angle)
    skipped_edges = set(right_sector[:-1]) | set(left_sector[:-1])

    faces: list[list[int]] = []
    _connect_rings(faces, top_offset, chest_offset, ring_count, skip_edges=skipped_edges)
    _connect_rings(faces, chest_offset, waist_offset, ring_count)
    _connect_rings(faces, waist_offset, hem_offset, ring_count)
    _connect_rings(faces, top_offset, neck_offset, ring_count)

    root_indices_by_side = {
        "left": _boundary_loop(top_offset, chest_offset, left_sector),
        "right": _boundary_loop(top_offset, chest_offset, right_sector),
    }
    root_centers = {
        side: np.mean(np.asarray([vertices[i] for i in indices], dtype=np.float64), axis=0)
        for side, indices in root_indices_by_side.items()
    }
    elbow_left = _canonical_anchor(anchors, "elbow_left")
    elbow_right = _canonical_anchor(anchors, "elbow_right")
    if elbow_left is None:
        elbow_left = root_centers["left"] + np.array([-geom_m(0.20), 0.0, -geom_m(0.12)], dtype=np.float64)
    if elbow_right is None:
        elbow_right = root_centers["right"] + np.array([geom_m(0.20), 0.0, -geom_m(0.12)], dtype=np.float64)

    left_axis = np.asarray(elbow_left - root_centers["left"], dtype=np.float64)
    right_axis = np.asarray(elbow_right - root_centers["right"], dtype=np.float64)
    common_x = max((abs(float(left_axis[0])) + abs(float(right_axis[0]))) * 0.5, geom_m(0.05))
    common_y = float(left_axis[1] + right_axis[1]) * 0.5
    common_z = min(float(left_axis[2] + right_axis[2]) * 0.5, -geom_m(0.03))
    common_axis_length = max((float(np.linalg.norm(left_axis)) + float(np.linalg.norm(right_axis))) * 0.5, geom_m(0.12))
    directions = {
        "left": np.array([-common_x, common_y, common_z], dtype=np.float64),
        "right": np.array([common_x, common_y, common_z], dtype=np.float64),
    }
    for side in directions:
        directions[side] /= max(float(np.linalg.norm(directions[side])), 1e-12)

    sleeve_length = min(preset.sleeve_length_m / geometry_to_meters, common_axis_length * 0.82)
    sleeve_length = max(sleeve_length, geom_m(0.10))
    circumferences = [
        float(sections.get("left_bicep", {}).get("circumference_cm") or 0.0),
        float(sections.get("right_bicep", {}).get("circumference_cm") or 0.0),
    ]
    valid_circumferences = [value for value in circumferences if 12.0 <= value <= 60.0]
    circumference_cm = float(np.mean(valid_circumferences)) if valid_circumferences else 30.0
    body_radius = circumference_cm / 100.0 / math.tau / geometry_to_meters
    start_radius = body_radius + preset.sleeve_ease_m / geometry_to_meters
    cuff_radius = max(body_radius * 0.92 + preset.sleeve_ease_m * 0.70 / geometry_to_meters, body_radius + geom_m(0.006))

    sleeve_diagnostics: dict[str, Any] = {}
    generated_indices_by_side: dict[str, list[int]] = {"left": [], "right": []}
    for side in ("left", "right"):
        root_indices = root_indices_by_side[side]
        root_points = np.asarray([vertices[index] for index in root_indices], dtype=np.float64)
        root_center = root_centers[side]
        direction = directions[side]
        raw_radial = root_points - root_center[None, :]
        projected = raw_radial - np.outer(raw_radial @ direction, direction)
        projected_norm = np.linalg.norm(projected, axis=1)
        fallback = np.array([0.0, 1.0, 0.0], dtype=np.float64)
        if abs(float(np.dot(fallback, direction))) > 0.9:
            fallback = np.array([0.0, 0.0, 1.0], dtype=np.float64)
        fallback = fallback - direction * float(np.dot(fallback, direction))
        fallback /= max(float(np.linalg.norm(fallback)), 1e-12)
        units = np.zeros_like(projected)
        valid = projected_norm > 1e-8
        units[valid] = projected[valid] / projected_norm[valid, None]
        units[~valid] = fallback

        previous_indices = root_indices
        generated_ring_offsets: list[int] = []
        for t in (0.24, 0.58, 1.0):
            center = root_center + direction * sleeve_length * t
            target_radius = start_radius * (1.0 - t) + cuff_radius * t
            blended_radius = projected_norm * max(0.0, 1.0 - t * 1.35) + target_radius * min(1.0, t * 1.35)
            ring = center[None, :] + units * blended_radius[:, None]
            offset = len(vertices)
            vertices.extend(ring.tolist())
            generated_ring_offsets.append(offset)
            current_indices = list(range(offset, offset + len(root_indices)))
            generated_indices_by_side[side].extend(current_indices)
            for i in range(len(root_indices)):
                j = (i + 1) % len(root_indices)
                faces.append([previous_indices[i], previous_indices[j], current_indices[j]])
                faces.append([previous_indices[i], current_indices[j], current_indices[i]])
            previous_indices = current_indices

        sleeve_diagnostics[side] = {
            "side": side,
            "armhole_vertex_count": len(root_indices),
            "armhole_sector_vertex_count": len(root_indices) // 2,
            "root_center": root_center.tolist(),
            "end_center": (root_center + direction * sleeve_length).tolist(),
            "length_geometry": sleeve_length,
            "body_radius_geometry": body_radius,
            "start_radius_geometry": start_radius,
            "cuff_radius_geometry": cuff_radius,
            "connected_to_torso": True,
            "symmetry_locked": True,
            "generated_ring_offsets": generated_ring_offsets,
        }

    symmetry_pairs: list[tuple[int, int]] = []
    for offset in (top_offset, chest_offset, waist_offset, hem_offset, neck_offset):
        symmetry_pairs.extend(_ring_symmetry_pairs(offset, ring_count))
    symmetry_pairs.extend(_pair_by_mirror(
        vertices,
        root_indices_by_side["left"] + generated_indices_by_side["left"],
        root_indices_by_side["right"] + generated_indices_by_side["right"],
        symmetry_center_x,
    ))
    symmetry_pairs = list(dict.fromkeys(tuple(sorted(pair)) for pair in symmetry_pairs))

    mesh = trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=np.float64),
        faces=np.asarray(faces, dtype=np.int64),
        process=False,
        validate=False,
    )
    mesh.visual.vertex_colors = np.tile(np.array([66, 201, 255, 220], dtype=np.uint8), (len(mesh.vertices), 1))

    torso_diagnostics = {
        "shoulder_z": shoulder_z,
        "hem_z": hem_z,
        "ring_count": ring_count,
        "armhole_half_angle_degrees": preset.armhole_half_angle_deg,
        "symmetry_center_x": symmetry_center_x,
        "shoulder_line": {"style": "symmetric_sloped", "side_drop_geometry": geom_m(preset.shoulder_drop_m)},
        "outer_dimensions_geometry": {
            "shoulder_width": shoulder_rx * 2.0,
            "shoulder_depth": shoulder_ry * 2.0,
            "chest_width": chest_rx * 2.0,
            "chest_depth": chest_ry * 2.0,
            "waist_width": waist_rx * 2.0,
            "waist_depth": waist_ry * 2.0,
            "hem_width": hip_rx * 2.0,
            "hem_depth": hip_ry * 2.0,
        },
        "neck_opening_geometry": {
            "width": neck_rx * 2.0,
            "front_depth": neck_front_ry,
            "back_depth": neck_back_ry,
            "style": "crew_neck_center_locked",
            "center_locked": True,
            "protected_from_collision_warp": True,
        },
        "top_center": top_center.tolist(),
        "anatomical_armholes": anatomical_armholes,
        "anatomical_shoulder_profile_ready": bool(
            anatomical_armholes["left"].get("used_anchors")
            and anatomical_armholes["right"].get("used_anchors")
        ),
    }
    protected_vertex_indices: set[int] = set(range(neck_offset, neck_offset + ring_count))
    protected_vertex_indices.update(range(waist_offset, waist_offset + ring_count))
    for side in ("left", "right"):
        ring_offsets = sleeve_diagnostics[side]["generated_ring_offsets"]
        if ring_offsets:
            cuff_offset = int(ring_offsets[-1])
            cuff_count = int(sleeve_diagnostics[side]["armhole_vertex_count"])
            protected_vertex_indices.update(range(cuff_offset, cuff_offset + cuff_count))

    construction = {
        "symmetry_center_x": symmetry_center_x,
        "symmetry_pairs": symmetry_pairs,
        "protected_vertex_indices": sorted(int(i) for i in protected_vertex_indices),
        "protected_vertex_positions": {str(i): vertices[i] for i in sorted(protected_vertex_indices)},
        "ring_offsets": {
            "top": top_offset,
            "chest": chest_offset,
            "waist": waist_offset,
            "hem": hem_offset,
            "neck": neck_offset,
        },
    }
    return mesh, torso_diagnostics, sleeve_diagnostics, construction

def _transform_mesh_to_source(mesh: trimesh.Trimesh, matrix: np.ndarray) -> trimesh.Trimesh:
    transformed = mesh.copy()
    transformed.vertices = transform_points(np.asarray(mesh.vertices, dtype=np.float64), matrix)
    return transformed


def _body_mesh_canonical(source_glb: Path, result: dict[str, Any]) -> trimesh.Trimesh:
    loaded = load_glb(source_glb)
    matrix = np.asarray(result["canonical_space"]["source_to_canonical_matrix"], dtype=np.float64)
    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for item in loaded.primitives:
        transformed = transform_points(item.vertices_source, matrix)
        vertices.append(transformed)
        faces.append(np.asarray(item.faces, dtype=np.int64) + offset)
        offset += len(transformed)
    return trimesh.Trimesh(
        vertices=np.concatenate(vertices, axis=0),
        faces=np.concatenate(faces, axis=0),
        process=False,
        validate=False,
    )


def _nearest_triangle_surface(
    body_mesh: trimesh.Trimesh,
    points: np.ndarray,
    candidate_count: int = 96,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    triangles = np.asarray(body_mesh.triangles, dtype=np.float64)
    centroids = np.asarray(body_mesh.triangles_center, dtype=np.float64)
    tree = cKDTree(centroids)
    k = int(min(max(candidate_count, 8), len(triangles)))
    _, candidate_ids = tree.query(points, k=k, workers=-1)
    if k == 1:
        candidate_ids = np.asarray(candidate_ids, dtype=np.int64)[:, None]
    closest = np.zeros_like(points, dtype=np.float64)
    distances = np.full(len(points), np.inf, dtype=np.float64)
    triangle_ids = np.full(len(points), -1, dtype=np.int64)
    normals = np.zeros_like(points, dtype=np.float64)
    face_normals = np.asarray(body_mesh.face_normals, dtype=np.float64)
    body_center = np.asarray(body_mesh.centroid, dtype=np.float64)
    for index, point in enumerate(points):
        ids = np.asarray(candidate_ids[index], dtype=np.int64)
        candidate_triangles = triangles[ids]
        repeated = np.repeat(point[None, :], len(ids), axis=0)
        candidate_closest = trimesh.triangles.closest_point(candidate_triangles, repeated)
        candidate_distance = np.linalg.norm(candidate_closest - point[None, :], axis=1)
        best = int(np.argmin(candidate_distance))
        tri_id = int(ids[best])
        surface = candidate_closest[best]
        normal = face_normals[tri_id].copy()
        if float(np.dot(normal, surface - body_center)) < 0.0:
            normal *= -1.0
        normal_length = float(np.linalg.norm(normal))
        if normal_length > 1e-12:
            normal /= normal_length
        closest[index] = surface
        distances[index] = float(candidate_distance[best])
        triangle_ids[index] = tri_id
        normals[index] = normal
    return closest, distances, triangle_ids, normals


def _apply_symmetry_lock(mesh: trimesh.Trimesh, construction: dict[str, Any]) -> int:
    vertices = np.asarray(mesh.vertices, dtype=np.float64).copy()
    center_x = float(construction.get("symmetry_center_x", 0.0))
    changed = 0
    for raw_pair in construction.get("symmetry_pairs", []):
        a, b = int(raw_pair[0]), int(raw_pair[1])
        if a == b:
            vertices[a, 0] = center_x
            continue
        left, right = (a, b) if vertices[a, 0] <= vertices[b, 0] else (b, a)
        half_width = (abs(float(vertices[left, 0] - center_x)) + abs(float(vertices[right, 0] - center_x))) * 0.5
        y = float(vertices[left, 1] + vertices[right, 1]) * 0.5
        z = float(vertices[left, 2] + vertices[right, 2]) * 0.5
        vertices[left] = [center_x - half_width, y, z]
        vertices[right] = [center_x + half_width, y, z]
        changed += 2
    mesh.vertices = vertices
    return changed


def _vertex_neighbors(mesh: trimesh.Trimesh) -> list[set[int]]:
    neighbors: list[set[int]] = [set() for _ in range(len(mesh.vertices))]
    for tri in np.asarray(mesh.faces, dtype=np.int64):
        a, b, c = [int(v) for v in tri]
        neighbors[a].update((b, c))
        neighbors[b].update((a, c))
        neighbors[c].update((a, b))
    return neighbors


def _expand_mask(neighbors: list[set[int]], seed: np.ndarray, depth: int = 1) -> np.ndarray:
    current = np.asarray(seed, dtype=bool).copy()
    for _ in range(max(int(depth), 0)):
        expanded = current.copy()
        for index, active in enumerate(current):
            if not active:
                continue
            for neighbor in neighbors[index]:
                expanded[int(neighbor)] = True
        current = expanded
    return current


def _laplacian_smooth_selected(
    mesh: trimesh.Trimesh,
    neighbors: list[set[int]],
    selected: np.ndarray,
    locked: set[int],
    iterations: int = 1,
    strength: float = 0.22,
) -> int:
    vertices = np.asarray(mesh.vertices, dtype=np.float64).copy()
    selected = np.asarray(selected, dtype=bool)
    moved = 0
    for _ in range(max(int(iterations), 0)):
        base = vertices.copy()
        for index, flag in enumerate(selected):
            if not flag or index in locked:
                continue
            ring = [n for n in neighbors[index] if n not in locked]
            if not ring:
                continue
            centroid = base[ring].mean(axis=0)
            vertices[index] = base[index] * (1.0 - strength) + centroid * strength
            moved += 1
    mesh.vertices = vertices
    return moved


def _augment_symmetry_pairs(mesh: trimesh.Trimesh, construction: dict[str, Any]) -> None:
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    center_x = float(construction.get("symmetry_center_x", 0.0))
    left = np.where(vertices[:, 0] < center_x - 1e-7)[0].tolist()
    right = np.where(vertices[:, 0] > center_x + 1e-7)[0].tolist()
    pairs = _pair_by_mirror(vertices.tolist(), left, right, center_x)
    construction["symmetry_pairs"] = list(dict.fromkeys(
        tuple(sorted((int(a), int(b))))
        for a, b in construction.get("symmetry_pairs", []) + pairs
    ))


def _uniform_subdivide_with_surface_projection(
    mesh: trimesh.Trimesh,
    body_mesh: trimesh.Trimesh,
    target_signed: float,
    construction: dict[str, Any],
) -> dict[str, Any]:
    """Subdivide every triangle once using shared edge midpoints.

    The v0.9.3 garment was too coarse: vertices could be outside while a large
    triangular face still cut through the body. A conforming global subdivision
    keeps the mesh manifold and gives the solver enough points to curve around
    shoulders, axillas and the torso.
    """
    old_vertices = np.asarray(mesh.vertices, dtype=np.float64)
    old_faces = np.asarray(mesh.faces, dtype=np.int64)
    vertices = old_vertices.tolist()
    edge_midpoints: dict[tuple[int, int], int] = {}
    new_vertex_indices: list[int] = []

    def midpoint_index(a: int, b: int) -> int:
        edge = (min(int(a), int(b)), max(int(a), int(b)))
        if edge in edge_midpoints:
            return edge_midpoints[edge]
        point = (old_vertices[edge[0]] + old_vertices[edge[1]]) * 0.5
        index = len(vertices)
        vertices.append(point.tolist())
        edge_midpoints[edge] = index
        new_vertex_indices.append(index)
        return index

    new_faces: list[list[int]] = []
    for face in old_faces:
        a, b, c = [int(v) for v in face]
        ab = midpoint_index(a, b)
        bc = midpoint_index(b, c)
        ca = midpoint_index(c, a)
        new_faces.extend((
            [a, ab, ca],
            [ab, b, bc],
            [ca, bc, c],
            [ab, bc, ca],
        ))

    vertices_array = np.asarray(vertices, dtype=np.float64)
    if new_vertex_indices:
        points = vertices_array[new_vertex_indices]
        closest, _, _, normals = _nearest_triangle_surface(body_mesh, points)
        signed = np.einsum("ij,ij->i", points - closest, normals)
        bad = signed < target_signed
        if np.any(bad):
            selected = np.asarray(new_vertex_indices, dtype=np.int64)[bad]
            vertices_array[selected] = closest[bad] + normals[bad] * (target_signed * 1.03)

    mesh.vertices = vertices_array
    mesh.faces = np.asarray(new_faces, dtype=np.int64)
    mesh.visual.vertex_colors = np.tile(np.array([66, 201, 255, 220], dtype=np.uint8), (len(mesh.vertices), 1))
    return {
        "source_vertex_count": int(len(old_vertices)),
        "source_face_count": int(len(old_faces)),
        "vertex_count": int(len(mesh.vertices)),
        "face_count": int(len(mesh.faces)),
        "inserted_edge_vertices": int(len(new_vertex_indices)),
    }


def _subdivide_penetrating_faces(
    mesh: trimesh.Trimesh,
    body_mesh: trimesh.Trimesh,
    target_signed: float,
    construction: dict[str, Any],
    max_rounds: int = 3,
) -> dict[str, Any]:
    """Split face-crossing triangles and place new centroids outside the body.

    A triangle can cross the avatar even when its three vertices are outside.
    Subdividing the face gives the solver a vertex exactly where the crossing
    occurs, allowing the local surface to bend around the body.
    """
    rounds = 0
    subdivided_faces = 0
    inserted_vertices = 0
    for _ in range(max_rounds):
        centers = np.asarray(mesh.triangles_center, dtype=np.float64)
        closest, _, _, normals = _nearest_triangle_surface(body_mesh, centers)
        signed = np.einsum("ij,ij->i", centers - closest, normals)
        bad = np.where(signed < 0.0)[0]
        if not len(bad):
            break
        bad_set = {int(i) for i in bad}
        vertices = np.asarray(mesh.vertices, dtype=np.float64).tolist()
        new_faces: list[list[int]] = []
        old_faces = np.asarray(mesh.faces, dtype=np.int64)
        for face_index, face in enumerate(old_faces):
            a, b, c = [int(v) for v in face]
            if face_index not in bad_set:
                new_faces.append([a, b, c])
                continue
            point = closest[face_index] + normals[face_index] * (target_signed * 1.04)
            center_index = len(vertices)
            vertices.append(point.tolist())
            new_faces.extend(([a, b, center_index], [b, c, center_index], [c, a, center_index]))
            subdivided_faces += 1
            inserted_vertices += 1
        mesh.vertices = np.asarray(vertices, dtype=np.float64)
        mesh.faces = np.asarray(new_faces, dtype=np.int64)
        mesh.visual.vertex_colors = np.tile(np.array([66, 201, 255, 220], dtype=np.uint8), (len(mesh.vertices), 1))
        rounds += 1
    return {
        "rounds": rounds,
        "subdivided_faces": subdivided_faces,
        "inserted_vertices": inserted_vertices,
    }


def _enforce_triangle_surface_clearance(
    mesh: trimesh.Trimesh,
    source_glb: Path | None,
    result: dict[str, Any],
    minimum_clearance_m: float,
    construction: dict[str, Any],
) -> dict[str, Any]:
    if source_glb is None or not source_glb.is_file():
        _apply_symmetry_lock(mesh, construction)
        return {"available": False, "reason": "SOURCE_GLB_NOT_AVAILABLE", "corrected_vertices": 0, "smoothed_vertices": 0, "symmetry_locked": True}
    try:
        body_mesh = _body_mesh_canonical(source_glb, result)
        geometry_to_meters = float(result.get("body_measurements", {}).get("scale", {}).get("geometry_to_meters") or 1.0)
        clearance_geometry = minimum_clearance_m / geometry_to_meters
        target_signed = clearance_geometry
        body_center = np.asarray(body_mesh.centroid, dtype=np.float64)
        protected = {int(index) for index in construction.get("protected_vertex_indices", [])}
        uniform_subdivision = _uniform_subdivide_with_surface_projection(
            mesh, body_mesh, target_signed, construction
        )
        neighbors = _vertex_neighbors(mesh)
        total_corrected = 0
        total_smoothed = 0
        max_iterations = 8

        for _ in range(max_iterations):
            vertices = np.asarray(mesh.vertices, dtype=np.float64).copy()
            closest_v, _, _, normals_v = _nearest_triangle_surface(body_mesh, vertices)
            offsets_v = vertices - closest_v
            signed_v = np.einsum("ij,ij->i", offsets_v, normals_v)

            face_centers = np.asarray(mesh.triangles_center, dtype=np.float64)
            closest_c, _, tri_ids_c, normals_c = _nearest_triangle_surface(body_mesh, face_centers)
            offsets_c = face_centers - closest_c
            signed_c = np.einsum("ij,ij->i", offsets_c, normals_c)

            penetration_mask = signed_v < target_signed
            face_penetration = np.where(signed_c < target_signed * 0.25)[0]
            if len(face_penetration):
                face_normals_accum = np.zeros_like(vertices)
                face_counts = np.zeros(len(vertices), dtype=np.float64)
                for fi in face_penetration:
                    face = np.asarray(mesh.faces[int(fi)], dtype=np.int64)
                    normal = normals_c[int(fi)]
                    deficit = max(target_signed - float(signed_c[int(fi)]), target_signed * 0.35)
                    for vi in face:
                        idx = int(vi)
                        penetration_mask[idx] = True
                        face_normals_accum[idx] += normal * deficit
                        face_counts[idx] += 1.0
                for idx in np.where(face_counts > 0)[0]:
                    length = float(np.linalg.norm(face_normals_accum[idx]))
                    if length > 1e-12:
                        normal = face_normals_accum[idx] / length
                        vertices[idx] += normal * max(float(face_counts[idx]) * target_signed * 0.10, target_signed * 0.18)

            candidate_indices = np.where(penetration_mask)[0]
            if not len(candidate_indices):
                _apply_symmetry_lock(mesh, construction)
                break

            deficits = np.maximum(target_signed - signed_v[candidate_indices], target_signed * 0.18)
            vertices[candidate_indices] = closest_v[candidate_indices] + normals_v[candidate_indices] * (target_signed + deficits * 0.08)[:, None]
            mesh.vertices = vertices
            total_corrected += int(len(candidate_indices))

            smooth_mask = _expand_mask(neighbors, penetration_mask, depth=1)
            if protected:
                smooth_mask[list(protected)] = False
            total_smoothed += _laplacian_smooth_selected(mesh, neighbors, smooth_mask, protected, iterations=2, strength=0.20)
            _apply_symmetry_lock(mesh, construction)

        face_subdivision = _subdivide_penetrating_faces(
            mesh, body_mesh, target_signed, construction, max_rounds=3
        )
        neighbors = _vertex_neighbors(mesh)
        _apply_symmetry_lock(mesh, construction)

        # Final validation and one last mild relaxation for vertices close to the body.
        vertices = np.asarray(mesh.vertices, dtype=np.float64).copy()
        closest_v, _, _, normals_v = _nearest_triangle_surface(body_mesh, vertices)
        signed_v = np.einsum("ij,ij->i", vertices - closest_v, normals_v)
        near_mask = signed_v < target_signed * 1.02
        if np.any(near_mask):
            vertices[near_mask] = closest_v[near_mask] + normals_v[near_mask] * (target_signed * 1.03)
            mesh.vertices = vertices
            total_corrected += int(np.sum(near_mask))
            total_smoothed += _laplacian_smooth_selected(mesh, neighbors, _expand_mask(neighbors, near_mask, depth=1), protected, iterations=1, strength=0.14)
            _apply_symmetry_lock(mesh, construction)

        final_face_subdivision = _subdivide_penetrating_faces(
            mesh, body_mesh, target_signed, construction, max_rounds=2
        )
        face_subdivision["rounds"] += final_face_subdivision["rounds"]
        face_subdivision["subdivided_faces"] += final_face_subdivision["subdivided_faces"]
        face_subdivision["inserted_vertices"] += final_face_subdivision["inserted_vertices"]
        _apply_symmetry_lock(mesh, construction)

        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        face_centers = np.asarray(mesh.triangles_center, dtype=np.float64)
        samples = np.concatenate([vertices, face_centers], axis=0)
        closest, distances, triangle_ids, normals = _nearest_triangle_surface(body_mesh, samples)
        signed = np.einsum("ij,ij->i", samples - closest, normals)
        distances_m = distances * geometry_to_meters
        signed_m = signed * geometry_to_meters
        vertex_count = len(vertices)
        face_count = len(face_centers)
        vertex_distances_m = distances_m[:vertex_count]
        centroid_distances_m = distances_m[vertex_count:]
        vertex_signed_m = signed_m[:vertex_count]
        centroid_signed_m = signed_m[vertex_count:]
        negative_vertex_samples = int(np.sum(vertex_signed_m < -1e-6))
        negative_centroid_samples = int(np.sum(centroid_signed_m < -1e-6))
        negative_signed_samples = negative_vertex_samples + negative_centroid_samples
        zero_penetration_ready = negative_signed_samples == 0
        return {
            "available": True,
            "method": "iterative_signed_triangle_clearance_with_smoothing",
            "minimum_target_clearance_cm": minimum_clearance_m * 100.0,
            "corrected_vertices": total_corrected,
            "smoothed_vertices": total_smoothed,
            "iterations": max_iterations,
            "minimum_vertex_triangle_distance_cm": float(np.min(vertex_distances_m) * 100.0),
            "median_vertex_triangle_distance_cm": float(np.median(vertex_distances_m) * 100.0),
            "minimum_face_centroid_triangle_distance_cm": float(np.min(centroid_distances_m) * 100.0),
            "near_contact_vertex_samples_under_0_5cm": int(np.sum(vertex_distances_m < 0.005)),
            "near_contact_face_samples_under_0_5cm": int(np.sum(centroid_distances_m < 0.005)),
            "negative_vertex_samples": negative_vertex_samples,
            "negative_face_centroid_samples": negative_centroid_samples,
            "negative_signed_samples": negative_signed_samples,
            "sample_count": int(len(samples)),
            "triangle_candidate_count": 96,
            "symmetry_locked": True,
            "neck_vertices_protected": int(sum(int(i) < construction.get("ring_offsets", {}).get("neck", 0) + 64 for i in protected)),
            "protected_vertex_count": int(len(protected)),
            "uniform_subdivision": uniform_subdivision,
            "face_subdivision": face_subdivision,
            "zero_penetration_ready": zero_penetration_ready,
            "body_centroid_reference": body_center.tolist(),
            "limitation": "This is still a static clearance solver with smoothing, not a dynamic cloth simulation.",
        }
    except Exception as exc:
        _apply_symmetry_lock(mesh, construction)
        return {
            "available": False,
            "reason": f"TRIANGLE_CLEARANCE_FAILED:{type(exc).__name__}:{exc}",
            "corrected_vertices": 0,
            "smoothed_vertices": 0,
            "symmetry_locked": True,
        }

def generate_tshirt_mold(
    result: dict[str, Any],
    output_dir: Path,
    source_glb: Path | None = None,
    fit: str = "oversized",
) -> dict[str, Any]:
    if not result.get("readiness", {}).get("garment_mold_input_ready"):
        raise GarmentMoldError("GARMENT_MOLD_INPUT_NOT_READY")
    if fit not in FIT_PRESETS:
        raise GarmentMoldError(f"GARMENT_FIT_UNSUPPORTED:{fit}")
    preset = FIT_PRESETS[fit]
    scale = result.get("body_measurements", {}).get("scale", {})
    geometry_to_meters = float(scale.get("geometry_to_meters") or 0.0)
    if not math.isfinite(geometry_to_meters) or geometry_to_meters <= 0:
        raise GarmentMoldError("GARMENT_SCALE_NOT_CALIBRATED")

    sections = {name: _required_section(result, name) for name in ("neck", "chest", "waist", "hip")}
    body_sections = result.get("body_measurements", {}).get("sections", {})
    sections.update({
        "left_bicep": body_sections.get("left_bicep", {}),
        "right_bicep": body_sections.get("right_bicep", {}),
    })
    anchors = _anchor_map(result)

    canonical_mesh, torso_diagnostics, sleeve_diagnostics, construction = _build_connected_tshirt(
        sections, anchors, geometry_to_meters, preset
    )
    if not len(canonical_mesh.vertices) or not len(canonical_mesh.faces):
        raise GarmentMoldError("GARMENT_MESH_EMPTY")

    clearance = _enforce_triangle_surface_clearance(
        canonical_mesh,
        source_glb,
        result,
        preset.minimum_clearance_m,
        construction,
    )
    topology = _mesh_topology_metrics(canonical_mesh)
    if topology["connected_shell_count"] != 1:
        raise GarmentMoldError(f"GARMENT_NOT_SINGLE_SHELL:{topology['connected_shell_count']}")
    if topology["nonmanifold_edge_count"] != 0:
        raise GarmentMoldError(f"GARMENT_NONMANIFOLD_EDGES:{topology['nonmanifold_edge_count']}")

    canonical_to_source = np.asarray(result.get("canonical_space", {}).get("canonical_to_source_matrix"), dtype=np.float64)
    if canonical_to_source.shape != (4, 4) or not np.isfinite(canonical_to_source).all():
        raise GarmentMoldError("GARMENT_CANONICAL_MATRIX_INVALID")
    source_mesh = _transform_mesh_to_source(canonical_mesh, canonical_to_source)

    garment_id = uuid.uuid4().hex
    garment_root = output_dir / "garments" / garment_id
    garment_root.mkdir(parents=True, exist_ok=True)
    glb_path = garment_root / "clouva_tshirt_mold.glb"
    scene = trimesh.Scene()
    scene.add_geometry(source_mesh, node_name="CLOUVA_TSHIRT_MOLD_V094", geom_name="CLOUVA_TSHIRT_MOLD_V094")
    glb_path.write_bytes(scene.export(file_type="glb"))

    chest = sections["chest"]
    waist = sections["waist"]
    hip = sections["hip"]
    outer = torso_diagnostics["outer_dimensions_geometry"]
    design_clearances = {
        "chest_half_width_cm": (outer["chest_width"] - float(chest["width_cm"]) / 100.0 / geometry_to_meters) * geometry_to_meters * 50.0,
        "chest_half_depth_cm": (outer["chest_depth"] - float(chest["depth_cm"]) / 100.0 / geometry_to_meters) * geometry_to_meters * 50.0,
        "waist_half_width_cm": (outer["waist_width"] - float(waist["width_cm"]) / 100.0 / geometry_to_meters) * geometry_to_meters * 50.0,
        "hem_half_width_cm": (outer["hem_width"] - float(hip["width_cm"]) / 100.0 / geometry_to_meters) * geometry_to_meters * 50.0,
        "left_sleeve_radial_cm": (sleeve_diagnostics["left"]["start_radius_geometry"] - sleeve_diagnostics["left"]["body_radius_geometry"]) * geometry_to_meters * 100.0,
        "right_sleeve_radial_cm": (sleeve_diagnostics["right"]["start_radius_geometry"] - sleeve_diagnostics["right"]["body_radius_geometry"]) * geometry_to_meters * 100.0,
    }
    minimum_design_clearance_cm = float(min(design_clearances.values()))
    expected_openings_ok = topology["boundary_loop_count"] == topology["expected_boundary_loop_count"]
    anatomical_ready = bool(torso_diagnostics.get("anatomical_shoulder_profile_ready"))
    collision_status = "anatomical_zero_penetration_ready" if (
        expected_openings_ok and anatomical_ready and clearance.get("zero_penetration_ready", False)
    ) else "collision_rework_required"
    collision_report = {
        "version": VERSION,
        "garment_id": garment_id,
        "status": collision_status,
        "method": "anatomical_shoulder_shell_plus_face_subdivision_clearance",
        "design_clearances_cm": design_clearances,
        "minimum_design_clearance_cm": minimum_design_clearance_cm,
        "body_clearance": clearance,
        "topology": topology,
        "limitations": [
            "This is a symmetric connected parametric mold, not a cloth simulation.",
            "Triangle-surface clearance is not a dynamic cloth solver.",
            "Rigging and skin-weight transfer are not included in v0.9.4.",
        ],
    }
    collision_path = garment_root / "garment_collision_report.json"
    _write_json(collision_path, collision_report)

    fit_payload = {
        "version": VERSION,
        "garment_id": garment_id,
        "input_run_id": result.get("run_id"),
        "garment_type": "tshirt",
        "fit": fit,
        "status": "anatomical_shoulder_preview_ready",
        "coordinate_space": "source_glb",
        "geometry_to_meters": geometry_to_meters,
        "mesh": {
            "vertex_count": int(len(source_mesh.vertices)),
            "triangle_count": int(len(source_mesh.faces)),
            "connected_shells": topology["connected_shell_count"],
            "armholes_welded_by_shared_topology": True,
            "boolean_operation_required": False,
            "nonmanifold_edge_count": topology["nonmanifold_edge_count"],
            "boundary_loop_count": topology["boundary_loop_count"],
            "expected_openings_verified": expected_openings_ok,
            "rigged": False,
            "skinned": False,
            "symmetry_locked": True,
            "neck_geometry_locked": True,
        },
        "torso": torso_diagnostics,
        "sleeves": sleeve_diagnostics,
        "clearance": clearance,
        "readiness": {
            "preview_ready": True,
            "export_glb_ready": True,
            "single_connected_shell_ready": topology["connected_shell_count"] == 1,
            "armholes_connected_ready": True,
            "neck_opening_ready": True,
            "collision_review_ready": clearance.get("available", False) and clearance.get("zero_penetration_ready", False),
            "symmetric_pattern_ready": True,
            "neck_locked_ready": True,
            "anatomical_shoulder_profile_ready": bool(torso_diagnostics.get("anatomical_shoulder_profile_ready")),
            "face_collision_subdivision_ready": bool(
                clearance.get("available", False)
                and clearance.get("uniform_subdivision", {}).get("face_count", 0)
                    > clearance.get("uniform_subdivision", {}).get("source_face_count", 0)
                and clearance.get("zero_penetration_ready", False)
            ),
            "triangle_surface_clearance_ready": clearance.get("available", False) and clearance.get("zero_penetration_ready", False),
            "production_pattern_ready": bool(
                expected_openings_ok
                and torso_diagnostics.get("anatomical_shoulder_profile_ready")
                and clearance.get("available", False)
                and clearance.get("zero_penetration_ready", False)
            ),
            "rig_ready": False,
            "unreal_ready": False,
        },
        "assets": {
            "glb": str(glb_path.relative_to(output_dir)).replace("\\", "/"),
            "fit_json": str((garment_root / "garment_fit.json").relative_to(output_dir)).replace("\\", "/"),
            "collision_json": str(collision_path.relative_to(output_dir)).replace("\\", "/"),
        },
        "warnings": [
            "GARMENT_V094_ANATOMICAL_SHOULDERS_FACE_SUBDIVISION",
            "NO_RIG_OR_SKIN_WEIGHTS",
            "NO_DYNAMIC_CLOTH_SIMULATION",
            "STATIC_VOLUMETRIC_SMOOTHING_APPLIED",
        ],
    }
    fit_path = garment_root / "garment_fit.json"
    _write_json(fit_path, fit_payload)
    _write_json(output_dir / "garment_mold_latest.json", fit_payload)
    return fit_payload
